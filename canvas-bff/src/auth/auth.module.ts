import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { BFF_CONFIG, CANVAS_BFF_OVERRIDES, DATABASE_POOL, SESSION_REPOSITORY, SESSION_SERVICE, SUB2API_CLIENT } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";
import { SessionService, type SessionRepository } from "./session-service.js";
import { Sub2ApiClient } from "./sub2api-client.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { CanvasSessionGuard } from "./auth.guard.js";
import { InMemorySessionRepository } from "./session-service.js";
import type { CanvasBffOverrides } from "../app-overrides.js";

@Module({
    controllers: [AuthController],
    providers: [
        { provide: SESSION_REPOSITORY, useFactory: (config: CanvasBffConfig, pool: Pool | undefined, overrides?: CanvasBffOverrides) => overrides?.sessionRepository ?? (config.environment === "test" ? new InMemorySessionRepository() : new PostgresSessionRepository(pool!)), inject: [BFF_CONFIG, { token: DATABASE_POOL, optional: true }, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        { provide: SESSION_SERVICE, useFactory: (repository: SessionRepository, overrides?: CanvasBffOverrides) => overrides?.sessionService ?? new SessionService(repository), inject: [SESSION_REPOSITORY, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        { provide: SUB2API_CLIENT, useFactory: (config: CanvasBffConfig, overrides?: CanvasBffOverrides) => overrides?.sub2ApiClient ?? new Sub2ApiClient(config.sub2ApiBaseUrl, fetch, 5_000, config.sub2ApiCanvasBffSecret), inject: [BFF_CONFIG, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        AuthService,
        CanvasSessionGuard,
    ],
    exports: [SESSION_SERVICE, SUB2API_CLIENT, AuthService, CanvasSessionGuard],
})
export class AuthModule {}
