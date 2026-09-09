import "reflect-metadata";
import cookieParser from "cookie-parser";
import express from "express";
import { NestFactory } from "@nestjs/core";
import type { INestApplication, LoggerService } from "@nestjs/common";

import { AppModule } from "./app.module.js";
import type { CanvasBffOverrides } from "./app-overrides.js";
import type { CanvasBffConfig } from "./config/config.js";

export type CanvasApplicationOptions = {
    logger?: false | LoggerService;
};

export async function createCanvasApplication(
    config: CanvasBffConfig,
    overrides: CanvasBffOverrides = {},
    options: CanvasApplicationOptions = {},
): Promise<INestApplication> {
    const app = await NestFactory.create(AppModule.forRoot(config, overrides), {
        bodyParser: false,
        logger: options.logger,
    });
    const http = app.getHttpAdapter().getInstance();
    http.disable("x-powered-by");
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    app.enableShutdownHooks();
    return app;
}
