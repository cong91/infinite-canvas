import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";

import { loadConfig, type CanvasBffConfig } from "./config.js";
import { HttpError, toErrorEnvelope } from "./http/errors.js";

export function isAllowedOrigin(requestOrigin: string | undefined, canvasOrigin: string): boolean {
    if (!requestOrigin) return true;
    try {
        return new URL(requestOrigin).origin === canvasOrigin && requestOrigin === canvasOrigin;
    } catch {
        return false;
    }
}

export function createApp(config: CanvasBffConfig) {
    const app = express();
    app.disable("x-powered-by");
    app.use((req, res, next) => {
        const requestId = randomUUID();
        res.locals.requestId = requestId;
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("Vary", "Origin");

        const origin = req.header("origin");
        if (!isAllowedOrigin(origin, config.canvasOrigin)) {
            return next(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed"));
        }
        if (origin) {
            res.setHeader("Access-Control-Allow-Origin", config.canvasOrigin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token, X-Request-Id");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        }
        if (req.method === "OPTIONS") return res.status(204).end();
        next();
    });
    app.use(express.json({ limit: "1mb" }));
    app.get("/health", (_req, res) => res.json({ data: { service: "canvas-bff", status: "ok" }, requestId: res.locals.requestId }));
    app.get("/ready", (_req, res) => res.json({ data: { service: "canvas-bff", status: "ready" }, requestId: res.locals.requestId }));
    app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Route not found")));
    app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
        const requestId = String(res.locals.requestId || req.header("x-request-id") || "unknown");
        const result = toErrorEnvelope(error, requestId);
        res.status(result.statusCode).json(result.body);
    });
    return app;
}

export function startServer(config: CanvasBffConfig = loadConfig()) {
    const app = createApp(config);
    return app.listen(config.port, "0.0.0.0", () => {
        if (config.environment !== "test") console.info(`Canvas BFF listening on ${config.port}`);
    });
}

const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedFile) startServer();
