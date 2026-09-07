import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { redactHeaders, redactSecrets, redactUrl } from "../src/http/redaction.js";
import { sub2ApiIdentityFixture } from "./fixtures/sub2api.js";

const config: CanvasBffConfig = {
    port: 0,
    canvasOrigin: "https://canvas.example.test",
    sub2ApiBaseUrl: "https://sub2api.example.test",
    environment: "test",
};

async function request(path: string, init?: RequestInit) {
    const server = createApp(config).listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    assert(address && typeof address !== "string");
    try {
        return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

test("health and readiness expose service status with a request id", async () => {
    const response = await request("/health", { headers: { Origin: config.canvasOrigin } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get("access-control-allow-origin"), config.canvasOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.deepEqual(await response.json(), {
        data: { service: "canvas-bff", status: "ok" },
        requestId: response.headers.get("x-request-id"),
    });

    const ready = await request("/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
        data: { service: "canvas-bff", status: "ready" },
        requestId: ready.headers.get("x-request-id"),
    });
});

test("rejects a request from an origin other than the exact canvas origin", async () => {
    const response = await request("/health", { headers: { Origin: "https://evil.example.test" } });
    assert.equal(response.status, 403);
    const body = await response.json() as { code: string; message: string; requestId: string };
    assert.equal(body.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(body.message, "Origin is not allowed");
    assert.equal(body.requestId, response.headers.get("x-request-id"));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("rejects state-changing requests without the exact Canvas origin", async () => {
    const app = createApp(config);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    try {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "forbidden" }) });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "ORIGIN_REQUIRED");
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test("responds with a standard not-found error envelope", async () => {
    const response = await request("/missing", { headers: { Origin: config.canvasOrigin } });
    assert.equal(response.status, 404);
    const body = await response.json() as { code: string; message: string; requestId: string };
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.message, "Route not found");
    assert.equal(body.requestId, response.headers.get("x-request-id"));
});

test("redacts credentials from headers, URLs and nested payloads", () => {
    assert.deepEqual(redactHeaders({ authorization: "Bearer secret-token", Cookie: "session=secret", "x-goog-api-key": "raw-provider-key", Accept: "application/json" }), {
        authorization: "[REDACTED]",
        Cookie: "[REDACTED]",
        "x-goog-api-key": "[REDACTED]",
        Accept: "application/json",
    });
    assert.equal(redactUrl("https://canvas.example.test/callback?access_token=secret-token&returnTo=%2Fcanvas"), "https://canvas.example.test/callback?access_token=%5BREDACTED%5D&returnTo=%2Fcanvas");
    assert.deepEqual(redactSecrets({ token: "secret-token", providerKey: "raw-key", keyId: "safe-id", nested: { password: "secret" } }), {
        token: "[REDACTED]",
        providerKey: "[REDACTED]",
        keyId: "safe-id",
        nested: { password: "[REDACTED]" },
    });
});

test("fixture contains only normalized identity metadata", () => {
    assert.deepEqual(sub2ApiIdentityFixture, {
        id: "sub2api-user-fixture",
        displayName: "Fixture User",
        email: "fixture@example.test",
        status: "active",
    });
});
