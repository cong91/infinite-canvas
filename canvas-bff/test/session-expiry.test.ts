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

test("session expires at its server-side deadline", async () => {
    let now = 1_000;
    const repository = new InMemorySessionRepository(() => now);
    const service = new SessionService(repository, { sessionTtlMs: 1_000, now: () => now });
    const created = await service.createSession(account);

    assert.equal((await service.resolveSession(created.token))?.account.id, account.id);
    now = 2_000;
    assert.equal(await service.resolveSession(created.token), null);
});

test("revoked sessions cannot be resolved and session records never retain an assertion token", async () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository, { sessionTtlMs: 10_000 });
    const created = await service.createSession(account);

    assert.equal(await service.revokeSession(created.token), true);
    assert.equal(await service.resolveSession(created.token), null);
    assert.equal(await repository.containsRawToken(created.token), false);
});
