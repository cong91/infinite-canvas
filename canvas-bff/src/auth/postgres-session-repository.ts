import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { Sub2ApiIdentity } from "./sub2api-client.js";
import type { CanvasAccount, SessionRecord, SessionRepository } from "./session-service.js";

export class PostgresSessionRepository implements SessionRepository {
    constructor(private readonly pool: Pool, private readonly now: () => number = Date.now) {}

    nowMs(): number { return this.now(); }

    async upsertAccount(identity: Sub2ApiIdentity): Promise<CanvasAccount> {
        const id = randomUUID();
        const result = await this.pool.query(
            `INSERT INTO canvas_accounts (id, sub2api_user_id, display_name, email, status)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (sub2api_user_id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
             RETURNING id, sub2api_user_id, display_name, email, status`,
            [id, identity.sub2ApiUserId, identity.displayName, identity.email ?? null, identity.status],
        );
        return toAccount(result.rows[0]);
    }

    async createSession(account: CanvasAccount, sessionHash: string, expiresAt: Date): Promise<void> {
        await this.pool.query(
            `INSERT INTO canvas_sessions (session_hash, account_id, expires_at) VALUES ($1, $2, $3)`,
            [sessionHash, account.id, expiresAt],
        );
    }

    async getSession(sessionHash: string): Promise<SessionRecord | undefined> {
        const result = await this.pool.query(
            `SELECT s.session_hash, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
                    a.id, a.sub2api_user_id, a.display_name, a.email, a.status
             FROM canvas_sessions s JOIN canvas_accounts a ON a.id = s.account_id
             WHERE s.session_hash = $1`, [sessionHash],
        );
        const row = result.rows[0];
        return row ? {
            sessionHash: row.session_hash,
            account: toAccount(row),
            createdAt: new Date(row.created_at),
            lastSeenAt: new Date(row.last_seen_at),
            expiresAt: new Date(row.expires_at),
            ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at) } : {}),
        } : undefined;
    }

    async touchSession(sessionHash: string, lastSeenAt: Date): Promise<void> {
        await this.pool.query("UPDATE canvas_sessions SET last_seen_at = $2 WHERE session_hash = $1", [sessionHash, lastSeenAt]);
    }

    async revokeSession(sessionHash: string, revokedAt: Date): Promise<boolean> {
        const result = await this.pool.query("UPDATE canvas_sessions SET revoked_at = $2 WHERE session_hash = $1 AND revoked_at IS NULL", [sessionHash, revokedAt]);
        return result.rowCount === 1;
    }

    async containsRawToken(token: string): Promise<boolean> {
        const result = await this.pool.query("SELECT 1 FROM canvas_sessions WHERE session_hash = $1", [token]);
        return result.rowCount === 1;
    }
}

function toAccount(row: Record<string, unknown>): CanvasAccount {
    return {
        id: String(row.id),
        sub2ApiUserId: String(row.sub2api_user_id),
        displayName: String(row.display_name),
        ...(row.email ? { email: String(row.email) } : {}),
        status: String(row.status),
    };
}
