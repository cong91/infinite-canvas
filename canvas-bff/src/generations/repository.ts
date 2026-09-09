import { randomUUID } from "node:crypto";

export type GenerationKind = "image" | "video" | "audio" | "text";
export type GenerationStatus = "queued" | "running" | "provider_polling" | "succeeded" | "failed" | "cancelled";

export type GenerationRecord = {
    id: string;
    accountId: string;
    projectId: string;
    providerId: string;
    kind: GenerationKind;
    input: Record<string, unknown>;
    inputHash: string;
    clientRequestId: string;
    status: GenerationStatus;
    progress: number;
    providerTaskId?: string;
    attempt: number;
    leaseOwner?: string;
    leaseExpiresAt?: Date;
    errorCode?: string;
    outputAssetId?: string;
    createdAt: Date;
    updatedAt: Date;
};

export interface GenerationRepository {
    list(accountId: string): GenerationRecord[] | Promise<GenerationRecord[]>;
    get(accountId: string, id: string): GenerationRecord | undefined | Promise<GenerationRecord | undefined>;
    findByClientRequest(accountId: string, clientRequestId: string): GenerationRecord | undefined | Promise<GenerationRecord | undefined>;
    create(input: Omit<GenerationRecord, "id" | "createdAt" | "updatedAt">): GenerationRecord | Promise<GenerationRecord>;
    cancel(accountId: string, id: string): boolean | Promise<boolean>;
    claimNext(workerId: string, now: Date, leaseMs: number): GenerationRecord | undefined | Promise<GenerationRecord | undefined>;
    heartbeat(id: string, workerId: string, expiresAt: Date): boolean | Promise<boolean>;
    setProviderTask(id: string, providerTaskId: string, workerId: string, leaseExpiresAt: Date): boolean | Promise<boolean>;
    updateProgress(id: string, workerId: string, progress: number): boolean | Promise<boolean>;
    releaseForRetry(id: string, workerId: string, errorCode: string): boolean | Promise<boolean>;
    complete(id: string, workerId: string, outputAssetId: string): boolean | Promise<boolean>;
    fail(id: string, workerId: string, errorCode: string): boolean | Promise<boolean>;
}

export class InMemoryGenerationRepository implements GenerationRepository {
    private readonly records = new Map<string, GenerationRecord>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    list(accountId: string): GenerationRecord[] {
        return [...this.records.values()].filter((record) => record.accountId === accountId).map(cloneGeneration);
    }

    get(accountId: string, id: string): GenerationRecord | undefined {
        const record = this.records.get(id);
        return record?.accountId === accountId ? cloneGeneration(record) : undefined;
    }

    findByClientRequest(accountId: string, clientRequestId: string): GenerationRecord | undefined {
        const record = [...this.records.values()].find((item) => item.accountId === accountId && item.clientRequestId === clientRequestId);
        return record ? cloneGeneration(record) : undefined;
    }

    create(input: Omit<GenerationRecord, "id" | "createdAt" | "updatedAt">): GenerationRecord {
        if (this.findByClientRequest(input.accountId, input.clientRequestId)) throw new Error("Generation idempotency conflict");
        const now = new Date(this.now());
        const record: GenerationRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
        this.records.set(record.id, record);
        return cloneGeneration(record);
    }

    cancel(accountId: string, id: string): boolean {
        const record = this.records.get(id);
        if (!record || record.accountId !== accountId || ["succeeded", "failed", "cancelled"].includes(record.status)) return false;
        record.status = "cancelled";
        record.leaseOwner = undefined;
        record.leaseExpiresAt = undefined;
        record.updatedAt = new Date(this.now());
        return true;
    }

    claimNext(workerId: string, now: Date, leaseMs: number): GenerationRecord | undefined {
        const record = [...this.records.values()]
            .filter((item) => ["queued", "running", "provider_polling"].includes(item.status))
            .filter((item) => !item.leaseExpiresAt || item.leaseExpiresAt.getTime() <= now.getTime())
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
        if (!record) return undefined;
        record.status = record.providerTaskId ? "provider_polling" : "running";
        record.leaseOwner = workerId;
        record.leaseExpiresAt = new Date(now.getTime() + leaseMs);
        record.updatedAt = now;
        return cloneGeneration(record);
    }

    heartbeat(id: string, workerId: string, expiresAt: Date): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId || record.status === "cancelled") return false;
        record.leaseExpiresAt = expiresAt;
        record.updatedAt = new Date(this.now());
        return true;
    }

    setProviderTask(id: string, providerTaskId: string, workerId: string, leaseExpiresAt: Date): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId) return false;
        record.providerTaskId = providerTaskId;
        record.status = "provider_polling";
        record.leaseExpiresAt = leaseExpiresAt;
        record.updatedAt = new Date(this.now());
        return true;
    }

    updateProgress(id: string, workerId: string, progress: number): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId) return false;
        record.progress = Math.max(0, Math.min(100, Math.round(progress)));
        record.updatedAt = new Date(this.now());
        return true;
    }

    releaseForRetry(id: string, workerId: string, errorCode: string): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId || record.status === "cancelled") return false;
        record.status = "queued";
        record.attempt += 1;
        record.errorCode = errorCode;
        record.leaseOwner = undefined;
        record.leaseExpiresAt = undefined;
        record.updatedAt = new Date(this.now());
        return true;
    }

    complete(id: string, workerId: string, outputAssetId: string): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId || record.status === "cancelled") return false;
        record.status = "succeeded";
        record.progress = 100;
        record.outputAssetId = outputAssetId;
        record.leaseOwner = undefined;
        record.leaseExpiresAt = undefined;
        record.updatedAt = new Date(this.now());
        return true;
    }

    fail(id: string, workerId: string, errorCode: string): boolean {
        const record = this.records.get(id);
        if (!record || record.leaseOwner !== workerId || record.status === "cancelled") return false;
        record.status = "failed";
        record.errorCode = errorCode;
        record.leaseOwner = undefined;
        record.leaseExpiresAt = undefined;
        record.updatedAt = new Date(this.now());
        return true;
    }
}

function cloneGeneration(record: GenerationRecord): GenerationRecord {
    return {
        ...record,
        input: structuredClone(record.input),
        ...(record.leaseExpiresAt ? { leaseExpiresAt: new Date(record.leaseExpiresAt) } : {}),
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}
