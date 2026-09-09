import { createHash, randomBytes } from "node:crypto";

import type { Sub2ApiIdentity } from "./sub2api-client.js";

export const SESSION_COOKIE_NAME = "canvas_session";
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
export const UPSTREAM_ASSERTION_TTL_MS = 10 * 60 * 1_000;

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

export type SessionRecord = CanvasSession & { sessionHash: string; revokedAt?: Date };
type UpstreamAssertion = { token: string; expiresAt: number };

export interface SessionRepository {
    nowMs(): number;
    upsertAccount(identity: Sub2ApiIdentity): CanvasAccount | Promise<CanvasAccount>;
    createSession(account: CanvasAccount, sessionHash: string, expiresAt: Date): void | Promise<void>;
    getSession(sessionHash: string): SessionRecord | undefined | Promise<SessionRecord | undefined>;
    touchSession(sessionHash: string, lastSeenAt: Date): void | Promise<void>;
    revokeSession(sessionHash: string, revokedAt: Date): boolean | Promise<boolean>;
    containsRawToken(token: string): boolean | Promise<boolean>;
}

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
    private readonly repository: SessionRepository;
    // The Sub2API assertion is held only in process memory for user-facing catalog calls.
    private readonly upstreamAssertions = new Map<string, UpstreamAssertion>();
    private readonly upstreamAssertionTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly sessionTtlMs: number;
    private readonly now: () => number;

    constructor(repository: SessionRepository, options: { sessionTtlMs?: number; now?: () => number } = {}) {
        this.repository = repository;
        this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
        this.now = options.now ?? (() => repository.nowMs());
    }

    async upsertAccount(identity: Sub2ApiIdentity): Promise<CanvasAccount> {
        return this.repository.upsertAccount(identity);
    }

    async createSession(account: CanvasAccount, upstreamAccessToken?: string): Promise<{ token: string; session: CanvasSession }> {
        const token = randomBytes(32).toString("base64url");
        const now = new Date(this.now());
        const session: CanvasSession = {
            account: { ...account },
            createdAt: now,
            lastSeenAt: now,
            expiresAt: new Date(now.getTime() + this.sessionTtlMs),
        };
        const sessionHash = hashToken(token);
        await this.repository.createSession(account, sessionHash, session.expiresAt);
        if (upstreamAccessToken?.trim()) {
            const expiresAt = Math.min(session.expiresAt.getTime(), now.getTime() + UPSTREAM_ASSERTION_TTL_MS);
            this.upstreamAssertions.set(sessionHash, { token: upstreamAccessToken.trim(), expiresAt });
            const timer = setTimeout(() => this.clearUpstreamAssertion(sessionHash), Math.max(0, expiresAt - this.now()));
            timer.unref?.();
            this.upstreamAssertionTimers.set(sessionHash, timer);
        }
        return { token, session };
    }

    async resolveSession(token: string): Promise<CanvasSession | null> {
        if (!token.trim()) return null;
        const sessionHash = hashToken(token);
        const record = await this.repository.getSession(sessionHash);
        if (!record || record.revokedAt || record.expiresAt.getTime() <= this.now()) {
            this.clearUpstreamAssertion(sessionHash);
            return null;
        }
        const lastSeenAt = new Date(this.now());
        await this.repository.touchSession(sessionHash, lastSeenAt);
        return {
            account: { ...record.account },
            createdAt: new Date(record.createdAt),
            lastSeenAt,
            expiresAt: new Date(record.expiresAt),
        };
    }

    async revokeSession(token: string): Promise<boolean> {
        if (!token.trim()) return false;
        const sessionHash = hashToken(token);
        this.clearUpstreamAssertion(sessionHash);
        return this.repository.revokeSession(sessionHash, new Date(this.now()));
    }

    async getUpstreamAccessToken(canvasSessionToken: string): Promise<string | null> {
        if (!canvasSessionToken.trim() || !(await this.resolveSession(canvasSessionToken))) return null;
        const sessionHash = hashToken(canvasSessionToken);
        const assertion = this.upstreamAssertions.get(sessionHash);
        if (!assertion || assertion.expiresAt <= this.now()) {
            this.clearUpstreamAssertion(sessionHash);
            return null;
        }
        return assertion.token;
    }

    private clearUpstreamAssertion(sessionHash: string): void {
        this.upstreamAssertions.delete(sessionHash);
        const timer = this.upstreamAssertionTimers.get(sessionHash);
        if (timer) clearTimeout(timer);
        this.upstreamAssertionTimers.delete(sessionHash);
    }
}

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
