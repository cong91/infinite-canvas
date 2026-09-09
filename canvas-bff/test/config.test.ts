import assert from "node:assert/strict";
import test from "node:test";

import { canvasBffConfigSchema } from "../src/config.js";

test("production configuration requires an HTTPS Canvas origin", () => {
    const result = canvasBffConfigSchema.safeParse({
        port: 17372,
        canvasOrigin: "http://canvas.example.test",
        sub2ApiBaseUrl: "https://sub2api.example.test",
        sub2ApiCanvasBffSecret: "canvas-bff-production-secret-0123456789",
        environment: "production",
    });
    assert.equal(result.success, false);
    if (!result.success) assert(result.error.issues.some((issue) => issue.message === "CANVAS_ORIGIN must use HTTPS in production"));
});

test("configuration accepts a positive logical storage retention cap", () => {
    const result = canvasBffConfigSchema.safeParse({
        port: 17372,
        canvasOrigin: "https://canvas.example.test",
        sub2ApiBaseUrl: "https://sub2api.example.test",
        sub2ApiCanvasBffSecret: "canvas-bff-production-secret-0123456789",
        environment: "production",
        storageRetentionMaxBytes: "42949672960",
    });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.storageRetentionMaxBytes, 42_949_672_960);
});

test("configuration rejects a non-positive logical storage retention cap", () => {
    const result = canvasBffConfigSchema.safeParse({
        port: 17372,
        canvasOrigin: "https://canvas.example.test",
        sub2ApiBaseUrl: "https://sub2api.example.test",
        sub2ApiCanvasBffSecret: "canvas-bff-production-secret-0123456789",
        environment: "production",
        storageRetentionMaxBytes: 0,
    });
    assert.equal(result.success, false);
});

test("configuration treats an empty retention environment value as disabled", () => {
    const result = canvasBffConfigSchema.safeParse({
        port: 17372,
        canvasOrigin: "https://canvas.example.test",
        sub2ApiBaseUrl: "https://sub2api.example.test",
        sub2ApiCanvasBffSecret: "canvas-bff-production-secret-0123456789",
        environment: "production",
        storageRetentionMaxBytes: "",
    });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.storageRetentionMaxBytes, undefined);
});
