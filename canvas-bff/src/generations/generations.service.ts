import { Inject, Injectable } from "@nestjs/common";

import { ASSET_REPOSITORY, GENERATION_REPOSITORY, GENERATION_SERVICE, OBJECT_STORAGE } from "../app.tokens.js";
import type { AssetRepository } from "../assets/repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { CanvasAccount } from "../auth/session-service.js";
import { GenerationService, type CreateGenerationInput } from "./generation-domain.service.js";
import type { GenerationRecord } from "./repository.js";
import { HttpError } from "../http/errors.js";

@Injectable()
export class GenerationsService {
    constructor(
        @Inject(GENERATION_SERVICE) private readonly generations: GenerationService,
        @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository,
        @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    ) {}

    list(account: CanvasAccount): Promise<unknown[]> { return this.publicList(account.id); }
    async create(account: CanvasAccount, input: CreateGenerationInput) { return this.toPublic(await this.generations.create(account.id, input), account.id); }
    async get(account: CanvasAccount, id: string) { const record = await this.generations.get(account.id, id); if (!record) return undefined; return this.toPublic(record, account.id); }
    async cancel(account: CanvasAccount, id: string) { if (!(await this.generations.get(account.id, id))) return undefined; if (!(await this.generations.cancel(account.id, id))) throw new HttpError(409, "GENERATION_NOT_CANCELLABLE", "Generation cannot be cancelled"); return this.get(account, id); }

    private async publicList(accountId: string) { return Promise.all((await this.generations.list(accountId)).map((record) => this.toPublic(record, accountId))); }
    private async toPublic(record: GenerationRecord, accountId: string) {
        const asset = record.outputAssetId ? await this.assets.get(accountId, record.outputAssetId) : undefined;
        const signedUrl = asset?.objectKey ? await this.storage.createSignedReadUrl(accountId, asset.objectKey, 300) : undefined;
        return { id: record.id, projectId: record.projectId, providerId: record.providerId, kind: record.kind, status: record.status, progress: record.progress, attempt: record.attempt, ...(record.errorCode ? { errorCode: record.errorCode } : {}), ...(record.outputAssetId ? { outputAssetId: record.outputAssetId } : {}), ...(asset ? { asset: { id: asset.id, kind: asset.kind, providerUrl: asset.providerUrl, metadata: asset.metadata, ...(signedUrl ? { signedUrl } : {}) } } : {}), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
    }
}
