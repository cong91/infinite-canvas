import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { GenerationRecord, GenerationRepository } from "./repository.js";

const columns = "id, account_id, project_id, provider_id, kind, input, input_hash, client_request_id, status, progress, provider_task_id, attempt, lease_owner, lease_expires_at, error_code, output_asset_id, created_at, updated_at";
const baseQuery = `SELECT ${columns} FROM canvas_generations`;

export class PostgresGenerationRepository implements GenerationRepository {
    constructor(private readonly pool: Pool) {}

    async list(accountId: string): Promise<GenerationRecord[]> {
        const result = await this.pool.query(`${baseQuery} WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]);
        return result.rows.map(toGeneration);
    }

    async get(accountId: string, id: string): Promise<GenerationRecord | undefined> {
        const result = await this.pool.query(`${baseQuery} WHERE account_id = $1 AND id = $2`, [accountId, id]);
        return result.rows[0] ? toGeneration(result.rows[0]) : undefined;
    }

    async findByClientRequest(accountId: string, clientRequestId: string): Promise<GenerationRecord | undefined> {
        const result = await this.pool.query(`${baseQuery} WHERE account_id = $1 AND client_request_id = $2`, [accountId, clientRequestId]);
        return result.rows[0] ? toGeneration(result.rows[0]) : undefined;
    }

    async create(input: Omit<GenerationRecord, "id" | "createdAt" | "updatedAt">): Promise<GenerationRecord> {
        const result = await this.pool.query(
            `INSERT INTO canvas_generations (id, account_id, project_id, provider_id, kind, input, input_hash, client_request_id, status, progress, provider_task_id, attempt, lease_owner, lease_expires_at, error_code, output_asset_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${columns}`,
            [randomUUID(), input.accountId, input.projectId, input.providerId, input.kind, input.input, input.inputHash, input.clientRequestId, input.status, input.progress, input.providerTaskId ?? null, input.attempt, input.leaseOwner ?? null, input.leaseExpiresAt ?? null, input.errorCode ?? null, input.outputAssetId ?? null],
        );
        return toGeneration(result.rows[0]);
    }

    async cancel(accountId: string, id: string): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND id = $2 AND status NOT IN ('succeeded','failed','cancelled')", [accountId, id]);
        return result.rowCount === 1;
    }

    async claimNext(workerId: string, now: Date, leaseMs: number): Promise<GenerationRecord | undefined> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const selected = await client.query(`${baseQuery} WHERE status = ANY($1::text[]) AND (lease_expires_at IS NULL OR lease_expires_at <= $2) ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`, [["queued", "running", "provider_polling"], now]);
            const row = selected.rows[0];
            if (!row) {
                await client.query("COMMIT");
                return undefined;
            }
            const updated = await client.query(`UPDATE canvas_generations SET status = CASE WHEN provider_task_id IS NULL THEN 'running' ELSE 'provider_polling' END, lease_owner = $2, lease_expires_at = $3, updated_at = $4 WHERE id = $1 RETURNING ${columns}`, [row.id, workerId, new Date(now.getTime() + leaseMs), now]);
            await client.query("COMMIT");
            return toGeneration(updated.rows[0]);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async heartbeat(id: string, workerId: string, expiresAt: Date): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET lease_expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $2 AND status <> 'cancelled'", [id, workerId, expiresAt]);
        return result.rowCount === 1;
    }

    async setProviderTask(id: string, providerTaskId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET provider_task_id = $2, status = 'provider_polling', lease_expires_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $3", [id, providerTaskId, workerId, leaseExpiresAt]);
        return result.rowCount === 1;
    }

    async updateProgress(id: string, workerId: string, progress: number): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET progress = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $2", [id, workerId, Math.max(0, Math.min(100, Math.round(progress)))]);
        return result.rowCount === 1;
    }

    async releaseForRetry(id: string, workerId: string, errorCode: string): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET status = 'queued', attempt = attempt + 1, error_code = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $2 AND status <> 'cancelled'", [id, workerId, errorCode]);
        return result.rowCount === 1;
    }

    async complete(id: string, workerId: string, outputAssetId: string): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET status = 'succeeded', progress = 100, output_asset_id = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $2 AND status <> 'cancelled'", [id, workerId, outputAssetId]);
        return result.rowCount === 1;
    }

    async fail(id: string, workerId: string, errorCode: string): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_generations SET status = 'failed', error_code = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND lease_owner = $2 AND status <> 'cancelled'", [id, workerId, errorCode]);
        return result.rowCount === 1;
    }
}

function toGeneration(row: Record<string, unknown>): GenerationRecord {
    return {
        id: String(row.id),
        accountId: String(row.account_id),
        projectId: String(row.project_id),
        providerId: String(row.provider_id),
        kind: row.kind as GenerationRecord["kind"],
        input: row.input as Record<string, unknown>,
        inputHash: String(row.input_hash),
        clientRequestId: String(row.client_request_id),
        status: row.status as GenerationRecord["status"],
        progress: Number(row.progress),
        ...(row.provider_task_id ? { providerTaskId: String(row.provider_task_id) } : {}),
        attempt: Number(row.attempt),
        ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}),
        ...(row.lease_expires_at ? { leaseExpiresAt: new Date(String(row.lease_expires_at)) } : {}),
        ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
        ...(row.output_asset_id ? { outputAssetId: String(row.output_asset_id) } : {}),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
    };
}
