import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { SESSION_SERVICE, SUB2API_CLIENT } from "../app.tokens.js";
import { HttpError } from "../http/errors.js";
import { Sub2ApiClient, Sub2ApiClientError } from "./sub2api-client.js";
import { CanvasAccount, SessionService } from "./session-service.js";

const launchCodeSchema = z.object({ launch_code: z.string().trim().min(32).max(256) });

@Injectable()
export class AuthService {
    constructor(
        @Inject(SUB2API_CLIENT) private readonly sub2api: Sub2ApiClient,
        @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    ) {}

    async exchange(launchCode: unknown, canvasOrigin: string): Promise<{ account: CanvasAccount; token: string; expiresAt: Date }> {
        const parsed = launchCodeSchema.safeParse(launchCode);
        if (!parsed.success) throw new HttpError(400, "INVALID_LAUNCH_CODE", "A valid launch code is required");
        const accessToken = await this.call(() => this.sub2api.exchangeLaunchCode(parsed.data.launch_code, canvasOrigin));
        const identity = await this.call(() => this.sub2api.verifyAccessToken(accessToken));
        if (identity.status.toLowerCase() !== "active") throw new HttpError(403, "SUB2API_ACCOUNT_INACTIVE", "Sub2API account is not active");
        const account = await this.sessions.upsertAccount(identity);
        const created = await this.sessions.createSession(account, accessToken);
        return { account, token: created.token, expiresAt: created.session.expiresAt };
    }

    async session(token: string | undefined) {
        if (!token) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
        const session = await this.sessions.resolveSession(token);
        if (!session) throw new HttpError(401, "SESSION_REQUIRED", "Canvas session is required");
        return session;
    }

    async logout(token: string | undefined): Promise<void> {
        if (token) await this.sessions.revokeSession(token);
    }

    private async call<T>(operation: () => Promise<T>): Promise<T> {
        try { return await operation(); }
        catch (error) {
            if (error instanceof HttpError) throw error;
            if (error instanceof Sub2ApiClientError) throw new HttpError(error.statusCode, error.code, error.message);
            throw error;
        }
    }
}
