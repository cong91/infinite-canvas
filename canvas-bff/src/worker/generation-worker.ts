import type { AssetRepository } from "../assets/repository.js";
import type { ProviderRepository } from "../providers/repository.js";
import type { GenerationRecord, GenerationRepository } from "../generations/repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { ObjectStorageRetention } from "../storage/retention.js";
import { Injectable } from "@nestjs/common";

export type ProviderResult =
    | { status: "succeeded"; data: Buffer | Uint8Array | string; contentType: string; providerUrl?: string }
    | { status: "pending"; providerTaskId: string; progress?: number }
    | { status: "failed"; retryable: boolean; errorCode: string };

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
    private readonly now: () => number;
    private readonly retention?: ObjectStorageRetention;

    constructor(options: { generationRepository: GenerationRepository; assetRepository: AssetRepository; objectStorage: ObjectStorage; provider: GenerationProvider; workerId: string; leaseMs?: number; now?: () => number; retention?: ObjectStorageRetention }) {
        this.generations = options.generationRepository;
        this.assets = options.assetRepository;
        this.storage = options.objectStorage;
        this.provider = options.provider;
        this.workerId = options.workerId;
        this.leaseMs = options.leaseMs ?? 30_000;
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
        const result = generation.providerTaskId ? await this.provider.poll(generation) : await this.provider.start(generation);
        if (result.status === "pending") {
            await this.generations.setProviderTask(generation.id, result.providerTaskId, this.workerId, new Date(this.now() + this.leaseMs));
            if (result.progress !== undefined) await this.generations.updateProgress(generation.id, this.workerId, result.progress);
            return this.generations.get(generation.accountId, generation.id);
        }
        if (result.status === "failed") {
            if (result.retryable) await this.generations.releaseForRetry(generation.id, this.workerId, result.errorCode);
            else await this.generations.fail(generation.id, this.workerId, result.errorCode);
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

    private async enforceRetention(protectedKeys: string[] = []): Promise<void> {
        if (!this.retention) return;
        try {
            await this.retention.enforce({ protectedKeys });
        } catch (error) {
            console.warn("Canvas storage retention failed", error);
        }
    }
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
