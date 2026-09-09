import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { ASSET_REPOSITORY, BFF_CONFIG, CANVAS_BFF_OVERRIDES, DATABASE_POOL } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { InMemoryAssetRepository } from "./repository.js";
import { PostgresAssetRepository } from "./postgres-repository.js";
import { StorageModule } from "../storage/storage.module.js";
import { AssetsService } from "./assets.service.js";
import { AssetsController, ProjectAssetsController } from "./assets.controller.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
    imports: [AuthModule, StorageModule, ProjectsModule],
    controllers: [AssetsController, ProjectAssetsController],
    providers: [
        { provide: ASSET_REPOSITORY, useFactory: (config: CanvasBffConfig, pool: Pool | undefined, overrides?: CanvasBffOverrides) => overrides?.assets ?? (config.environment === "test" ? new InMemoryAssetRepository() : new PostgresAssetRepository(pool!)), inject: [BFF_CONFIG, { token: DATABASE_POOL, optional: true }, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        AssetsService,
    ],
    exports: [ASSET_REPOSITORY, AssetsService],
})
export class AssetsModule {}
