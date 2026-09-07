import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";
import { createDefaultAssetOptions } from "../src/assets/routes.js";
import { createDefaultProviderOptions } from "../src/providers/routes.js";
import { createDefaultProjectOptions } from "../src/projects/routes.js";

const config: CanvasBffConfig = { port: 0, canvasOrigin: "https://canvas.example.test", sub2ApiBaseUrl: "https://sub2api.example.test", environment: "test" };

test("project and asset routes derive ownership from the session account", async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const projects = createDefaultProjectOptions(sessions);
    const app = createApp(config, {
        auth: { canvasOrigin: config.canvasOrigin, sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, async (_input, init) => {
            const token = new Headers(init?.headers).get("authorization") || "";
            const id = token.includes("user-a") ? "a" : "b";
            return new Response(JSON.stringify({ data: { id, username: `User ${id}`, status: "active" } }), { status: 200 });
        }), sessionService: sessions },
        workspace: { providers: createDefaultProviderOptions(sessions, config.sub2ApiBaseUrl), projects: { projects: projects.projects }, assets: createDefaultAssetOptions(sessions, projects.projects) },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const login = async (token: string) => {
        const response = await fetch(`${url}/api/v1/sso/verify`, { method: "POST", headers: { Origin: config.canvasOrigin, Authorization: `Bearer ${token}` }, body: "{}" });
        assert.equal(response.status, 200);
        return (response.headers.get("set-cookie") || "").split(";", 1)[0];
    };
    try {
        const cookieA = await login("user-a");
        const cookieB = await login("user-b");
        const create = await fetch(`${url}/api/v1/projects`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ name: "A canvas", data: { nodes: [] } }) });
        assert.equal(create.status, 201);
        const project = await create.json() as { data: { id: string } };
        const staleUpdate = await fetch(`${url}/api/v1/projects/${project.data.id}`, {
            method: "PATCH",
            headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Renamed", revision: 2 }),
        });
        assert.equal(staleUpdate.status, 409);
        const staleBody = await staleUpdate.json() as { code: string; message: string; requestId: string };
        assert.equal(staleBody.code, "PROJECT_REVISION_CONFLICT");
        assert.equal(staleBody.message, "Project was updated elsewhere");
        assert.equal(typeof staleBody.requestId, "string");
        const own = await fetch(`${url}/api/v1/projects/${project.data.id}`, { headers: { Origin: config.canvasOrigin, Cookie: cookieA } });
        assert.equal(own.status, 200);
        const foreign = await fetch(`${url}/api/v1/projects/${project.data.id}`, { headers: { Origin: config.canvasOrigin, Cookie: cookieB } });
        assert.equal(foreign.status, 404);
        const asset = await fetch(`${url}/api/v1/assets/import`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.data.id, kind: "image", providerUrl: "https://cdn.example.test/image.png" }) });
        assert.equal(asset.status, 201);
        const assetsB = await fetch(`${url}/api/v1/projects/${project.data.id}/assets`, { headers: { Origin: config.canvasOrigin, Cookie: cookieB } });
        assert.equal(assetsB.status, 404);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
