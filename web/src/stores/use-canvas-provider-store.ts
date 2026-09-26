import { create } from "zustand";

import { CanvasBffError, canvasBff, type CanvasProvider, type ProviderCatalog } from "@/services/api/canvas-bff";

type ProviderInput = { name: string; providerType?: string; baseUrl?: string; model?: string; group?: string; channel?: string; catalogKeyId?: string; secret?: string };
type ProviderPatch = { name?: string; model?: string; group?: string; channel?: string; status?: "active" | "disabled" };
type StudioCapability = "image" | "video";

type CanvasProviderStore = {
    providers: CanvasProvider[];
    catalog: ProviderCatalog | null;
    providersLoaded: boolean;
    catalogLoaded: boolean;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
    modelsByProvider: Record<string, string[]>;
    modelsLoadingProviderId: string | null;
    modelsLoadingProviderIds: string[];
    studioModels: Partial<Record<StudioCapability, string>>;
    load: (force?: boolean) => Promise<void>;
    loadCatalog: (force?: boolean) => Promise<void>;
    loadModels: (providerId: string, force?: boolean) => Promise<string[]>;
    create: (input: ProviderInput) => Promise<CanvasProvider>;
    createWithNewKey: (input: { name: string; groupId: string }) => Promise<CanvasProvider>;
    update: (providerId: string, input: ProviderPatch) => Promise<CanvasProvider>;
    remove: (providerId: string) => Promise<void>;
    setStudioModel: (capability: StudioCapability, value: string) => void;
    clear: () => void;
};

let providersRequest: Promise<void> | null = null;
let catalogRequest: Promise<void> | null = null;
const modelsRequests = new Map<string, Promise<string[]>>();
let requestGeneration = 0;

export const useCanvasProviderStore = create<CanvasProviderStore>()((set, get) => ({
    providers: [],
    catalog: null,
    providersLoaded: false,
    catalogLoaded: false,
    status: "idle",
    error: null,
    modelsByProvider: {},
    modelsLoadingProviderId: null,
    studioModels: {},
    modelsLoadingProviderIds: [],
    load: async (force = false) => {
        if (!force && get().providersLoaded) return;
        if (providersRequest) return providersRequest;
        const generation = requestGeneration;
        set({ status: "loading", error: null });
        const request = canvasBff
            .listProviders()
            .then((providers) => {
                if (generation !== requestGeneration) return;
                set((state) => ({
                    providers,
                    providersLoaded: true,
                    modelsByProvider: force ? {} : Object.fromEntries(Object.entries(state.modelsByProvider).filter(([providerId]) => providers.some((provider) => provider.id === providerId))),
                    status: "ready",
                    error: null,
                }));
            })
            .catch((error) => {
                if (generation !== requestGeneration) return;
                set({ status: "error", error: error instanceof Error ? error.message : "Provider list could not be loaded" });
            })
            .finally(() => {
                if (providersRequest === request) providersRequest = null;
            });
        providersRequest = request;
        return providersRequest;
    },
    loadCatalog: async (force = false) => {
        if (!force && get().catalogLoaded) return;
        if (catalogRequest) return catalogRequest;
        const generation = requestGeneration;
        set({ status: "loading", error: null });
        const request = canvasBff
            .getProviderCatalog()
            .then((catalog) => {
                if (generation !== requestGeneration) return;
                set({ catalog, catalogLoaded: true, status: "ready", error: null });
            })
            .catch((error) => {
                if (generation !== requestGeneration) return;
                const message = error instanceof CanvasBffError && error.status === 401 ? "Sub2API catalog session is unavailable" : error instanceof Error ? error.message : "Provider catalog could not be loaded";
                set({ status: "error", error: message });
            })
            .finally(() => {
                if (catalogRequest === request) catalogRequest = null;
            });
        catalogRequest = request;
        return catalogRequest;
    },
    loadModels: async (providerId, force = false) => {
        const cached = get().modelsByProvider[providerId];
        if (!force && cached !== undefined) return cached;
        const pending = modelsRequests.get(providerId);
        if (pending) return pending;
        const generation = requestGeneration;
        set((state) => ({ modelsLoadingProviderId: providerId, modelsLoadingProviderIds: state.modelsLoadingProviderIds.includes(providerId) ? state.modelsLoadingProviderIds : [...state.modelsLoadingProviderIds, providerId], error: null }));
        const request = canvasBff
            .listProviderModels(providerId)
            .then((models) => {
                if (generation !== requestGeneration) return models;
                set((state) => {
                    const modelsLoadingProviderIds = state.modelsLoadingProviderIds.filter((id) => id !== providerId);
                    return { modelsByProvider: { ...state.modelsByProvider, [providerId]: models }, modelsLoadingProviderIds, modelsLoadingProviderId: modelsLoadingProviderIds.at(-1) || null };
                });
                return models;
            })
            .catch((error) => {
                if (generation !== requestGeneration) throw error;
                set((state) => {
                    const modelsLoadingProviderIds = state.modelsLoadingProviderIds.filter((id) => id !== providerId);
                    return { modelsLoadingProviderIds, modelsLoadingProviderId: modelsLoadingProviderIds.at(-1) || null, error: error instanceof Error ? error.message : "Provider model list could not be loaded" };
                });
                throw error;
            })
            .finally(() => {
                if (modelsRequests.get(providerId) === request) modelsRequests.delete(providerId);
            });
        modelsRequests.set(providerId, request);
        return request;
    },
    create: async (input) => {
        const provider = await canvasBff.createProvider(input);
        set((state) => ({ providers: [...state.providers.filter((item) => item.id !== provider.id), provider], error: null }));
        return provider;
    },
    createWithNewKey: async (input) => {
        const provider = await canvasBff.createProviderWithNewKey(input);
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
    setStudioModel: (capability, value) => set((state) => ({ studioModels: { ...state.studioModels, [capability]: value } })),
    clear: () => {
        requestGeneration += 1;
        providersRequest = null;
        catalogRequest = null;
        modelsRequests.clear();
        set({ providers: [], catalog: null, providersLoaded: false, catalogLoaded: false, modelsByProvider: {}, modelsLoadingProviderId: null, modelsLoadingProviderIds: [], studioModels: {}, status: "idle", error: null });
    },
}));
