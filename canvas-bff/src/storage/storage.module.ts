import { Module } from "@nestjs/common";
import type { CanvasBffConfig } from "../config/config.js";
import { BFF_CONFIG, CANVAS_BFF_OVERRIDES, OBJECT_STORAGE } from "../app.tokens.js";
import type { CanvasBffOverrides } from "../app-overrides.js";
import { InMemoryObjectStorage } from "./object-storage.js";
import type { ObjectStorage } from "./object-storage.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

@Module({
    providers: [{ provide: OBJECT_STORAGE, useFactory: (config: CanvasBffConfig, overrides?: CanvasBffOverrides): ObjectStorage => overrides?.objectStorage ?? (config.environment === "test" ? new InMemoryObjectStorage({ signingSecret: process.env.CANVAS_OBJECT_SIGNING_SECRET ?? "development-object-signing-secret" }) : new S3ObjectStorage({ endpoint: required("S3_ENDPOINT"), publicEndpoint: process.env.S3_PUBLIC_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", bucket: required("S3_BUCKET"), accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") })), inject: [BFF_CONFIG, { token: CANVAS_BFF_OVERRIDES, optional: true }] }],
    exports: [OBJECT_STORAGE],
})
export class StorageModule {}

function required(name: string): string { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} is required`); return value; }
