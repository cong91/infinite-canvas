import type { AssetRepository } from "../assets/repository.js";
import type { ObjectStorage, StoredObjectSummary } from "./object-storage.js";

export type StorageRetentionOptions = {
    storage: ObjectStorage;
    assets: AssetRepository;
    maxBytes: number;
};

export class ObjectStorageRetention {
    private readonly storage: ObjectStorage;
    private readonly assets: AssetRepository;
    private readonly maxBytes: number;

    constructor(options: StorageRetentionOptions) {
        if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error("Storage retention max bytes must be a positive integer");
        this.storage = options.storage;
        this.assets = options.assets;
        this.maxBytes = options.maxBytes;
    }

    async enforce(options: { protectedKeys?: string[] } = {}): Promise<StoredObjectSummary[]> {
        const objects = await this.storage.listAll();
        let totalBytes = objects.reduce((total, object) => total + object.size, 0);
        if (totalBytes <= this.maxBytes) return [];
        const protectedKeys = new Set(options.protectedKeys ?? []);
        const deleted: StoredObjectSummary[] = [];
        const oldestFirst = [...objects].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        for (const object of oldestFirst) {
            if (totalBytes <= this.maxBytes) break;
            if (protectedKeys.has(object.key)) continue;
            if (!(await this.storage.delete(object.accountId, object.key))) continue;
            totalBytes -= object.size;
            await this.assets.deleteByObjectKey(object.accountId, object.key);
            deleted.push(object);
        }
        return deleted;
    }
}
