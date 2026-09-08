import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";
import { InMemoryAssetRepository } from "../src/assets/repository.js";
import { InMemoryGenerationRepository } from "../src/generations/repository.js";
import { GenerationService } from "../src/generations/service.js";
import { InMemoryProjectRepository } from "../src/projects/repository.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";
import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { createDefaultAssetOptions } from "../src/assets/routes.js";
import { createDefaultProviderOptions } from "../src/providers/routes.js";

const config: CanvasBffConfig = { port: 0, canvasOrigin: "https://canvas.example.test", sub2ApiBaseUrl: "https://sub2api.example.test", environment: "test" };

test("generation routes create idempotent records and enforce session ownership", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const projects = new InMemoryProjectRepository();
    const providers = new InMemoryProviderRepository();
    const assets = new InMemoryAssetRepository();
    const account = await sessions.upsertAccount({ sub2ApiUserId: "user-a", displayName: "User A", status: "active" });
    const project = projects.create({ accountId: account.id, name: "Demo", data: {} });
    const provider = providers.create({ accountId: account.id, name: "Provider", providerType: "openai-compatible", secret: new ProviderSecretBox(Buffer.alloc(32, 1)).encrypt("secret"), secretDescription: { fingerprint: "fingerprint", masked: "****cret" }, status: "active" });
    const generations = new InMemoryGenerationRepository();
    const service = new GenerationService({ generations, projects, providers });
    const app = createApp(config, {
        auth: { canvasOrigin: config.canvasOrigin, sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, async () => new Response(JSON.stringify({ data: { id: "user-a", username: "User A", status: "active" } }))), sessionService: sessions },
        workspace: { projects: { projects }, providers: { catalog: createDefaultProviderOptions(sessions, config.sub2ApiBaseUrl).catalog, secretBox: new ProviderSecretBox(Buffer.alloc(32, 1)), providers }, assets: createDefaultAssetOptions(sessions, projects), generations: { service } },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const session = await sessions.createSession(account);
    const cookie = `canvas_session=${session.token}`;
    try {
        const init = { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, providerId: provider.id, kind: "image", input: { prompt: "tree" }, clientRequestId: "request-1" }) };
        const first = await fetch(`${url}/api/v1/generations`, init);
        assert.equal(first.status, 201);
        const duplicate = await fetch(`${url}/api/v1/generations`, init);
        assert.equal(duplicate.status, 201);
        assert.equal((await duplicate.json()).data.id, (await first.clone().json()).data.id);
        const list = await fetch(`${url}/api/v1/generations`, { headers: { Origin: config.canvasOrigin, Cookie: cookie } });
        assert.equal((await list.json()).data.length, 1);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
