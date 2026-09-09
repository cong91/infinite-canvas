import { DynamicModule, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import type { CanvasBffOverrides } from "./app-overrides.js";
import type { CanvasBffConfig } from "./config/config.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HttpModule } from "./http/http.module.js";
import { SecurityMiddleware } from "./http/security.middleware.js";
import { CanvasExceptionFilter } from "./http/canvas-exception.filter.js";
import { AuthModule } from "./auth/auth.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { GenerationsModule } from "./generations/generations.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { WorkerModule } from "./worker/worker.module.js";
import { HealthController } from "./health.controller.js";

@Module({})
export class AppModule implements NestModule {
    static forRoot(config: CanvasBffConfig, overrides: CanvasBffOverrides = {}): DynamicModule {
        return {
            module: AppModule,
            imports: [ConfigModule.forRoot(config, overrides), HttpModule, DatabaseModule, AuthModule, ProjectsModule, ProvidersModule, StorageModule, AssetsModule, GenerationsModule, WorkerModule],
            controllers: [HealthController],
            providers: [{ provide: APP_FILTER, useClass: CanvasExceptionFilter }],
        };
    }

    configure(consumer: MiddlewareConsumer) { consumer.apply(SecurityMiddleware).forRoutes("*"); }
}
