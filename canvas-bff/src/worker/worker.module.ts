import { Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { ASSET_REPOSITORY, BFF_CONFIG, DATABASE_POOL, GENERATION_PROVIDER, GENERATION_REPOSITORY, GENERATION_WORKER, OBJECT_STORAGE, PROVIDER_REPOSITORY, PROVIDER_SECRET_BOX, STORAGE_RETENTION } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import type { AssetRepository } from "../assets/repository.js";
import type { GenerationRepository } from "../generations/repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { ObjectStorageRetention } from "../storage/retention.js";
import type { ProviderRepository } from "../providers/repository.js";
import { ProviderSecretBox } from "../crypto/secret-box.js";
import { HttpGenerationProvider } from "../providers/http-generation-provider.js";
import { GenerationWorker, GenerationWorkerLoop, type GenerationProvider } from "./generation-worker.js";
import { AssetsModule } from "../assets/assets.module.js";
import { GenerationsModule } from "../generations/generations.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { StorageModule } from "../storage/storage.module.js";

@Injectable()
class WorkerLifecycle implements OnModuleInit, OnModuleDestroy {
    constructor(@Inject(GenerationWorkerLoop) private readonly loop: GenerationWorkerLoop, @Inject(BFF_CONFIG) private readonly config: CanvasBffConfig) {}
    onModuleInit() { if (this.config.environment !== "test") this.loop.start(); }
    onModuleDestroy() { this.loop.stop(); }
}

@Module({
    imports: [AssetsModule, GenerationsModule, ProvidersModule, StorageModule],
    providers: [
        { provide: STORAGE_RETENTION, useFactory: (config: CanvasBffConfig, storage: ObjectStorage, assets: AssetRepository) => config.storageRetentionMaxBytes ? new ObjectStorageRetention({ storage, assets, maxBytes: config.storageRetentionMaxBytes }) : undefined, inject: [BFF_CONFIG, OBJECT_STORAGE, ASSET_REPOSITORY] },
        { provide: GENERATION_PROVIDER, useFactory: (config: CanvasBffConfig, providers: ProviderRepository, secretBox: ProviderSecretBox): GenerationProvider => new HttpGenerationProvider({ baseUrl: config.sub2ApiBaseUrl, providers, secretBox }), inject: [BFF_CONFIG, PROVIDER_REPOSITORY, PROVIDER_SECRET_BOX] },
        { provide: GENERATION_WORKER, useFactory: (generations: GenerationRepository, assets: AssetRepository, storage: ObjectStorage, provider: GenerationProvider, retention?: ObjectStorageRetention) => new GenerationWorker({ generationRepository: generations, assetRepository: assets, objectStorage: storage, provider, workerId: process.env.CANVAS_WORKER_ID ?? `canvas-worker-${randomUUID()}`, retention }), inject: [GENERATION_REPOSITORY, ASSET_REPOSITORY, OBJECT_STORAGE, GENERATION_PROVIDER, { token: STORAGE_RETENTION, optional: true }] },
        { provide: GenerationWorkerLoop, useFactory: (worker: GenerationWorker) => new GenerationWorkerLoop(worker, { intervalMs: Number(process.env.CANVAS_WORKER_INTERVAL_MS ?? 1_000) }), inject: [GENERATION_WORKER] },
        WorkerLifecycle,
    ],
    exports: [GENERATION_PROVIDER, GENERATION_WORKER, GenerationWorkerLoop],
})
export class WorkerModule {}
