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

test("requires a Canvas provider model only while the account session is active", async () => {
    const { defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
    const { setCanvasAccountAuthenticated } = await import("../src/stores/canvas/account-runtime");
    const localConfig = { ...defaultConfig, channels: defaultConfig.channels.map((channel) => ({ ...channel, apiKey: "test-key" })) };

    try {
        setCanvasAccountAuthenticated(true);
        expect(useConfigStore.getState().isAiConfigReady(defaultConfig, "default::gpt-5.5")).toBe(false);
        expect(useConfigStore.getState().isAiConfigReady(defaultConfig, "canvas::text-provider::gpt-5.5")).toBe(true);

        setCanvasAccountAuthenticated(false);
        expect(useConfigStore.getState().isAiConfigReady(localConfig, "default::gpt-5.5")).toBe(true);
        expect(useConfigStore.getState().isAiConfigReady(localConfig, "canvas::text-provider::gpt-5.5")).toBe(false);
    } finally {
        setCanvasAccountAuthenticated(false);
    }
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

test("serializes concurrent updates for the same project", async () => {
    const { updateCanvasProject } = await import("../src/services/api/canvas-workspace");
    let revision = 1;
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
        getProject: async () => ({ id: "project-2", name: "Canvas", data: {}, revision, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
        updateProject: async (_id: string, input: { name?: string; data?: Record<string, unknown>; revision?: number }) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (input.revision !== revision) {
                inFlight -= 1;
                throw new Error("unexpected stale revision");
            }
            revision += 1;
            inFlight -= 1;
            return { id: "project-2", name: input.name || "Canvas", data: input.data || {}, revision, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
        },
    };

    const saved = await Promise.all([updateCanvasProject("project-2", { name: "First", revision: 1 }, client), updateCanvasProject("project-2", { name: "Second", revision: 1 }, client)]);

    expect(maxInFlight).toBe(1);
    expect(saved.map((project) => project.title)).toEqual(["First", "Second"]);
    expect(saved.map((project) => project.remoteRevision)).toEqual([2, 3]);
});
