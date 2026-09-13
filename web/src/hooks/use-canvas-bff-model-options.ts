import { useCallback } from "react";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";

export function useCanvasBffModelOptions() {
    const providers = useCanvasProviderStore((state) => state.providers.filter((provider) => provider.status === "active"));
    const modelsByProvider = useCanvasProviderStore((state) => state.modelsByProvider);
    const selectedProviderId = useCanvasProviderStore((state) => state.selectedProviderId);
    const modelsLoadingProviderId = useCanvasProviderStore((state) => state.modelsLoadingProviderId);
    const loadProviders = useCanvasProviderStore((state) => state.load);
    const loadModels = useCanvasProviderStore((state) => state.loadModels);
    const load = useCallback(async () => {
        await loadProviders();
        const current = useCanvasProviderStore.getState().providers.filter((provider) => provider.status === "active");
        await Promise.all(current.filter((provider) => !useCanvasProviderStore.getState().modelsByProvider[provider.id]).map((provider) => loadModels(provider.id).catch(() => undefined)));
    }, [loadModels, loadProviders]);
    return { providers, modelsByProvider, selectedProviderId, loading: Boolean(modelsLoadingProviderId), load };
}
