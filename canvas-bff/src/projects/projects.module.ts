import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { BFF_CONFIG, CANVAS_BFF_OVERRIDES, DATABASE_POOL, PROJECT_REPOSITORY } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { InMemoryProjectRepository } from "./repository.js";
import { PostgresProjectRepository } from "./postgres-repository.js";
import { ProjectsService } from "./projects.service.js";
import { ProjectsController } from "./projects.controller.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
    imports: [AuthModule],
    controllers: [ProjectsController],
    providers: [
        { provide: PROJECT_REPOSITORY, useFactory: (config: CanvasBffConfig, pool: Pool | undefined, overrides?: CanvasBffOverrides) => overrides?.projects ?? (config.environment === "test" ? new InMemoryProjectRepository() : new PostgresProjectRepository(pool!)), inject: [BFF_CONFIG, { token: DATABASE_POOL, optional: true }, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        ProjectsService,
    ],
    exports: [PROJECT_REPOSITORY, ProjectsService],
})
export class ProjectsModule {}
