import { createHash } from "node:crypto";

import type { AssetRepository } from "../assets/repository.js";
import type { ProviderRepository } from "../providers/repository.js";
import { isSeedanceModel } from "../providers/generation-intent.js";
import type { GenerationRecord, GenerationRepository, ProviderTrace } from "../generations/repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { ObjectStorageRetention } from "../storage/retention.js";
import { Injectable, Logger } from "@nestjs/common";

export type ProviderResult = (
    | { status: "succeeded"; data: Buffer | Uint8Array | string; contentType: string; providerUrl?: string }
    | { status: "pending"; providerTaskId: string; progress?: number }
    | { status: "failed"; retryable: boolean; errorCode: string }
) & ProviderTrace;

export type GenerationProvider = {
    start(generation: GenerationRecord): Promise<ProviderResult>;
    poll(generation: GenerationRecord): Promise<ProviderResult>;
};

export class GenerationWorker {
    private readonly generations: GenerationRepository;
    private readonly assets: AssetRepository;
    private readonly storage: ObjectStorage;
    private readonly provider: GenerationProvider;
    private readonly workerId: string;
    private readonly leaseMs: number;
    private readonly maxAttempts: number;
    private readonly retryBackoffBaseMs: number;
    private readonly retryBackoffMaxMs: number;
    private readonly now: () => number;
    private readonly retention?: ObjectStorageRetention;
    private readonly logger = new Logger(GenerationWorker.name);

    constructor(options: { generationRepository: GenerationRepository; assetRepository: AssetRepository; objectStorage: ObjectStorage; provider: GenerationProvider; workerId: string; leaseMs?: number; maxAttempts?: number; retryBackoffBaseMs?: number; retryBackoffMaxMs?: number; now?: () => number; retention?: ObjectStorageRetention }) {
        this.generations = options.generationRepository;
        this.assets = options.assetRepository;
        this.storage = options.objectStorage;
        this.provider = options.provider;
        this.workerId = options.workerId;
        this.leaseMs = options.leaseMs ?? 30_000;
        this.maxAttempts = options.maxAttempts ?? 5;
        this.retryBackoffBaseMs = options.retryBackoffBaseMs ?? 30_000;
        this.retryBackoffMaxMs = options.retryBackoffMaxMs ?? 480_000;
        this.now = options.now ?? Date.now;
        this.retention = options.retention;
    }

    async runOnce(): Promise<GenerationRecord | undefined> {
        const now = new Date(this.now());
        const generation = await this.generations.claimNext(this.workerId, now, this.leaseMs);
        if (!generation) {
            await this.enforceRetention();
            return undefined;
        }
        if (generation.status === "cancelled") return undefined;
        const result = generation.providerTaskId
            ? await this.provider.poll(generation)
            : await this.provider.start(await this.hostSeedanceReferences(generation));
        const trace = providerTrace(result);
        if (trace && (trace.providerRequestId !== generation.providerRequestId || trace.providerClientRequestId !== generation.providerClientRequestId))
            await this.generations.setProviderTrace(generation.id, this.workerId, trace);
        const line = `generation=${generation.id} attempt=${generation.attempt} kind=${generation.kind} model=${String(generation.input.model ?? "")} result=${result.status}${result.status === "failed" ? ` error=${result.errorCode} retryable=${result.retryable}` : ""} upstream_request=${trace?.providerRequestId ?? generation.providerRequestId ?? "-"} upstream_client=${trace?.providerClientRequestId ?? generation.providerClientRequestId ?? "-"}`;
        if (result.status === "pending") this.logger.debug(line);
        else this.logger.log(line);
        if (result.status === "pending") {
            await this.generations.setProviderTask(generation.id, result.providerTaskId, this.workerId, new Date(this.now() + this.leaseMs));
            if (result.progress !== undefined) await this.generations.updateProgress(generation.id, this.workerId, result.progress);
            return this.generations.get(generation.accountId, generation.id);
        }
        if (result.status === "failed") {
            if (!result.retryable) await this.generations.fail(generation.id, this.workerId, result.errorCode);
            else if (generation.attempt + 1 >= this.maxAttempts) await this.generations.fail(generation.id, this.workerId, "MAX_RETRY_EXCEEDED");
            else await this.generations.releaseForRetry(generation.id, this.workerId, result.errorCode, new Date(this.now() + this.retryBackoffMs(generation.attempt)));
            return this.generations.get(generation.accountId, generation.id);
        }
        const stored = await this.storage.put({ accountId: generation.accountId, data: result.data, contentType: result.contentType });
        const asset = await this.assets.create({
            accountId: generation.accountId,
            projectId: generation.projectId,
            kind: generation.kind === "text" ? "file" : generation.kind,
            objectKey: stored.key,
            ...(result.providerUrl ? { providerUrl: result.providerUrl } : {}),
            metadata: { generationId: generation.id, contentType: stored.contentType, size: stored.size, checksum: stored.checksum },
        });
        await this.generations.complete(generation.id, this.workerId, asset.id);
        await this.enforceRetention([stored.key]);
        return this.generations.get(generation.accountId, generation.id);
    }

    /**
     * Seedance rejects `data:` references ("only http/https allowed"), so local
     * canvas images are stored once (checksum key) and sent as a signed URL.
     */
    private async hostSeedanceReferences(generation: GenerationRecord): Promise<GenerationRecord> {
        if (generation.kind !== "video" || !isSeedanceModel(String(generation.input.model ?? ""))) return generation;
        const references = generation.input.referenceImages;
        if (!Array.isArray(references)) return generation;
        if (!references.some((item) => typeof item === "string" && item.startsWith("data:"))) return generation;
        const hosted = await Promise.all(
            references.map(async (item) => {
                if (typeof item !== "string" || !item.startsWith("data:")) return item;
                const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(item);
                if (!match) return item;
                const data = Buffer.from(match[2], "base64");
                const key = `accounts/${generation.accountId}/references/${createHash("sha256").update(data).digest("hex")}`;
                await this.storage.put({ accountId: generation.accountId, data, contentType: match[1], key });
                return (await this.storage.createSignedReadUrl(generation.accountId, key, 3_600)) || item;
            }),
        );
        return { ...generation, input: { ...generation.input, referenceImages: hosted } };
    }

    private retryBackoffMs(attempt: number): number {
        return Math.min(this.retryBackoffBaseMs * 2 ** attempt, this.retryBackoffMaxMs);
    }

    private async enforceRetention(protectedKeys: string[] = []): Promise<void> {
        if (!this.retention) return;
        try {
            await this.retention.enforce({ protectedKeys });
        } catch (error) {
            console.warn("Canvas storage retention failed", error);
        }
    }
}

function providerTrace(result: ProviderResult): ProviderTrace | undefined {
    return result.providerRequestId || result.providerClientRequestId
        ? { ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}), ...(result.providerClientRequestId ? { providerClientRequestId: result.providerClientRequestId } : {}) }
        : undefined;
}

@Injectable()
export class GenerationWorkerLoop {
    private timer: ReturnType<typeof setInterval> | undefined;
    private running = false;

    constructor(private readonly worker: GenerationWorker, private readonly options: { intervalMs?: number } = {}) {}

    start(): void {
        if (this.timer) return;
        const intervalMs = this.options.intervalMs ?? 1_000;
        this.timer = setInterval(() => void this.tick().catch((error) => console.warn("Canvas generation worker tick failed", error)), intervalMs);
        this.timer.unref?.();
        void this.tick().catch((error) => console.warn("Canvas generation worker tick failed", error));
    }

    async tick(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.worker.runOnce();
        } finally {
            this.running = false;
        }
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}
