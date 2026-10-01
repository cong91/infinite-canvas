import { describe, expect, test } from "bun:test";

import { guessCapability } from "../src/stores/use-config-store";

describe("guessCapability", () => {
    test("classifies composite group model list from Sub2API", () => {
        // Live /v1/models payload of the composite "Video" group (token.v-claw.org, 2026-09-30).
        expect(guessCapability("jimeng-seedance-2.5")).toBe("video");
        expect(guessCapability("seedance-2.0-mini-deal")).toBe("video");
        expect(guessCapability("grok-imagine-video")).toBe("video");
        expect(guessCapability("grok-imagine-video-1.5")).toBe("video");
        expect(guessCapability("grok-imagine-video-1.5-preview")).toBe("video");
        expect(guessCapability("grok-imagine-image")).toBe("image");
        expect(guessCapability("grok-imagine-image-2.0")).toBe("image");
        expect(guessCapability("grok-imagine-image-quality")).toBe("image");
        expect(guessCapability("composer-2.5")).toBe("text");
        expect(guessCapability("grok-4.7")).toBe("text");
        expect(guessCapability("grok-3-mini")).toBe("text");
    });

    test("keeps existing classifications stable", () => {
        expect(guessCapability("gpt-image-2")).toBe("image");
        expect(guessCapability("gpt-5.5")).toBe("text");
        expect(guessCapability("gpt-4o-mini-tts")).toBe("audio");
        expect(guessCapability("sora-2")).toBe("video");
        expect(guessCapability("seedream-4.0")).toBe("image");
    });
});
