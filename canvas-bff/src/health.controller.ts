import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "pg";

import { BFF_CONFIG, DATABASE_POOL, OBJECT_STORAGE } from "./app.tokens.js";
import type { CanvasBffConfig } from "./config/config.js";
import { assertDatabaseReady } from "./database/database-pool.js";
import type { ObjectStorage } from "./storage/object-storage.js";
import { RequestId } from "./http/request-context.js";

@Controller()
export class HealthController {
    constructor(@Inject(BFF_CONFIG) private readonly config: CanvasBffConfig, @Inject(DATABASE_POOL) private readonly pool: Pool | undefined, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

    @Get("health") health(@RequestId() requestId: string) { return { data: { service: "canvas-bff", status: "ok" }, requestId }; }

    @Get("ready")
    async ready(@RequestId() requestId: string) {
        try {
            if (this.config.environment !== "test") {
                if (!this.pool) throw new Error("database pool unavailable");
                await assertDatabaseReady(this.pool);
                await this.storage.listAll();
            }
            return { data: { service: "canvas-bff", status: "ready" }, requestId };
        } catch {
            throw new ServiceUnavailableException("Canvas BFF is not ready");
        }
    }
}
