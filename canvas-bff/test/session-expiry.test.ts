import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySessionRepository, SessionService, type CanvasAccount } from "../src/auth/session-service.js";

const account: CanvasAccount = {
    id: "canvas-account-id",
    sub2ApiUserId: "sub2api-user-id",
    displayName: "Fixture User",
    email: "fixture@example.test",
    status: "active",
};

test("session expires at its server-side deadline", () => {
    let now = 1_000;
    const repository = new InMemorySessionRepository(() => now);
    const service = new SessionService(repository, { sessionTtlMs: 1_000, now: () => now });
    const created = service.createSession(account);

    assert.equal(service.resolveSession(created.token)?.account.id, account.id);
    now = 2_000;
    assert.equal(service.resolveSession(created.token), null);
});

test("revoked sessions cannot be resolved and session records never retain an assertion token", () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository, { sessionTtlMs: 10_000 });
    const created = service.createSession(account);

    assert.equal(service.revokeSession(created.token), true);
    assert.equal(service.resolveSession(created.token), null);
    assert.equal(repository.containsRawToken(created.token), false);
});
