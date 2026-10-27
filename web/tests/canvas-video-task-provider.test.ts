import { expect, test } from "bun:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
    },
});
if (typeof window === "undefined") {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
}

import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function videoNode(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "video-1", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

test("resumes an account-backed video task as a Canvas task even though the node stored openai", async () => {
    const { resolveVideoTaskProvider } = await import("../src/lib/canvas/canvas-generation-helpers");

    expect(resolveVideoTaskProvider(videoNode({ videoTaskId: "gen-1", videoTaskProvider: "openai", model: "canvas::provider-1::seedance-2.5-M" }))).toBe("canvas");
});

// Shape taken verbatim from the node stuck at "loading" in the NEO project (generation ec176af5-5828-4b98-996f-baf7d7fdfdbb succeeded server-side).
test("resolves the production node whose generation already succeeded", async () => {
    const { resolveVideoTaskProvider } = await import("../src/lib/canvas/canvas-generation-helpers");

    const stuck = videoNode({
        size: "720x960",
        model: "canvas::ffab0634-eca4-4703-ae14-6a08bfdceacd::seedance-2.5-M",
        status: "loading",
        seconds: "15",
        vquality: "720",
        videoMode: "frames",
        watermark: "false",
        references: ["image:Q4Yqc-P5cRds-OqefNraV"],
        videoTaskId: "ec176af5-5828-4b98-996f-baf7d7fdfdbb",
        generateAudio: "true",
        videoTaskProvider: "openai",
    });

    expect(stuck.metadata?.status).toBe("loading");
    expect(resolveVideoTaskProvider(stuck)).toBe("canvas");
});

test("keeps the stored provider for non-Canvas video tasks", async () => {
    const { resolveVideoTaskProvider } = await import("../src/lib/canvas/canvas-generation-helpers");

    expect(resolveVideoTaskProvider(videoNode({ videoTaskId: "task-1", videoTaskProvider: "openai", model: "default::sora-2" }))).toBe("openai");
    expect(resolveVideoTaskProvider(videoNode({ videoTaskId: "op-1", videoTaskProvider: "gemini", model: "default::veo-3" }))).toBe("gemini");
});

test("falls back to openai when the node has no stored provider", async () => {
    const { resolveVideoTaskProvider } = await import("../src/lib/canvas/canvas-generation-helpers");

    expect(resolveVideoTaskProvider(videoNode({ videoTaskId: "task-2", model: "default::sora-2" }))).toBe("openai");
});
