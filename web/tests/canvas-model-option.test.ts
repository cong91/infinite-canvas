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

test("retries a project update once with the latest revision", async () => {
    const { CanvasBffError } = await import("../src/services/api/canvas-bff");
    const { updateCanvasProject } = await import("../src/services/api/canvas-workspace");
    const attempts: Array<{ revision?: number }> = [];
    let attempt = 0;
    const client = {
        getProject: async () => ({ id: "project-1", name: "Canvas", data: {}, revision: 7, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
        updateProject: async (_id: string, input: { name?: string; data?: Record<string, unknown>; revision?: number }) => {
            attempts.push({ revision: input.revision });
            if (attempt++ === 0) throw new CanvasBffError(409, "PROJECT_REVISION_CONFLICT", "Project was updated elsewhere");
            return { id: "project-1", name: input.name || "Canvas", data: input.data || {}, revision: 8, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
        },
    };

    const saved = await updateCanvasProject("project-1", { name: "Renamed", revision: 3 }, client);

    expect(attempts).toEqual([{ revision: 3 }, { revision: 7 }]);
    expect(saved.title).toBe("Renamed");
    expect(saved.remoteRevision).toBe(8);
});
