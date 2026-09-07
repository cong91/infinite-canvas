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
    const headers = (token: string) => ({ Origin: config.canvasOrigin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    const login = async (token: string) => {
        const response = await fetch(`${url}/api/v1/sso/verify`, { method: "POST", headers: headers(token), body: "{}" });
        const cookie = (response.headers.get("set-cookie") || "").split(";", 1)[0];
        assert.equal(response.status, 200);
        return cookie;
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
