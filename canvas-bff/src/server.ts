import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";

import { loadConfig, type CanvasBffConfig } from "./config.js";
import { assertDatabaseReady, createDatabasePool } from "./db.js";
import { HttpError, toErrorEnvelope } from "./http/errors.js";
import { createAuthRouter, type AuthRouteOptions } from "./auth/routes.js";
import { InMemorySessionRepository, SessionService } from "./auth/session-service.js";
import { PostgresSessionRepository } from "./auth/postgres-session-repository.js";
import { Sub2ApiClient } from "./auth/sub2api-client.js";
import { createAssetRouter, type AssetRouteOptions } from "./assets/routes.js";
import { createDefaultAssetOptions } from "./assets/routes.js";
import { createProviderRouter, type ProviderRouteOptions } from "./providers/routes.js";
import { createDefaultProviderOptions } from "./providers/routes.js";
import { PostgresProviderRepository } from "./providers/postgres-repository.js";
import { Sub2ApiCatalogAdapter } from "./providers/sub2api-catalog.js";
import { ProviderSecretBox } from "./crypto/secret-box.js";
import { createProjectRouter, type ProjectRouteOptions } from "./projects/routes.js";
import { createDefaultProjectOptions } from "./projects/routes.js";
import { PostgresProjectRepository } from "./projects/postgres-repository.js";
import { createGenerationRouter, type GenerationRouteOptions } from "./generations/routes.js";
import { InMemoryGenerationRepository } from "./generations/repository.js";
import { PostgresGenerationRepository } from "./generations/postgres-repository.js";
import { GenerationService } from "./generations/service.js";
import { InMemoryObjectStorage } from "./storage/object-storage.js";
import { S3ObjectStorage } from "./storage/s3-object-storage.js";
import { PostgresAssetRepository } from "./assets/postgres-repository.js";

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
    app.use((req, _res, next) => {
        if (["POST", "PATCH", "DELETE"].includes(req.method) && req.header("origin") !== config.canvasOrigin) {
            next(new HttpError(403, "ORIGIN_REQUIRED", "A valid Canvas origin is required for state-changing requests"));
            return;
        }
        next();
    });
    const persistent = config.environment === "test" ? undefined : createPersistentDependencies(config);
    const auth = dependencies.auth ?? persistent?.auth ?? {
        canvasOrigin: config.canvasOrigin,
        sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl),
        sessionService: new SessionService(new InMemorySessionRepository()),
    };
    app.use(createAuthRouter(auth));
    const projectOptions = {
        ...(dependencies.workspace?.projects ?? persistent?.projects ?? createDefaultProjectOptions(auth.sessionService)),
        sessionService: auth.sessionService,
    } as ProjectRouteOptions;
    const providerOptions = {
        ...(dependencies.workspace?.providers ?? persistent?.providers ?? createDefaultProviderOptions(auth.sessionService, config.sub2ApiBaseUrl)),
        sessionService: auth.sessionService,
    } as ProviderRouteOptions;
    const assetOptions = {
        ...(dependencies.workspace?.assets ?? persistent?.assets ?? createDefaultAssetOptions(auth.sessionService, projectOptions.projects)),
        sessionService: auth.sessionService,
        projects: projectOptions.projects,
    } as AssetRouteOptions;
    const generationOptions = {
        ...(dependencies.workspace?.generations ?? persistent?.generations ?? createDefaultGenerationOptions(projectOptions.projects, providerOptions.providers, assetOptions.assets)),
        sessionService: auth.sessionService,
    } as GenerationRouteOptions;
    app.use(createProviderRouter(providerOptions));
    app.use(createProjectRouter(projectOptions));
    app.use(createAssetRouter(assetOptions));
    app.use(createGenerationRouter(generationOptions));
    app.get("/health", (_req, res) => res.json({ data: { service: "canvas-bff", status: "ok" }, requestId: res.locals.requestId }));
    app.get("/ready", async (_req, res, next) => {
        try {
            if (persistent) {
                await assertDatabaseReady(persistent.pool);
                await persistent.objectStorage.assertReady();
            }
            res.json({ data: { service: "canvas-bff", status: "ready" }, requestId: res.locals.requestId });
        } catch (error) {
            next(new HttpError(503, "DEPENDENCY_NOT_READY", "Canvas BFF dependencies are not ready"));
        }
    });
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

function createPersistentDependencies(config: CanvasBffConfig) {
    const environment = process.env;
    const pool = createDatabasePool(environment);
    const sessionService = new SessionService(new PostgresSessionRepository(pool));
    const projects = new PostgresProjectRepository(pool);
    const providers = new PostgresProviderRepository(pool);
    const assets = new PostgresAssetRepository(pool);
    const generations = new PostgresGenerationRepository(pool);
    const objectStorage = new S3ObjectStorage({
        endpoint: requiredEnvironment(environment, "S3_ENDPOINT"),
        publicEndpoint: environment.S3_PUBLIC_ENDPOINT,
        region: environment.S3_REGION ?? "us-east-1",
        bucket: requiredEnvironment(environment, "S3_BUCKET"),
        accessKeyId: requiredEnvironment(environment, "S3_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnvironment(environment, "S3_SECRET_ACCESS_KEY"),
    });
    return {
        pool,
        auth: { canvasOrigin: config.canvasOrigin, sub2ApiClient: new Sub2ApiClient(config.sub2ApiBaseUrl), sessionService },
        projects: { projects },
        providers: { catalog: new Sub2ApiCatalogAdapter(config.sub2ApiBaseUrl), secretBox: ProviderSecretBox.fromEnvironment({ ...environment, CANVAS_PROVIDER_MASTER_KEY: requiredEnvironment(environment, "CANVAS_PROVIDER_MASTER_KEY") }), providers },
        assets: { assets, projects },
        generations: { service: new GenerationService({ generations, projects, providers }), assets, objectStorage },
        objectStorage,
    };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name];
    if (!value?.trim()) throw new Error(`${name} is required`);
    return value;
}

export function startServer(config: CanvasBffConfig = loadConfig()) {
    const app = createApp(config);
    return app.listen(config.port, "0.0.0.0", () => {
        if (config.environment !== "test") console.info(`Canvas BFF listening on ${config.port}`);
    });
}

const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedFile) startServer();
