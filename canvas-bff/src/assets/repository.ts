import { randomUUID } from "node:crypto";

export type AssetRecord = {
    id: string;
    accountId: string;
    projectId?: string;
    kind: "image" | "video" | "audio" | "file";
    objectKey?: string;
    providerUrl?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
};

export interface AssetRepository {
    list(accountId: string, projectId?: string): AssetRecord[] | Promise<AssetRecord[]>;
    get(accountId: string, id: string): AssetRecord | undefined | Promise<AssetRecord | undefined>;
    create(input: Omit<AssetRecord, "id" | "createdAt">): AssetRecord | Promise<AssetRecord>;
    delete(accountId: string, id: string): boolean | Promise<boolean>;
    deleteByObjectKey(accountId: string, objectKey: string): boolean | Promise<boolean>;
}

export class InMemoryAssetRepository implements AssetRepository {
    private readonly records = new Map<string, AssetRecord>();

    list(accountId: string, projectId?: string): AssetRecord[] {
        return [...this.records.values()]
            .filter((record) => record.accountId === accountId && (projectId === undefined || record.projectId === projectId))
            .map(cloneAsset);
    }

    get(accountId: string, id: string): AssetRecord | undefined {
        const record = this.records.get(id);
        return record?.accountId === accountId ? cloneAsset(record) : undefined;
    }

    create(input: Omit<AssetRecord, "id" | "createdAt">): AssetRecord {
        const record: AssetRecord = { ...input, id: randomUUID(), createdAt: new Date() };
        this.records.set(record.id, record);
        return cloneAsset(record);
    }

    delete(accountId: string, id: string): boolean {
        const record = this.records.get(id);
        return Boolean(record?.accountId === accountId && this.records.delete(id));
    }

    deleteByObjectKey(accountId: string, objectKey: string): boolean {
        let deleted = false;
        for (const [id, record] of this.records) {
            if (record.accountId === accountId && record.objectKey === objectKey) {
                deleted = this.records.delete(id) || deleted;
            }
        }
        return deleted;
    }
}

function cloneAsset(record: AssetRecord): AssetRecord {
    return { ...record, metadata: structuredClone(record.metadata), createdAt: new Date(record.createdAt) };
}
