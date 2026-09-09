import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";

import { HttpError, toErrorEnvelope } from "./errors.js";

@Catch()
export class CanvasExceptionFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();
        const requestId = String(response.locals.requestId || request.header("x-request-id") || "unknown");
        const normalized = normalizeNestException(error);
        const result = toErrorEnvelope(normalized, requestId);
        response.status(result.statusCode).json(result.body);
    }
}

function normalizeNestException(error: unknown): unknown {
    if (error instanceof HttpError) return error;
    if (!(error instanceof HttpException)) return error;
    const status = error.getStatus();
    if (status === 400) return new HttpError(400, "INVALID_REQUEST", "Request body is invalid");
    if (status === 401) return new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
    if (status === 404) return new HttpError(404, "NOT_FOUND", "Route not found");
    if (status === 503) return new HttpError(503, "DEPENDENCY_NOT_READY", "Canvas BFF dependencies are not ready");
    return new HttpError(status, "HTTP_ERROR", "Request failed");
}
