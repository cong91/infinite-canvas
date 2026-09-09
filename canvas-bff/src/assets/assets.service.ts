import { Inject, Injectable } from "@nestjs/common";

import { ASSET_REPOSITORY, OBJECT_STORAGE, PROJECT_REPOSITORY } from "../app.tokens.js";
import { HttpError } from "../http/errors.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { AssetRecord, AssetRepository } from "./repository.js";

@Injectable()
export class AssetsService {
    constructor(@Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository, @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

    async list(accountId: string, projectId?: string) { if (projectId) await this.assertProject(accountId, projectId); return Promise.all((await this.assets.list(accountId, projectId)).map((asset) => this.toPublic(asset, accountId))); }
    async create(accountId: string, input: Omit<AssetRecord, "id" | "createdAt" | "accountId">) { if (input.projectId) await this.assertProject(accountId, input.projectId); return this.toPublic(await this.assets.create({ accountId, ...input }), accountId); }
    async get(accountId: string, id: string) { const asset = await this.assets.get(accountId, id); if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset was not found"); return this.toPublic(asset, accountId); }
    async remove(accountId: string, id: string) { if (!(await this.assets.delete(accountId, id))) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset was not found"); }

    private async assertProject(accountId: string, projectId: string) { if (!(await this.projects.get(accountId, projectId))) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found"); }
    private async toPublic(asset: AssetRecord, accountId: string) { const signedUrl = asset.objectKey ? await this.storage.createSignedReadUrl(accountId, asset.objectKey, 300) : ""; return { ...asset, ...(signedUrl ? { signedUrl } : {}), createdAt: asset.createdAt.toISOString() }; }
}
