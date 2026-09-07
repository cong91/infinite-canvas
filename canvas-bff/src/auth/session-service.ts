import { createHash, randomBytes } from "node:crypto";

import type { Sub2ApiIdentity } from "./sub2api-client.js";

export const SESSION_COOKIE_NAME = "canvas_session";
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

export type CanvasAccount = {
    id: string;
    sub2ApiUserId: string;
    displayName: string;
    email?: string;
    status: string;
};

export type CanvasSession = {
    account: CanvasAccount;
    expiresAt: Date;
    createdAt: Date;
    lastSeenAt: Date;
};

type SessionRecord = CanvasSession & { sessionHash: string; revokedAt?: Date };

export class InMemorySessionRepository {
    private readonly accounts = new Map<string, CanvasAccount>();
    private readonly sessions = new Map<string, SessionRecord>();
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    nowMs(): number {
        return this.now();
    }

    upsertAccount(identity: Sub2ApiIdentity): CanvasAccount {
        const existing = this.accounts.get(identity.sub2ApiUserId);
        const account: CanvasAccount = {
            id: existing?.id ?? `canvas-account-${randomBytes(16).toString("hex")}`,
            sub2ApiUserId: identity.sub2ApiUserId,
            displayName: identity.displayName,
            ...(identity.email ? { email: identity.email } : {}),
            status: identity.status,
        };
        this.accounts.set(account.sub2ApiUserId, account);
        return { ...account };
    }

    createSession(account: CanvasAccount, sessionHash: string, expiresAt: Date): void {
        const now = new Date(this.now());
        this.sessions.set(sessionHash, {
            sessionHash,
            account: { ...account },
            createdAt: now,
            lastSeenAt: now,
            expiresAt,
        });
    }

    getSession(sessionHash: string): SessionRecord | undefined {
        const record = this.sessions.get(sessionHash);
        return record ? { ...record, account: { ...record.account } } : undefined;
    }

    touchSession(sessionHash: string, lastSeenAt: Date): void {
        const record = this.sessions.get(sessionHash);
        if (record) record.lastSeenAt = lastSeenAt;
    }

    revokeSession(sessionHash: string, revokedAt: Date): boolean {
        const record = this.sessions.get(sessionHash);
        if (!record) return false;
        record.revokedAt = revokedAt;
        return true;
    }

    containsRawToken(token: string): boolean {
        return this.sessions.has(token);
    }
}

export class SessionService {
    private readonly repository: InMemorySessionRepository;
    private readonly sessionTtlMs: number;
    private readonly now: () => number;

    constructor(repository: InMemorySessionRepository, options: { sessionTtlMs?: number; now?: () => number } = {}) {
        this.repository = repository;
        this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
        this.now = options.now ?? (() => repository.nowMs());
    }

    upsertAccount(identity: Sub2ApiIdentity): CanvasAccount {
        return this.repository.upsertAccount(identity);
    }

    createSession(account: CanvasAccount): { token: string; session: CanvasSession } {
        const token = randomBytes(32).toString("base64url");
        const now = new Date(this.now());
        const session: CanvasSession = {
            account: { ...account },
            createdAt: now,
            lastSeenAt: now,
            expiresAt: new Date(now.getTime() + this.sessionTtlMs),
        };
        this.repository.createSession(account, hashToken(token), session.expiresAt);
        return { token, session };
    }

    resolveSession(token: string): CanvasSession | null {
        if (!token.trim()) return null;
        const sessionHash = hashToken(token);
        const record = this.repository.getSession(sessionHash);
        if (!record || record.revokedAt || record.expiresAt.getTime() <= this.now()) return null;
        const lastSeenAt = new Date(this.now());
        this.repository.touchSession(sessionHash, lastSeenAt);
        return {
            account: { ...record.account },
            createdAt: new Date(record.createdAt),
            lastSeenAt,
            expiresAt: new Date(record.expiresAt),
        };
    }

    revokeSession(token: string): boolean {
        if (!token.trim()) return false;
        return this.repository.revokeSession(hashToken(token), new Date(this.now()));
    }
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
