import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { HttpError } from "../http/errors.js";
import { requireSessionMiddleware, type AuthenticatedContext } from "../auth/routes.js";
import { InMemoryProjectRepository, type ProjectRecord, type ProjectRepository } from "./repository.js";

export type ProjectRouteOptions = {
    projects: ProjectRepository;
    sessionService: Parameters<typeof requireSessionMiddleware>[0];
};

const projectBody = z.object({ name: z.string().trim().min(1).max(200), data: z.record(z.unknown()).default({}) });
const projectPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), data: z.record(z.unknown()).optional(), revision: z.number().int().positive().optional() });

export function createProjectRouter(options: ProjectRouteOptions): Router {
    const router = Router();
    const authenticated = requireSessionMiddleware(options.sessionService);

    router.get("/api/v1/projects", authenticated, asyncHandler(async (_request, response) => {
        const account = getAccount(response.locals.auth);
        response.json({ data: (await options.projects.list(account.id)).map(toPublicProject), requestId: response.locals.requestId });
    }));

    router.post("/api/v1/projects", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const body = parseBody(projectBody, request.body);
        const project = await options.projects.create({ accountId: account.id, name: body.name, data: body.data });
        response.status(201).json({ data: toPublicProject(project), requestId: response.locals.requestId });
    }));

    router.get("/api/v1/projects/:projectId", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const project = await options.projects.get(account.id, String(request.params.projectId));
        if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        response.json({ data: toPublicProject(project), requestId: response.locals.requestId });
    }));

    router.patch("/api/v1/projects/:projectId", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const id = String(request.params.projectId);
        if (!(await options.projects.get(account.id, id))) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        const project = await options.projects.update(account.id, id, parseBody(projectPatch, request.body));
        if (!project) throw new HttpError(409, "PROJECT_REVISION_CONFLICT", "Project was updated elsewhere");
        response.json({ data: toPublicProject(project), requestId: response.locals.requestId });
    }));

    router.delete("/api/v1/projects/:projectId", authenticated, asyncHandler(async (request, response) => {
        const account = getAccount(response.locals.auth);
        const deleted = await options.projects.delete(account.id, String(request.params.projectId));
        if (!deleted) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        response.status(204).end();
    }));
    return router;
}
export function createDefaultProjectOptions(sessionService: ProjectRouteOptions["sessionService"]): ProjectRouteOptions {
    return { projects: new InMemoryProjectRepository(), sessionService };
}

function toPublicProject(project: ProjectRecord) {
    return {
        id: project.id,
        name: project.name,
        data: project.data,
        revision: project.revision,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
    };
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
    return (request, response, next) => { void handler(request, response).catch(next); };
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
