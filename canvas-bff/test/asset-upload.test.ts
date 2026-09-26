import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasBffConfig } from "../src/config/config.js";
import { startTestApp } from "./helpers/app.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";
import { createDefaultAssetOptions, createDefaultProviderOptions, createDefaultProjectOptions } from "./helpers/fixtures.js";
import { InMemoryAssetRepository } from "../src/assets/repository.js";
import { InMemoryObjectStorage } from "../src/storage/object-storage.js";

const config: CanvasBffConfig = { port: 0, canvasOrigin: "https://canvas.example.test", sub2ApiBaseUrl: "https://sub2api.example.test", environment: "test" };

test("asset upload stores bytes once, dedupes by checksum, and scopes to the session account", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const projects = createDefaultProjectOptions(sessions);
    const assets = new InMemoryAssetRepository();
    const objectStorage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret" });
    const app = await startTestApp(config, {
        auth: { sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, async (_input, init) => {
            const token = new Headers(init?.headers).get("authorization") || "";
            const id = token.includes("user-a") ? "a" : "b";
            return new Response(JSON.stringify({ data: { id, username: `User ${id}`, status: "active" } }), { status: 200 });
        }), sessionService: sessions },
        workspace: { providers: createDefaultProviderOptions(sessions, config.sub2ApiBaseUrl), projects: { projects: projects.projects }, assets: { assets, projects: projects.projects, objectStorage } },
    });
    const url = app.url;
    const login = async (token: string) => {
        const id = token.includes("user-a") ? "a" : "b";
        const account = await sessions.upsertAccount({ sub2ApiUserId: id, displayName: `User ${id}`, status: "active" });
        const session = await sessions.createSession(account);
        return { cookie: `canvas_session=${session.token}`, accountId: account.id };
    };
    try {
        const userA = await login("user-a");
        const cookieA = userA.cookie;
        const userB = await login("user-b");
        const cookieB = userB.cookie;
        const png = Buffer.from("89504e470d0a1a0a", "hex");

        const upload = await fetch(`${url}/api/v1/assets/upload?kind=image`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "image/png" }, body: png });
        assert.equal(upload.status, 201);
        const first = await upload.json() as { data: { id: string; kind: string; objectKey?: string; metadata: { checksum: string; size: number; origin: string }; signedUrl: string } };
        assert.equal(first.data.kind, "image");
        assert.match(first.data.objectKey || "", /^accounts\/.+\/assets\//);
        assert.equal(first.data.metadata.checksum.length, 64);
        assert.equal(first.data.metadata.size, png.byteLength);
        assert.equal(first.data.metadata.origin, "client-upload");
        assert.ok(first.data.signedUrl);

        const duplicate = await fetch(`${url}/api/v1/assets/upload?kind=image`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "image/png" }, body: png });
        assert.equal(duplicate.status, 201);
        const second = await duplicate.json() as { data: { id: string } };
        assert.equal(second.data.id, first.data.id);
        assert.equal((await objectStorage.list(userA.accountId)).length, 1);
        assert.equal((await assets.list(userA.accountId)).length, 1);

        const otherAccount = await fetch(`${url}/api/v1/assets/upload?kind=image`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieB, "Content-Type": "image/png" }, body: png });
        assert.equal(otherAccount.status, 201);
        const third = await otherAccount.json() as { data: { id: string } };
        assert.notEqual(third.data.id, first.data.id);
        assert.equal((await objectStorage.list(userB.accountId)).length, 1);

        const empty = await fetch(`${url}/api/v1/assets/upload?kind=image`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "image/png" }, body: new Uint8Array() });
        assert.equal(empty.status, 400);
        assert.equal(((await empty.json()) as { code: string }).code, "ASSET_UPLOAD_EMPTY");

        const unauthenticated = await fetch(`${url}/api/v1/assets/upload?kind=image`, { method: "POST", headers: { Origin: config.canvasOrigin, "Content-Type": "image/png" }, body: png });
        assert.equal(unauthenticated.status, 401);
    } finally {
        await app.close();
    }
});
