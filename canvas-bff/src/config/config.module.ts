import { Global, DynamicModule, Module } from "@nestjs/common";
import { BFF_CONFIG, CANVAS_BFF_OVERRIDES } from "../app.tokens.js";
import type { CanvasBffConfig } from "./config.js";
import type { CanvasBffOverrides } from "../app-overrides.js";

@Global()
@Module({})
export class ConfigModule {
    static forRoot(config: CanvasBffConfig, overrides: CanvasBffOverrides = {}): DynamicModule {
        return { module: ConfigModule, providers: [{ provide: BFF_CONFIG, useValue: config }, { provide: CANVAS_BFF_OVERRIDES, useValue: overrides }], exports: [BFF_CONFIG, CANVAS_BFF_OVERRIDES] };
    }
}
