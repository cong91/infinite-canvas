import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { HttpError } from "../http/errors.js";
import { SESSION_COOKIE_NAME, type CanvasAccount, SessionService } from "./session-service.js";
import { Sub2ApiClient, Sub2ApiClientError } from "./sub2api-client.js";

export type AuthenticatedContext = {
    account: CanvasAccount;
    sessionExpiresAt: Date;
};

export type AuthRouteOptions = {
    canvasOrigin: string;
    sub2ApiClient: Sub2ApiClient;
    sessionService: SessionService;
    secureCookies?: boolean;
};

export function createAuthRouter(options: AuthRouteOptions): Router {
    const router = Router();

    router.post("/api/v1/sso/launch/exchange", requireCanvasOrigin(options.canvasOrigin), asyncHandler(async (request, response) => {
        const launchCode = parseLaunchCode(request.body);
        const accessToken = await exchangeSub2ApiLaunchCode(options.sub2ApiClient, launchCode, options.canvasOrigin);
        const identity = await verifySub2ApiToken(options.sub2ApiClient, accessToken);
        if (identity.status.toLowerCase() !== "active") {
            throw new HttpError(403, "SUB2API_ACCOUNT_INACTIVE", "Sub2API account is not active");
        }
        const account = await options.sessionService.upsertAccount(identity);
        const created = await options.sessionService.createSession(account, accessToken);
        setSessionCookie(response, created.token, created.session.expiresAt, options.secureCookies ?? true);
        response.status(200).json({
            data: {
                account: publicAccount(account),
                sessionExpiresAt: created.session.expiresAt.toISOString(),
            },
            requestId: response.locals.requestId,
        });
    }));

    router.get("/api/v1/session", asyncHandler(async (request, response) => {
        const session = await requireSession(options.sessionService, request);
        response.status(200).json({
            data: {
                account: publicAccount(session.account),
                sessionExpiresAt: session.sessionExpiresAt.toISOString(),
            },
            requestId: response.locals.requestId,
        });
    }));

    router.post("/api/v1/logout", requireCanvasOrigin(options.canvasOrigin), asyncHandler(async (request, response) => {
        const token = readCookie(request, SESSION_COOKIE_NAME);
        if (token) await options.sessionService.revokeSession(token);
        clearSessionCookie(response, options.secureCookies ?? true);
        response.status(200).json({ data: { ok: true }, requestId: response.locals.requestId });
    }));

    return router;
}

export const requireSessionMiddleware = (sessionService: SessionService): RequestHandler => (request, response, next) => {
    void requireSession(sessionService, request).then((auth) => {
        response.locals.auth = auth;
        next();
    }).catch(next);
};

async function requireSession(sessionService: SessionService, request: Request): Promise<AuthenticatedContext> {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    const session = token ? await sessionService.resolveSession(token) : null;
    if (!session) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
    return { account: session.account, sessionExpiresAt: session.expiresAt };
}

const launchCodeBody = z.object({ launch_code: z.string().trim().min(32).max(256) });

function parseLaunchCode(value: unknown): string {
    const parsed = launchCodeBody.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "INVALID_LAUNCH_CODE", "A valid launch code is required");
    return parsed.data.launch_code;
}

function readCookie(request: Request, name: string): string | null {
    const header = request.header("cookie") || "";
    for (const pair of header.split(";")) {
        const separator = pair.indexOf("=");
        if (separator === -1) continue;
        const key = pair.slice(0, separator).trim();
        if (key !== name) continue;
        try {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

export function readCanvasSessionToken(request: Request): string | null {
    return readCookie(request, SESSION_COOKIE_NAME);
}

function setSessionCookie(response: Response, token: string, expiresAt: Date, secure: boolean): void {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
    response.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(response: Response, secure: boolean): void {
    response.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`);
}

function requireCanvasOrigin(canvasOrigin: string): RequestHandler {
    return (request, _response, next) => {
        if (request.header("origin") !== canvasOrigin) {
            next(new HttpError(403, "ORIGIN_REQUIRED", "A valid Canvas origin is required"));
            return;
        }
        next();
    };
}

async function verifySub2ApiToken(client: Sub2ApiClient, token: string) {
    try {
        return await client.verifyAccessToken(token);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof Sub2ApiClientError) throw new HttpError(error.statusCode, error.code, error.message);
        throw error;
    }
}

async function exchangeSub2ApiLaunchCode(client: Sub2ApiClient, launchCode: string, canvasOrigin: string) {
    try {
        return await client.exchangeLaunchCode(launchCode, canvasOrigin);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof Sub2ApiClientError) throw new HttpError(error.statusCode, error.code, error.message);
        throw error;
    }
}

function publicAccount(account: CanvasAccount): Omit<CanvasAccount, "status"> & { status: string } {
    return { ...account };
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
    return (request, response, next) => {
        void handler(request, response).catch(next);
    };
}
