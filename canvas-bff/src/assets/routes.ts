import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { HttpError } from "../http/errors.js";
import { requireSessionMiddleware, type AuthenticatedContext } from "../auth/routes.js";
import { type ProjectRepository } from "../projects/repository.js";
import { InMemoryAssetRepository, type AssetRecord, type AssetRepository } from "./repository.js";

export type AssetRouteOptions = {
    assets: AssetRepository;
    projects: ProjectRepository;
    sessionService: Parameters<typeof requireSessionMiddleware>[0];
};

const assetBody = z.object({
    projectId: z.string().trim().min(1).optional(),
    kind: z.enum(["image", "video", "audio", "file"]),
    objectKey: z.string().trim().max(500).optional(),
    providerUrl: z.string().url().max(2_000).optional(),
    metadata: z.record(z.unknown()).default({}),
});

export function createAssetRouter(options: AssetRouteOptions): Router {
    const router = Router();
    const authenticated = requireSessionMiddleware(options.sessionService);

    router.get("/api/v1/projects/:projectId/assets", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        await assertProject(options.projects, account.id, String(request.params.projectId));
        response.json({ data: (await options.assets.list(account.id, String(request.params.projectId))).map(toPublicAsset), requestId: response.locals.requestId });
    }));

    router.get("/api/v1/assets", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const projectId = typeof request.query.projectId === "string" ? request.query.projectId : undefined;
        if (projectId) await assertProject(options.projects, account.id, projectId);
        response.json({ data: (await options.assets.list(account.id, projectId)).map(toPublicAsset), requestId: response.locals.requestId });
    }));

    router.post("/api/v1/assets/import", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const body = parseBody(assetBody, request.body);
        if (body.projectId) await assertProject(options.projects, account.id, body.projectId);
        const asset = await options.assets.create({ ...body, accountId: account.id });
        response.status(201).json({ data: toPublicAsset(asset), requestId: response.locals.requestId });
    }));

    router.get("/api/v1/assets/:assetId", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const asset = await options.assets.get(account.id, String(request.params.assetId));
        if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset was not found");
        response.json({ data: toPublicAsset(asset), requestId: response.locals.requestId });
    }));

    router.delete("/api/v1/assets/:assetId", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const deleted = await options.assets.delete(account.id, String(request.params.assetId));
        if (!deleted) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset was not found");
        response.status(204).end();
    }));

    return router;
}

export function createDefaultAssetOptions(sessionService: AssetRouteOptions["sessionService"], projects: ProjectRepository): AssetRouteOptions {
    return { assets: new InMemoryAssetRepository(), projects, sessionService };
}

async function assertProject(projects: ProjectRepository, accountId: string, projectId: string): Promise<void> {
    if (!(await projects.get(accountId, projectId))) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
}

function getAccount(value: unknown): AuthenticatedContext["account"] {
    if (!value || typeof value !== "object" || !("account" in value)) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
    return (value as AuthenticatedContext).account;
}

function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
    const result = schema.safeParse(value);
    if (!result.success) throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid");
    return result.data;
}

function toPublicAsset(asset: AssetRecord) {
    return { ...asset, createdAt: asset.createdAt.toISOString() };
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
    return (request, response, next) => { void handler(request, response).catch(next); };
}
