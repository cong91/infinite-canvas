import { Body, Controller, Get, HttpCode, Inject, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { BFF_CONFIG, CANVAS_BFF_OVERRIDES } from "../app.tokens.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import type { CanvasBffConfig } from "../config/config.js";
import { CanvasSessionToken, RequestId } from "../http/request-context.js";
import { CanvasSessionGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import type { CanvasAccount } from "./session-service.js";

@Controller("api/v1")
export class AuthController {
    constructor(@Inject(BFF_CONFIG) private readonly config: CanvasBffConfig, @Inject(AuthService) private readonly auth: AuthService, @Inject(CANVAS_BFF_OVERRIDES) private readonly overrides: CanvasBffOverrides) {}

    @Post("sso/launch/exchange")
    @HttpCode(200)
    async exchange(@Body() body: unknown, @Res({ passthrough: true }) response: Response, @RequestId() requestId: string) {
        const created = await this.auth.exchange(body, this.config.canvasOrigin);
        setSessionCookie(response, created.token, created.expiresAt, this.overrides.secureCookies ?? this.config.environment === "production");
        return { data: { account: publicAccount(created.account), sessionExpiresAt: created.expiresAt.toISOString() }, requestId };
    }

    @Get("session")
    @UseGuards(CanvasSessionGuard)
    async getSession(@CanvasSessionToken() token: string, @RequestId() requestId: string) {
        const session = await this.auth.session(token);
        return { data: { account: publicAccount(session.account), sessionExpiresAt: session.expiresAt.toISOString() }, requestId };
    }

    @Post("logout")
    @HttpCode(200)
    async logout(@CanvasSessionToken() token: string | undefined, @Res({ passthrough: true }) response: Response, @RequestId() requestId: string) {
        await this.auth.logout(token);
        clearSessionCookie(response, this.overrides.secureCookies ?? this.config.environment === "production");
        return { data: { ok: true }, requestId };
    }
}

function publicAccount(account: CanvasAccount) { return { ...account }; }

function setSessionCookie(response: Response, token: string, expiresAt: Date, secure: boolean): void {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
    response.setHeader("Set-Cookie", `canvas_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(response: Response, secure: boolean): void {
    response.setHeader("Set-Cookie", `canvas_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`);
}
