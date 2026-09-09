import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { AuthenticatedContext } from "../auth/authenticated-context.js";

export const CurrentAccount = createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthenticatedContext }>();
    return request.auth?.account;
});

export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.res?.locals.requestId as string;
});

export const CanvasSessionToken = createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.cookies?.canvas_session as string | undefined;
});
