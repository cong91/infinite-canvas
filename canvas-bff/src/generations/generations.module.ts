import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { ASSET_REPOSITORY, BFF_CONFIG, CANVAS_BFF_OVERRIDES, DATABASE_POOL, GENERATION_REPOSITORY, GENERATION_SERVICE, OBJECT_STORAGE, PROJECT_REPOSITORY, PROVIDER_REPOSITORY } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import { InMemoryGenerationRepository } from "./repository.js";
import { PostgresGenerationRepository } from "./postgres-repository.js";
import { GenerationService, type GenerationServiceOptions } from "./generation-domain.service.js";
import { GenerationsController } from "./generations.controller.js";
import { GenerationsService } from "./generations.service.js";
import { AssetsModule } from "../assets/assets.module.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
    imports: [AuthModule, AssetsModule, ProjectsModule, ProvidersModule, StorageModule],
    controllers: [GenerationsController],
    providers: [
        { provide: GENERATION_REPOSITORY, useFactory: (config: CanvasBffConfig, pool: Pool | undefined, overrides?: CanvasBffOverrides) => overrides?.generations ?? (config.environment === "test" ? new InMemoryGenerationRepository() : new PostgresGenerationRepository(pool!)), inject: [BFF_CONFIG, { token: DATABASE_POOL, optional: true }, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        { provide: GENERATION_SERVICE, useFactory: (generations: GenerationServiceOptions["generations"], projects: GenerationServiceOptions["projects"], providers: GenerationServiceOptions["providers"], overrides?: CanvasBffOverrides) => overrides?.generationService ?? new GenerationService({ generations, projects, providers }), inject: [GENERATION_REPOSITORY, PROJECT_REPOSITORY, PROVIDER_REPOSITORY, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        GenerationsService,
    ],
    exports: [GENERATION_REPOSITORY, GENERATION_SERVICE, GenerationsService],
})
export class GenerationsModule {}
