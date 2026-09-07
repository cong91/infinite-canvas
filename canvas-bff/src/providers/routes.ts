import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";

import { ProviderSecretBox } from "../crypto/secret-box.js";
import { HttpError } from "../http/errors.js";
import { requireSessionMiddleware, type AuthenticatedContext } from "../auth/routes.js";
import { InMemoryProviderRepository, type ProviderRecord, type ProviderRepository } from "./repository.js";
import { Sub2ApiCatalogAdapter } from "./sub2api-catalog.js";

export type ProviderRouteOptions = {
    catalog: Sub2ApiCatalogAdapter;
    secretBox: ProviderSecretBox;
    providers: ProviderRepository;
    sessionService: Parameters<typeof requireSessionMiddleware>[0];
};

const providerBody = z.object({
    name: z.string().trim().min(1).max(120),
    providerType: z.string().trim().min(1).max(80).default("openai-compatible"),
    model: z.string().trim().max(200).optional(),
    group: z.string().trim().max(200).optional(),
    channel: z.string().trim().max(200).optional(),
    catalogKeyId: z.string().trim().min(1).max(200).optional(),
    secret: z.string().min(1).max(4_096).optional(),
}).superRefine((value, context) => {
    if (!value.catalogKeyId && !value.secret) context.addIssue({ code: z.ZodIssueCode.custom, message: "catalogKeyId or secret is required" });
});

const providerPatch = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().max(200).optional(),
    group: z.string().trim().max(200).optional(),
    channel: z.string().trim().max(200).optional(),
    status: z.enum(["active", "disabled"]).optional(),
});

export function createProviderRouter(options: ProviderRouteOptions): Router {
    const router = Router();
    const authenticated = requireSessionMiddleware(options.sessionService);

    router.get("/api/v1/providers/catalog", authenticated, asyncHandler(async (request, response) => {
        const accessToken = readBearerToken(request);
        const catalog = await options.catalog.listCatalog(accessToken);
        response.json({ data: catalog, requestId: response.locals.requestId });
    }));

    router.get("/api/v1/providers", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        response.json({ data: options.providers.list(account.id).map(toPublicProvider), requestId: response.locals.requestId });
    });

    router.get("/api/v1/providers/:providerId", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const record = options.providers.get(account.id, String(request.params.providerId));
        if (!record) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        response.json({ data: toPublicProvider(record), requestId: response.locals.requestId });
    });

    router.post("/api/v1/providers", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const body = parseBody(providerBody, request.body);
        let secret = body.secret;
        let catalogItem: { id: string; providerType?: string; model?: string; group?: string; channel?: string } | undefined;
        if (body.catalogKeyId) {
            const accessToken = readBearerToken(request);
            const resolved = await options.catalog.getApiKeySecret(accessToken, body.catalogKeyId);
            secret = resolved.secret;
            catalogItem = resolved.item;
        }
        if (!secret) throw new HttpError(400, "PROVIDER_SECRET_REQUIRED", "Provider secret is required");
        const description = options.secretBox.describe(secret);
        const existing = body.catalogKeyId && options.providers.list(account.id).find((item) => item.sub2ApiKeyId === body.catalogKeyId);
        if (existing) {
            response.status(200).json({ data: toPublicProvider(existing), requestId: response.locals.requestId });
            return;
        }
        const record = options.providers.create({
            accountId: account.id,
            name: body.name,
            providerType: catalogItem?.providerType ?? body.providerType,
            ...(body.model ?? catalogItem?.model ? { model: body.model ?? catalogItem?.model } : {}),
            ...(body.group ?? catalogItem?.group ? { group: body.group ?? catalogItem?.group } : {}),
            ...(body.channel ?? catalogItem?.channel ? { channel: body.channel ?? catalogItem?.channel } : {}),
            ...(body.catalogKeyId ? { sub2ApiKeyId: body.catalogKeyId } : {}),
            secret: options.secretBox.encrypt(secret),
            secretDescription: description,
            status: "active",
        });
        response.status(201).json({ data: toPublicProvider(record), requestId: response.locals.requestId });
    }));

    router.patch("/api/v1/providers/:providerId", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const id = String(request.params.providerId);
        const record = options.providers.update(account.id, id, parseBody(providerPatch, request.body));
        if (!record) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        response.json({ data: toPublicProvider(record), requestId: response.locals.requestId });
    });

    router.delete("/api/v1/providers/:providerId", authenticated, (request, response) => {
        const account = getAccount(response.locals.auth);
        const deleted = options.providers.delete(account.id, String(request.params.providerId));
        if (!deleted) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        response.status(204).end();
    });

    return router;
}

export function createDefaultProviderOptions(sessionService: ProviderRouteOptions["sessionService"], sub2ApiBaseUrl: string): ProviderRouteOptions {
    return {
        catalog: new Sub2ApiCatalogAdapter(sub2ApiBaseUrl),
        secretBox: ProviderSecretBox.fromEnvironment(),
        providers: new InMemoryProviderRepository(),
        sessionService,
    };
}

function toPublicProvider(record: ProviderRecord) {
    return {
        id: record.id,
        name: record.name,
        providerType: record.providerType,
        ...(record.model ? { model: record.model } : {}),
        ...(record.group ? { group: record.group } : {}),
        ...(record.channel ? { channel: record.channel } : {}),
        ...(record.sub2ApiKeyId ? { sub2ApiKeyId: record.sub2ApiKeyId } : {}),
        status: record.status,
        fingerprint: record.secretDescription.fingerprint,
        maskedKey: record.secretDescription.masked,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function getAccount(value: unknown): AuthenticatedContext["account"] {
    if (!value || typeof value !== "object" || !("account" in value)) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
    return (value as AuthenticatedContext).account;
}

function readBearerToken(request: Request): string {
    const match = /^Bearer\s+(.+)$/i.exec(request.header("authorization") || "");
    if (!match?.[1]?.trim()) throw new HttpError(401, "SUB2API_TOKEN_REQUIRED", "A Sub2API access token is required for catalog access");
    return match[1].trim();
}

function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
    const result = schema.safeParse(value);
    if (!result.success) throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid");
    return result.data;
}

function asyncHandler(handler: (request: Request, response: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
    return (request, response, next) => { void handler(request, response).catch(next); };
}
