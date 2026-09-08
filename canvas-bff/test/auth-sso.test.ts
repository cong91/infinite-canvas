import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";

const bffSecret = "test-canvas-bff-shared-secret-0123456789";
const config: CanvasBffConfig = {
    port: 0,
    canvasOrigin: "https://canvas.example.test",
    sub2ApiBaseUrl: "https://sub2api.example.test",
    sub2ApiCanvasBffSecret: bffSecret,
    environment: "test",
};

async function startApp(fetchImpl: typeof fetch) {
    const app = createApp(config, {
        auth: {
            canvasOrigin: config.canvasOrigin,
            sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, fetchImpl, 5_000, bffSecret),
            sessionService: new SessionService(new InMemorySessionRepository()),
            secureCookies: true,
        },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function exchange(launchCode = "a".repeat(43)): RequestInit {
    return {
        method: "POST",
        headers: { Origin: config.canvasOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ launch_code: launchCode }),
    };
}

test("SSO exchanges one-use launch code server-side, verifies auth/me, and returns an opaque session", async () => {
    const calls: Array<{ path: string; authorization: string; bffSecret: string }> = [];
    const upstreamFetch: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        const headers = new Headers(init?.headers);
        calls.push({ path, authorization: headers.get("authorization") || "", bffSecret: headers.get("x-canvas-bff-secret") || "" });
        if (path.endsWith("/canvas/launch/exchange")) return jsonResponse({ data: { access_token: "dashboard-assertion" } });
        return jsonResponse({ code: 0, data: { id: 42, username: "fixture-user", email: "fixture@example.test", status: "active" } });
    };
    const app = await startApp(upstreamFetch);
    try {
        const response = await fetch(`${app.url}/api/v1/sso/launch/exchange`, exchange());
        assert.equal(response.status, 200);
        const body = await response.json() as { data: { account: { sub2ApiUserId: string; displayName: string; email: string }; sessionExpiresAt: string } };
        assert.equal(body.data.account.sub2ApiUserId, "42");
        assert.equal(body.data.account.displayName, "fixture-user");
        assert.equal(JSON.stringify(body).includes("dashboard-assertion"), false);
        const setCookie = response.headers.get("set-cookie") || "";
        assert.match(setCookie, /^canvas_session=[^;]+;/);
        assert.match(setCookie, /HttpOnly/);
        assert.match(setCookie, /Secure/);
        assert.match(setCookie, /SameSite=None/);
        assert.deepEqual(calls, [
            { path: "/api/v1/canvas/launch/exchange", authorization: "", bffSecret },
            { path: "/api/v1/auth/me", authorization: "Bearer dashboard-assertion", bffSecret: "" },
        ]);
    } finally {
        await app.close();
    }
});

test("SSO falls back to user/profile and rejects a reused or invalid launch code without leaking assertions", async () => {
    let exchangeCount = 0;
    const upstreamFetch: typeof fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/canvas/launch/exchange")) {
            exchangeCount += 1;
            return exchangeCount === 1 ? jsonResponse({ data: { access_token: "fallback-assertion" } }) : jsonResponse({ code: 401 }, 401);
        }
        if (path.endsWith("/auth/me")) return jsonResponse({ code: 404 }, 404);
        return jsonResponse({ code: 0, data: { id: "profile-id", nickname: "Profile User", status: "active" } });
    };
    const app = await startApp(upstreamFetch);
    try {
        const first = await fetch(`${app.url}/api/v1/sso/launch/exchange`, exchange());
        assert.equal(first.status, 200);
        const second = await fetch(`${app.url}/api/v1/sso/launch/exchange`, exchange());
        assert.equal(second.status, 401);
        assert.equal((await second.text()).includes("fallback-assertion"), false);
    } finally {
        await app.close();
    }
});

test("the removed browser bearer endpoint cannot create a Canvas session", async () => {
    const app = await startApp(async () => jsonResponse({ code: 500 }, 500));
    try {
        const response = await fetch(`${app.url}/api/v1/sso/verify`, {
            method: "POST",
            headers: { Origin: config.canvasOrigin, Authorization: "Bearer dashboard-jwt" },
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("set-cookie"), null);
    } finally {
        await app.close();
    }
});

test("session endpoint resolves the cookie and logout revokes it", async () => {
    const upstreamFetch: typeof fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/canvas/launch/exchange")) return jsonResponse({ data: { access_token: "session-assertion" } });
        return jsonResponse({ code: 0, data: { id: 7, username: "session-user", status: "active" } });
    };
    const app = await startApp(upstreamFetch);
    try {
        const sso = await fetch(`${app.url}/api/v1/sso/launch/exchange`, exchange());
        const cookie = (sso.headers.get("set-cookie") || "").split(";", 1)[0];
        const session = await fetch(`${app.url}/api/v1/session`, { headers: { Origin: config.canvasOrigin, Cookie: cookie } });
        assert.equal(session.status, 200);
        const logout = await fetch(`${app.url}/api/v1/logout`, { method: "POST", headers: { Origin: config.canvasOrigin, Cookie: cookie } });
        assert.equal(logout.status, 200);
        const revoked = await fetch(`${app.url}/api/v1/session`, { headers: { Origin: config.canvasOrigin, Cookie: cookie } });
        assert.equal(revoked.status, 401);
    } finally {
        await app.close();
    }
});
