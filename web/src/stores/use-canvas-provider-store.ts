import { create } from "zustand";

import { CanvasBffError, canvasBff, type CanvasProvider, type ProviderCatalog } from "@/services/api/canvas-bff";

type ProviderInput = { name: string; providerType?: string; model?: string; group?: string; channel?: string; catalogKeyId?: string; secret?: string };
type ProviderPatch = { name?: string; model?: string; group?: string; channel?: string; status?: "active" | "disabled" };

type CanvasProviderStore = {
    providers: CanvasProvider[];
    catalog: ProviderCatalog | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
    load: () => Promise<void>;
    loadCatalog: () => Promise<void>;
    create: (input: ProviderInput) => Promise<CanvasProvider>;
    update: (providerId: string, input: ProviderPatch) => Promise<CanvasProvider>;
    remove: (providerId: string) => Promise<void>;
    clear: () => void;
};

export const useCanvasProviderStore = create<CanvasProviderStore>()((set) => ({
    providers: [],
    catalog: null,
    status: "idle",
    error: null,
    load: async () => {
        set({ status: "loading", error: null });
        try {
            const providers = await canvasBff.listProviders();
            set({ providers, status: "ready", error: null });
        } catch (error) {
            set({ status: "error", error: error instanceof Error ? error.message : "Provider list could not be loaded" });
        }
    },
    loadCatalog: async () => {
        set({ status: "loading", error: null });
        try {
            const catalog = await canvasBff.getProviderCatalog();
            set({ catalog, status: "ready", error: null });
        } catch (error) {
            const message = error instanceof CanvasBffError && error.status === 401 ? "Sub2API catalog session is unavailable" : error instanceof Error ? error.message : "Provider catalog could not be loaded";
            set({ status: "error", error: message });
        }
    },
    create: async (input) => {
        const provider = await canvasBff.createProvider(input);
        set((state) => ({ providers: [...state.providers.filter((item) => item.id !== provider.id), provider], error: null }));
        return provider;
    },
    update: async (providerId, input) => {
        const provider = await canvasBff.updateProvider(providerId, input);
        set((state) => ({ providers: state.providers.map((item) => (item.id === provider.id ? provider : item)), error: null }));
        return provider;
    },
    remove: async (providerId) => {
        await canvasBff.deleteProvider(providerId);
        set((state) => ({ providers: state.providers.filter((item) => item.id !== providerId), error: null }));
    },
    clear: () => set({ providers: [], catalog: null, status: "idle", error: null }),
}));
