import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";

import { loadConfig, type CanvasBffConfig } from "./config.js";
import { HttpError, toErrorEnvelope } from "./http/errors.js";
import { createAuthRouter, type AuthRouteOptions } from "./auth/routes.js";
import { InMemorySessionRepository, SessionService } from "./auth/session-service.js";
import { Sub2ApiClient } from "./auth/sub2api-client.js";
import { createAssetRouter, type AssetRouteOptions } from "./assets/routes.js";
import { createDefaultAssetOptions } from "./assets/routes.js";
import { createProviderRouter, type ProviderRouteOptions } from "./providers/routes.js";
import { createDefaultProviderOptions } from "./providers/routes.js";
import { createProjectRouter, type ProjectRouteOptions } from "./projects/routes.js";
import { createDefaultProjectOptions } from "./projects/routes.js";
import { createGenerationRouter, type GenerationRouteOptions } from "./generations/routes.js";
import { InMemoryGenerationRepository } from "./generations/repository.js";
import { GenerationService } from "./generations/service.js";
import { InMemoryObjectStorage } from "./storage/object-storage.js";

export function isAllowedOrigin(requestOrigin: string | undefined, canvasOrigin: string): boolean {
    if (!requestOrigin) return true;
    try {
        return new URL(requestOrigin).origin === canvasOrigin && requestOrigin === canvasOrigin;
    } catch {
        return false;
    }
}

export type AppDependencies = {
    auth?: AuthRouteOptions;
    workspace?: {
        providers?: Omit<ProviderRouteOptions, "sessionService">;
        projects?: Omit<ProjectRouteOptions, "sessionService">;
        assets?: Omit<AssetRouteOptions, "sessionService">;
        generations?: Omit<GenerationRouteOptions, "sessionService">;
    };
};

export function createApp(config: CanvasBffConfig, dependencies: AppDependencies = {}) {
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
    const auth = dependencies.auth ?? {
        canvasOrigin: config.canvasOrigin,
        sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl),
        sessionService: new SessionService(new InMemorySessionRepository()),
    };
    app.use(createAuthRouter(auth));
    const projectOptions = {
        ...(dependencies.workspace?.projects ?? createDefaultProjectOptions(auth.sessionService)),
        sessionService: auth.sessionService,
    } as ProjectRouteOptions;
    const providerOptions = {
        ...(dependencies.workspace?.providers ?? createDefaultProviderOptions(auth.sessionService, config.sub2ApiBaseUrl)),
        sessionService: auth.sessionService,
    } as ProviderRouteOptions;
    const assetOptions = {
        ...(dependencies.workspace?.assets ?? createDefaultAssetOptions(auth.sessionService, projectOptions.projects)),
        sessionService: auth.sessionService,
        projects: projectOptions.projects,
    } as AssetRouteOptions;
    const generationOptions = {
        ...(dependencies.workspace?.generations ?? createDefaultGenerationOptions(projectOptions.projects, providerOptions.providers, assetOptions.assets)),
        sessionService: auth.sessionService,
    } as GenerationRouteOptions;
    app.use(createProviderRouter(providerOptions));
    app.use(createProjectRouter(projectOptions));
    app.use(createAssetRouter(assetOptions));
    app.use(createGenerationRouter(generationOptions));
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

function createDefaultGenerationOptions(projects: ProjectRouteOptions["projects"], providers: ProviderRouteOptions["providers"], assets: AssetRouteOptions["assets"]): Omit<GenerationRouteOptions, "sessionService"> {
    return {
        service: new GenerationService({ generations: new InMemoryGenerationRepository(), projects, providers }),
        assets,
        objectStorage: new InMemoryObjectStorage({ signingSecret: process.env.CANVAS_OBJECT_SIGNING_SECRET ?? "development-object-signing-secret" }),
    };
}

export function startServer(config: CanvasBffConfig = loadConfig()) {
    const app = createApp(config);
    return app.listen(config.port, "0.0.0.0", () => {
        if (config.environment !== "test") console.info(`Canvas BFF listening on ${config.port}`);
    });
}

const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedFile) startServer();
