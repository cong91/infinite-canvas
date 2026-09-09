import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { BFF_CONFIG } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { HttpError } from "./errors.js";

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
    constructor(@Inject(BFF_CONFIG) private readonly config: CanvasBffConfig) {}

    use(request: Request, response: Response, next: NextFunction): void {
        const requestId = randomUUID();
        response.locals.requestId = requestId;
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Vary", "Origin");
        const origin = request.header("origin");
        if (!isAllowedOrigin(origin, this.config.canvasOrigin)) {
            next(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed"));
            return;
        }
        if (origin) {
            response.setHeader("Access-Control-Allow-Origin", this.config.canvasOrigin);
            response.setHeader("Access-Control-Allow-Credentials", "true");
            response.setHeader("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token, X-Request-Id");
            response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        }
        if (request.method === "OPTIONS") {
            response.status(204).end();
            return;
        }
        if (["POST", "PATCH", "DELETE"].includes(request.method) && origin !== this.config.canvasOrigin) {
            next(new HttpError(403, "ORIGIN_REQUIRED", "A valid Canvas origin is required for state-changing requests"));
            return;
        }
        next();
    }
}

export function isAllowedOrigin(requestOrigin: string | undefined, canvasOrigin: string): boolean {
    if (!requestOrigin) return true;
    try {
        return new URL(requestOrigin).origin === canvasOrigin && requestOrigin === canvasOrigin;
    } catch {
        return false;
    }
}
