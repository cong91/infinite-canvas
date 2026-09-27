import { expect, test } from "bun:test";

test("resolves a model duration limit by case-insensitive prefix match", async () => {
    const { videoDurationLimit } = await import("../src/lib/canvas/video-capabilities");
    const rules = [{ pattern: "grok-imagine-video", maxDurationSeconds: 15 }];

    expect(videoDurationLimit("grok-imagine-video-1.5", rules)).toBe(15);
    expect(videoDurationLimit("Grok-Imagine-Video", rules)).toBe(15);
    expect(videoDurationLimit("canvas::prov::grok-imagine-video-1.5", null)).toBeUndefined();
});

test("leaves unknown models and empty rules unrestricted", async () => {
    const { videoDurationLimit } = await import("../src/lib/canvas/video-capabilities");

    expect(videoDurationLimit("sora-2", [{ pattern: "grok-imagine-video", maxDurationSeconds: 15 }])).toBeUndefined();
    expect(videoDurationLimit("grok-imagine-video", undefined)).toBeUndefined();
    expect(videoDurationLimit(undefined, [{ pattern: "grok-imagine-video", maxDurationSeconds: 15 }])).toBeUndefined();
});
