import { create } from "zustand";

import { canvasBff, CanvasBffError, type CanvasAccount } from "@/services/api/canvas-bff";
import { fromBffCanvasProject } from "@/services/api/canvas-workspace";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";
import type { Asset } from "@/stores/use-asset-store";
import { setCanvasAccountAuthenticated } from "@/stores/canvas/account-runtime";

export type CanvasAccountStatus = "unknown" | "loading" | "authenticated" | "unauthenticated" | "error";

async function clearLocalWorkspaceCache() {
    const [{ useCanvasStore }, { useAssetStore }] = await Promise.all([import("@/stores/canvas/use-canvas-store"), import("@/stores/use-asset-store")]);
    useCanvasStore.getState().replaceProjects([]);
    useAssetStore.getState().replaceAssets([]);
}

async function hydrateRemoteProjects() {
    const projects = await canvasBff.listProjects();
    useCanvasStore.getState().replaceProjects(projects.map(fromBffCanvasProject));
}

async function hydrateRemoteAssets() {
    const assets = await canvasBff.listAssets();
    const { useAssetStore } = await import("@/stores/use-asset-store");
    const hydrated: Asset[] = assets.flatMap((asset): Asset[] => {
        const url = asset.signedUrl || asset.providerUrl || "";
        if (asset.kind === "image" && url)
            return [
                {
                    id: asset.id,
                    kind: "image" as const,
                    title: "Canvas image",
                    coverUrl: url,
                    tags: [],
                    source: "Canvas",
                    data: { dataUrl: url, width: numberValue(asset.metadata.width, 0), height: numberValue(asset.metadata.height, 0), bytes: numberValue(asset.metadata.size, 0), mimeType: stringValue(asset.metadata.contentType) || "image/png" },
                    metadata: asset.metadata,
                    createdAt: asset.createdAt,
                    updatedAt: asset.createdAt,
                },
            ];
        if (asset.kind === "video" && url)
            return [
                {
                    id: asset.id,
                    kind: "video" as const,
                    title: "Canvas video",
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url, width: numberValue(asset.metadata.width, 0), height: numberValue(asset.metadata.height, 0), bytes: numberValue(asset.metadata.size, 0), mimeType: stringValue(asset.metadata.contentType) || "video/mp4" },
                    metadata: asset.metadata,
                    createdAt: asset.createdAt,
                    updatedAt: asset.createdAt,
                },
            ];
        return [];
    });
    useAssetStore.getState().replaceAssets(hydrated);
}

type CanvasAccountStore = {
    status: CanvasAccountStatus;
    account: CanvasAccount | null;
    sessionExpiresAt: string | null;
    error: string | null;
    initialize: () => Promise<void>;
    verify: (launchCode: string) => Promise<boolean>;
    logout: () => Promise<void>;
    clear: () => void;
};

export const useCanvasAccountStore = create<CanvasAccountStore>()((set, get) => ({
    status: "unknown",
    account: null,
    sessionExpiresAt: null,
    error: null,
    initialize: async () => {
        set({ status: "loading", error: null });
        try {
            const session = await canvasBff.getSession();
            await clearLocalWorkspaceCache();
            await Promise.all([hydrateRemoteProjects(), hydrateRemoteAssets()]);
            setCanvasAccountAuthenticated(true);
            set({ status: "authenticated", account: session.account, sessionExpiresAt: session.sessionExpiresAt, error: null });
        } catch (error) {
            if (error instanceof CanvasBffError && error.status === 401) {
                await clearLocalWorkspaceCache();
                useCanvasProviderStore.getState().clear();
                setCanvasAccountAuthenticated(false);
                set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
                return;
            }
            set({ status: "error", error: error instanceof Error ? error.message : "Canvas session could not be loaded" });
        }
    },
    verify: async (launchCode) => {
        const code = launchCode.trim();
        if (!code) return false;
        set({ status: "loading", error: null });
        try {
            const session = await canvasBff.exchangeSub2ApiLaunchCode(code);
            await clearLocalWorkspaceCache();
            if (get().account && get().account?.sub2ApiUserId !== session.account.sub2ApiUserId) useCanvasProviderStore.getState().clear();
            await Promise.all([hydrateRemoteProjects(), hydrateRemoteAssets()]);
            setCanvasAccountAuthenticated(true);
            set({ status: "authenticated", account: session.account, sessionExpiresAt: session.sessionExpiresAt, error: null });
            return true;
        } catch (error) {
            setCanvasAccountAuthenticated(false);
            set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: error instanceof Error ? error.message : "Sub2API session could not be verified" });
            return false;
        }
    },
    logout: async () => {
        try {
            await canvasBff.logout();
        } finally {
            await clearLocalWorkspaceCache();
            useCanvasProviderStore.getState().clear();
            setCanvasAccountAuthenticated(false);
            set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
        }
    },
    clear: () => {
        useCanvasProviderStore.getState().clear();
        setCanvasAccountAuthenticated(false);
        set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
    },
}));

function numberValue(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value : "";
}
