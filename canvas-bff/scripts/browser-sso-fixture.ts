import express from "express";

import { createCanvasApplication } from "../src/bootstrap.js";

const canvasOrigin = "http://localhost:3002";
const bffSecret = "browser-sso-fixture-shared-secret-0123456789";
const launchCode = "browser-launch-code-0123456789-abcdefghijklmnopqrstuvwxyz";
const accessToken = "browser-fixture-dashboard-assertion";
let consumed = false;

const upstream = express();
upstream.use(express.json());
upstream.post("/api/v1/canvas/launch/exchange", (request, response) => {
    const valid = request.header("x-canvas-bff-secret") === bffSecret
        && request.body?.launch_code === launchCode
        && request.body?.canvas_origin === canvasOrigin;
    if (!valid || consumed) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });
    consumed = true;
    response.json({ data: { access_token: accessToken } });
});
upstream.get("/api/v1/auth/me", (request, response) => {
    if (request.header("authorization") !== `Bearer ${accessToken}`) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });
    response.json({ data: { id: "browser-fixture-user", username: "Browser fixture", email: "fixture@example.test", status: "active" } });
});

const upstreamServer = upstream.listen(17373, "127.0.0.1");
const bffApp = await createCanvasApplication({
    port: 17374,
    canvasOrigin,
    sub2ApiBaseUrl: "http://127.0.0.1:17373",
    sub2ApiCanvasBffSecret: bffSecret,
    environment: "test",
});
await bffApp.listen(17374, "127.0.0.1");
console.info(`Browser SSO fixture ready: ${canvasOrigin}/?launch_code=${launchCode}`);

async function shutdown() {
    await Promise.all([
        new Promise<void>((resolve, reject) => upstreamServer.close((error) => error ? reject(error) : resolve())),
        bffApp.close(),
    ]);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
