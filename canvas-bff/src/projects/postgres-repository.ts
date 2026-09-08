import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ProjectRecord, ProjectRepository } from "./repository.js";

export class PostgresProjectRepository implements ProjectRepository {
    constructor(private readonly pool: Pool) {}

    async list(accountId: string): Promise<ProjectRecord[]> {
        const result = await this.pool.query("SELECT id, account_id, name, data, revision, created_at, updated_at FROM canvas_projects WHERE account_id = $1 ORDER BY updated_at DESC", [accountId]);
        return result.rows.map(toProject);
    }

    async get(accountId: string, id: string): Promise<ProjectRecord | undefined> {
        const result = await this.pool.query("SELECT id, account_id, name, data, revision, created_at, updated_at FROM canvas_projects WHERE account_id = $1 AND id = $2", [accountId, id]);
        return result.rows[0] ? toProject(result.rows[0]) : undefined;
    }

    async create(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "revision">): Promise<ProjectRecord> {
        const result = await this.pool.query("INSERT INTO canvas_projects (id, account_id, name, data) VALUES ($1, $2, $3, $4) RETURNING id, account_id, name, data, revision, created_at, updated_at", [randomUUID(), input.accountId, input.name, input.data]);
        return toProject(result.rows[0]);
    }

    async update(accountId: string, id: string, patch: { name?: string; data?: Record<string, unknown>; revision?: number }): Promise<ProjectRecord | undefined> {
        const fields: string[] = [];
        const values: unknown[] = [accountId, id];
        if (patch.name !== undefined) { values.push(patch.name); fields.push(`name = $${values.length}`); }
        if (patch.data !== undefined) { values.push(patch.data); fields.push(`data = $${values.length}`); }
        if (!fields.length) return this.get(accountId, id);
        values.push(patch.revision ?? null);
        const revisionIndex = values.length;
        const result = await this.pool.query(`UPDATE canvas_projects SET ${fields.join(", ")}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND id = $2 AND ($${revisionIndex}::integer IS NULL OR revision = $${revisionIndex}) RETURNING id, account_id, name, data, revision, created_at, updated_at`, values);
        return result.rows[0] ? toProject(result.rows[0]) : undefined;
    }

    async delete(accountId: string, id: string): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM canvas_projects WHERE account_id = $1 AND id = $2", [accountId, id]);
        return result.rowCount === 1;
    }
}

function toProject(row: Record<string, unknown>): ProjectRecord {
    return { id: String(row.id), accountId: String(row.account_id), name: String(row.name), data: row.data as Record<string, unknown>, revision: Number(row.revision), createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)) };
}
