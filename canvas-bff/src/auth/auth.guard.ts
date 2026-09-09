import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { SESSION_SERVICE } from "../app.tokens.js";
import { HttpError } from "../http/errors.js";
import type { AuthenticatedContext } from "./authenticated-context.js";
import { SessionService } from "./session-service.js";

@Injectable()
export class CanvasSessionGuard implements CanActivate {
    constructor(@Inject(SESSION_SERVICE) private readonly sessions: SessionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request & { auth?: AuthenticatedContext }>();
        const token = request.cookies?.canvas_session as string | undefined;
        const session = token ? await this.sessions.resolveSession(token) : null;
        if (!session) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
        request.auth = { account: session.account, sessionExpiresAt: session.expiresAt };
        return true;
    }
}
