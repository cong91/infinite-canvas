import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import type { Pool } from "pg";

import { BFF_CONFIG, DATABASE_POOL } from "../app.tokens.js";
import type { CanvasBffConfig } from "../config/config.js";
import { createDatabasePool } from "./database-pool.js";

@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
    constructor(@Inject(DATABASE_POOL) private readonly pool: Pool | undefined) {}

    async onModuleDestroy(): Promise<void> {
        await this.pool?.end();
    }
}

@Global()
@Module({
    providers: [
        { provide: DATABASE_POOL, useFactory: (config: CanvasBffConfig) => config.environment === "test" ? undefined : createDatabasePool(), inject: [BFF_CONFIG] },
        DatabaseLifecycle,
    ],
    exports: [DATABASE_POOL],
})
export class DatabaseModule {
}
