import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";
import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { createDefaultAssetOptions } from "../src/assets/routes.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";
import { createDefaultProjectOptions } from "../src/projects/routes.js";
import { Sub2ApiCatalogAdapter } from "../src/providers/sub2api-catalog.js";

const config: CanvasBffConfig = { port: 0, canvasOrigin: "https://canvas.example.test", sub2ApiBaseUrl: "https://sub2api.example.test", environment: "test" };

test("provider CRUD is scoped to the Canvas session account and never returns raw secret", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const providers = new InMemoryProviderRepository();
    const projects = createDefaultProjectOptions(sessions);
    const app = createApp(config, {
        auth: { canvasOrigin: config.canvasOrigin, sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, async (_input, init) => {
            const token = new Headers(init?.headers).get("authorization") || "";
            const id = token.includes("user-a") ? "a" : "b";
            return new Response(JSON.stringify({ data: { id, username: `User ${id}`, status: "active" } }), { status: 200 });
        }), sessionService: sessions },
        workspace: {
            providers: { catalog: new Sub2ApiCatalogAdapter(config.sub2ApiBaseUrl), secretBox: new ProviderSecretBox(Buffer.alloc(32, 3)), providers },
            projects: { projects: projects.projects },
            assets: createDefaultAssetOptions(sessions, projects.projects),
        },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const login = async (token: string) => {
        const id = token.includes("user-a") ? "a" : "b";
        const account = await sessions.upsertAccount({ sub2ApiUserId: id, displayName: `User ${id}`, status: "active" });
        const session = await sessions.createSession(account);
        return `canvas_session=${session.token}`;
    };
    try {
        const cookieA = await login("user-a");
        const cookieB = await login("user-b");
        const create = await fetch(`${url}/api/v1/providers`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ name: "A provider", secret: "sk-a-secret" }) });
        assert.equal(create.status, 201);
        const created = await create.json() as { data: { id: string; maskedKey: string } };
        assert.equal(created.data.maskedKey, "****cret");
        assert.equal(JSON.stringify(created).includes("sk-a-secret"), false);

        const listB = await fetch(`${url}/api/v1/providers`, { headers: { Origin: config.canvasOrigin, Cookie: cookieB } });
        assert.deepEqual((await listB.json()).data, []);
        const getB = await fetch(`${url}/api/v1/providers/${created.data.id}`, { headers: { Origin: config.canvasOrigin, Cookie: cookieB } });
        assert.equal(getB.status, 404);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test("catalog uses the server-side session bridge without requiring a browser bearer token", async () => {
    const upstreamHeaders: string[] = [];
    const sessions = new SessionService(new InMemorySessionRepository());
    const catalog = new Sub2ApiCatalogAdapter(config.sub2ApiBaseUrl, async (_input, init) => {
        upstreamHeaders.push(new Headers(init?.headers).get("authorization") || "");
        return new Response(JSON.stringify({ data: [{ id: "key-1", name: "OpenAI", key: "sk-upstream-secret" }] }), { status: 200 });
    });
    const app = createApp(config, {
        auth: {
            canvasOrigin: config.canvasOrigin,
            sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, async () => new Response(JSON.stringify({ data: { id: "catalog-user", username: "Catalog User", status: "active" } }), { status: 200 })),
            sessionService: sessions,
        },
        workspace: { providers: { catalog, secretBox: new ProviderSecretBox(Buffer.alloc(32, 4)), providers: new InMemoryProviderRepository() } },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    try {
        const account = await sessions.upsertAccount({ sub2ApiUserId: "catalog-user", displayName: "Catalog User", status: "active" });
        const session = await sessions.createSession(account, "catalog-jwt");
        const cookie = `canvas_session=${session.token}`;
        const response = await fetch(`${url}/api/v1/providers/catalog`, { headers: { Origin: config.canvasOrigin, Cookie: cookie } });
        assert.equal(response.status, 200);
        const body = await response.json() as { data: { keys: Array<{ maskedKey?: string }> } };
        assert.equal(body.data.keys[0]?.maskedKey, "****cret");
        assert.equal(JSON.stringify(body).includes("sk-upstream-secret"), false);
        assert.equal(upstreamHeaders.length, 4);
        assert(upstreamHeaders.every((header) => header === "Bearer catalog-jwt"));
        assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
