import { Router } from "express";
import { z } from "zod";

import { requireSessionMiddleware, type AuthenticatedContext } from "../auth/routes.js";
import type { AssetRepository } from "../assets/repository.js";
import { HttpError } from "../http/errors.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { type GenerationRecord } from "./repository.js";
import { GenerationService, type CreateGenerationInput } from "./service.js";

export type GenerationRouteOptions = {
    service: GenerationService;
    assets: AssetRepository;
    objectStorage: ObjectStorage;
    sessionService: Parameters<typeof requireSessionMiddleware>[0];
};

const generationBody = z.object({
    projectId: z.string().trim().min(1),
    providerId: z.string().trim().min(1),
    kind: z.enum(["image", "video", "audio", "text"]),
    input: z.record(z.unknown()).default({}),
    clientRequestId: z.string().trim().min(1).max(200),
});

export function createGenerationRouter(options: GenerationRouteOptions): Router {
    const router = Router();
    const authenticated = requireSessionMiddleware(options.sessionService);

    router.get("/api/v1/generations", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        response.json({ data: options.service.list(account.id).map((record) => toPublicGeneration(record, account.id, options)), requestId: response.locals.requestId });
    });

    router.post("/api/v1/generations", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const body = parseBody(generationBody, request.body);
        const generation = options.service.create(account.id, body as CreateGenerationInput);
        response.status(201).json({ data: toPublicGeneration(generation, account.id, options), requestId: response.locals.requestId });
    });

    router.get("/api/v1/generations/:generationId", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const generation = options.service.get(account.id, String(request.params.generationId));
        if (!generation) throw new HttpError(404, "GENERATION_NOT_FOUND", "Generation was not found");
        response.json({ data: toPublicGeneration(generation, account.id, options), requestId: response.locals.requestId });
    });

    router.post("/api/v1/generations/:generationId/cancel", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const id = String(request.params.generationId);
        if (!options.service.get(account.id, id)) throw new HttpError(404, "GENERATION_NOT_FOUND", "Generation was not found");
        if (!options.service.cancel(account.id, id)) throw new HttpError(409, "GENERATION_NOT_CANCELLABLE", "Generation cannot be cancelled");
        response.json({ data: toPublicGeneration(options.service.get(account.id, id)!, account.id, options), requestId: response.locals.requestId });
    });

    return router;
}

function toPublicGeneration(record: GenerationRecord, accountId: string, options: GenerationRouteOptions) {
    const asset = record.outputAssetId ? options.assets.get(accountId, record.outputAssetId) : undefined;
    return {
        id: record.id,
        projectId: record.projectId,
        providerId: record.providerId,
        kind: record.kind,
        status: record.status,
        progress: record.progress,
        attempt: record.attempt,
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        ...(record.outputAssetId ? { outputAssetId: record.outputAssetId } : {}),
        ...(asset ? { asset: { id: asset.id, kind: asset.kind, objectKey: asset.objectKey, providerUrl: asset.providerUrl, metadata: asset.metadata } } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
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
