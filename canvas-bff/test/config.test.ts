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
