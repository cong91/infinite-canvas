import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AssetRecord, AssetRepository } from "./repository.js";

export class PostgresAssetRepository implements AssetRepository {
    constructor(private readonly pool: Pool) {}
    async list(accountId: string, projectId?: string): Promise<AssetRecord[]> {
        const values: unknown[] = [accountId];
        const condition = projectId ? ` AND project_id = $2` : "";
        if (projectId) values.push(projectId);
        const result = await this.pool.query(`SELECT id, account_id, project_id, kind, object_key, provider_url, metadata, created_at FROM canvas_assets WHERE account_id = $1${condition} ORDER BY created_at DESC`, values);
        return result.rows.map(toAsset);
    }
    async get(accountId: string, id: string): Promise<AssetRecord | undefined> {
        const result = await this.pool.query("SELECT id, account_id, project_id, kind, object_key, provider_url, metadata, created_at FROM canvas_assets WHERE account_id = $1 AND id = $2", [accountId, id]);
        return result.rows[0] ? toAsset(result.rows[0]) : undefined;
    }
    async create(input: Omit<AssetRecord, "id" | "createdAt">): Promise<AssetRecord> {
        const result = await this.pool.query("INSERT INTO canvas_assets (id, account_id, project_id, kind, object_key, provider_url, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, account_id, project_id, kind, object_key, provider_url, metadata, created_at", [randomUUID(), input.accountId, input.projectId ?? null, input.kind, input.objectKey ?? null, input.providerUrl ?? null, input.metadata]);
        return toAsset(result.rows[0]);
    }
    async delete(accountId: string, id: string): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM canvas_assets WHERE account_id = $1 AND id = $2", [accountId, id]);
        return result.rowCount === 1;
    }
    async deleteByObjectKey(accountId: string, objectKey: string): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM canvas_assets WHERE account_id = $1 AND object_key = $2", [accountId, objectKey]);
        return (result.rowCount ?? 0) > 0;
    }
}

function toAsset(row: Record<string, unknown>): AssetRecord {
    return { id: String(row.id), accountId: String(row.account_id), ...(row.project_id ? { projectId: String(row.project_id) } : {}), kind: row.kind as AssetRecord["kind"], ...(row.object_key ? { objectKey: String(row.object_key) } : {}), ...(row.provider_url ? { providerUrl: String(row.provider_url) } : {}), metadata: row.metadata as Record<string, unknown>, createdAt: new Date(String(row.created_at)) };
}
