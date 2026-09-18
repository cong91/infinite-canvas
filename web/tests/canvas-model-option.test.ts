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

test("keeps an account-backed Canvas text model while local config hydrates", async () => {
    const { normalizeModelOptionValue } = await import("../src/stores/use-config-store");
    const model = "canvas::text-provider::gpt-5.5";

    expect(normalizeModelOptionValue(model, [])).toBe(model);
});

test("does not treat a local model fallback as a Canvas model", async () => {
    const { decodeCanvasModel } = await import("../src/services/api/canvas-bff");

    expect(decodeCanvasModel("gpt-5.5")).toBeNull();
    expect(decodeCanvasModel("canvas::text-provider::gpt-5.5")).toEqual({ providerId: "text-provider", model: "gpt-5.5" });
});
