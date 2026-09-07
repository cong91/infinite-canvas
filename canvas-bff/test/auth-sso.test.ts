import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type CanvasBffConfig } from "../src/server.js";
import { InMemorySessionRepository, SessionService } from "../src/auth/session-service.js";
import { Sub2ApiClient } from "../src/auth/sub2api-client.js";

const config: CanvasBffConfig = {
    port: 0,
    canvasOrigin: "https://canvas.example.test",
    sub2ApiBaseUrl: "https://sub2api.example.test",
    environment: "test",
};

type ResponseWithCookie = { response: Response; setCookie: string };

async function startApp(fetchImpl: typeof fetch) {
    const app = createApp(config, {
        auth: {
            canvasOrigin: config.canvasOrigin,
            sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl, fetchImpl),
            sessionService: new SessionService(new InMemorySessionRepository()),
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
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function bearer(token: string): RequestInit {
    return {
        method: "POST",
        headers: {
            Origin: config.canvasOrigin,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ returnTo: "/canvas" }),
    };
}

test("SSO verifies auth/me, creates an opaque secure session and returns normalized identity", async () => {
    const upstreamHeaders: string[] = [];
    const upstreamFetch: typeof fetch = async (_input, init) => {
        upstreamHeaders.push(new Headers(init?.headers).get("authorization") || "");
        return jsonResponse({
            code: 0,
            message: "success",
            data: {
                id: 42,
                username: "fixture-user",
                email: "fixture@example.test",
                status: "active",
            },
        });
    };
    const app = await startApp(upstreamFetch);
    try {
        const response = await fetch(`${app.url}/api/v1/sso/verify`, bearer("fixture-jwt"));
        assert.equal(response.status, 200);
        const body = await response.json() as { data: { account: { sub2ApiUserId: string; displayName: string; email: string }; sessionExpiresAt: string } };
        assert.equal(body.data.account.sub2ApiUserId, "42");
        assert.equal(body.data.account.displayName, "fixture-user");
        assert.equal(body.data.account.email, "fixture@example.test");
        assert.match(body.data.sessionExpiresAt, /^20\d\d-/);
        assert.equal(JSON.stringify(body).includes("fixture-jwt"), false);

        const setCookie = response.headers.get("set-cookie") || "";
        assert.match(setCookie, /^canvas_session=[^;]+;/);
        assert.match(setCookie, /HttpOnly/);
        assert.match(setCookie, /Secure/);
        assert.match(setCookie, /SameSite=None/);
        assert.match(setCookie, /Path=\//);
        assert.deepEqual(upstreamHeaders, ["Bearer fixture-jwt"]);
    } finally {
        await app.close();
    }
});

test("SSO falls back to user/profile only when auth/me is unavailable", async () => {
    const calls: string[] = [];
    const upstreamFetch: typeof fetch = async (input, init) => {
        calls.push(`${new URL(String(input)).pathname}:${new Headers(init?.headers).get("authorization")}`);
        if (calls.length === 1) return jsonResponse({ code: 404, message: "not found" }, 404);
        return jsonResponse({
            code: 0,
            data: { id: "profile-id", nickname: "Profile User", status: "active" },
        });
    };
    const app = await startApp(upstreamFetch);
    try {
        const response = await fetch(`${app.url}/api/v1/sso/verify`, bearer("fallback-jwt"));
        assert.equal(response.status, 200);
        const body = await response.json() as { data: { account: { sub2ApiUserId: string; displayName: string } } };
        assert.equal(body.data.account.sub2ApiUserId, "profile-id");
        assert.equal(body.data.account.displayName, "Profile User");
        assert.deepEqual(calls, [
            "/api/v1/auth/me:Bearer fallback-jwt",
            "/api/v1/user/profile:Bearer fallback-jwt",
        ]);
    } finally {
        await app.close();
    }
});

test("SSO rejects upstream authorization failures and inactive identities without leaking details", async () => {
    const upstreamFetch: typeof fetch = async () => jsonResponse({ code: 401, message: "token invalid" }, 401);
    const app = await startApp(upstreamFetch);
    try {
        const response = await fetch(`${app.url}/api/v1/sso/verify`, bearer("invalid-jwt"));
        assert.equal(response.status, 401);
        const body = await response.json() as { code: string; message: string };
        assert.equal(body.code, "SUB2API_UNAUTHORIZED");
        assert.equal(body.message.includes("invalid-jwt"), false);
        assert.equal(response.headers.get("set-cookie"), null);
    } finally {
        await app.close();
    }
});

test("session endpoint resolves the cookie and logout revokes it", async () => {
    const upstreamFetch: typeof fetch = async () => jsonResponse({ code: 0, data: { id: 7, username: "session-user", status: "active" } });
    const app = await startApp(upstreamFetch);
    try {
        const sso = await fetch(`${app.url}/api/v1/sso/verify`, bearer("session-jwt"));
        const setCookie = sso.headers.get("set-cookie") || "";
        const cookie = setCookie.split(";", 1)[0];

        const session = await fetch(`${app.url}/api/v1/session`, {
            headers: { Origin: config.canvasOrigin, Cookie: cookie },
        });
        const sessionText = await session.text();
        assert.equal(session.status, 200);
        const sessionBody = JSON.parse(sessionText) as { data: { account: { sub2ApiUserId: string } } };
        assert.equal(sessionBody.data.account.sub2ApiUserId, "7");

        const logout = await fetch(`${app.url}/api/v1/logout`, {
            method: "POST",
            headers: { Origin: config.canvasOrigin, Cookie: cookie },
        });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);

        const revoked = await fetch(`${app.url}/api/v1/session`, {
            headers: { Origin: config.canvasOrigin, Cookie: cookie },
        });
        assert.equal(revoked.status, 401);
    } finally {
        await app.close();
    }
});
