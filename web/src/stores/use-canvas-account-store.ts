import { create } from "zustand";

import { canvasBff, CanvasBffError, type CanvasAccount } from "@/services/api/canvas-bff";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";

export type CanvasAccountStatus = "unknown" | "loading" | "authenticated" | "unauthenticated" | "error";

type CanvasAccountStore = {
    status: CanvasAccountStatus;
    account: CanvasAccount | null;
    sessionExpiresAt: string | null;
    error: string | null;
    initialize: () => Promise<void>;
    verify: (accessToken: string) => Promise<boolean>;
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
            set({ status: "authenticated", account: session.account, sessionExpiresAt: session.sessionExpiresAt, error: null });
        } catch (error) {
            if (error instanceof CanvasBffError && error.status === 401) {
                set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
                return;
            }
            set({ status: "error", error: error instanceof Error ? error.message : "Canvas session could not be loaded" });
        }
    },
    verify: async (accessToken) => {
        const token = accessToken.trim();
        if (!token) return false;
        set({ status: "loading", error: null });
        try {
            const session = await canvasBff.verifySub2ApiToken(token);
            if (get().account && get().account?.sub2ApiUserId !== session.account.sub2ApiUserId) useCanvasProviderStore.getState().clear();
            set({ status: "authenticated", account: session.account, sessionExpiresAt: session.sessionExpiresAt, error: null });
            return true;
        } catch (error) {
            set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: error instanceof Error ? error.message : "Sub2API session could not be verified" });
            return false;
        }
    },
    logout: async () => {
        try {
            await canvasBff.logout();
        } finally {
            useCanvasProviderStore.getState().clear();
            set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
        }
    },
    clear: () => {
        useCanvasProviderStore.getState().clear();
        set({ status: "unauthenticated", account: null, sessionExpiresAt: null, error: null });
    },
}));
