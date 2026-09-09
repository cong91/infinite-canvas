import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { BFF_CONFIG, CANVAS_BFF_OVERRIDES, DATABASE_POOL, PROVIDER_REPOSITORY, PROVIDER_SECRET_BOX, SUB2API_CATALOG } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { ProviderSecretBox } from "../crypto/secret-box.js";
import { InMemoryProviderRepository } from "./repository.js";
import { PostgresProviderRepository } from "./postgres-repository.js";
import { Sub2ApiCatalogAdapter } from "./sub2api-catalog.js";
import { ProvidersService } from "./providers.service.js";
import { ProvidersController } from "./providers.controller.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
    imports: [AuthModule],
    controllers: [ProvidersController],
    providers: [
        { provide: PROVIDER_REPOSITORY, useFactory: (config: CanvasBffConfig, pool: Pool | undefined, overrides?: CanvasBffOverrides) => overrides?.providers ?? (config.environment === "test" ? new InMemoryProviderRepository() : new PostgresProviderRepository(pool!)), inject: [BFF_CONFIG, { token: DATABASE_POOL, optional: true }, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        { provide: PROVIDER_SECRET_BOX, useFactory: (overrides?: CanvasBffOverrides) => overrides?.providerSecretBox ?? ProviderSecretBox.fromEnvironment(), inject: [{ token: CANVAS_BFF_OVERRIDES, optional: true }] },
        { provide: SUB2API_CATALOG, useFactory: (config: CanvasBffConfig, overrides?: CanvasBffOverrides) => overrides?.catalog ?? new Sub2ApiCatalogAdapter(config.sub2ApiBaseUrl), inject: [BFF_CONFIG, { token: CANVAS_BFF_OVERRIDES, optional: true }] },
        ProvidersService,
    ],
    exports: [PROVIDER_REPOSITORY, PROVIDER_SECRET_BOX, SUB2API_CATALOG, ProvidersService],
})
export class ProvidersModule {}
