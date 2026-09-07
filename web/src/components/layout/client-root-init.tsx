import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const handledSsoParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const initializeCanvasSession = useCanvasAccountStore((state) => state.initialize);
    const verifyCanvasSession = useCanvasAccountStore((state) => state.verify);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledSsoParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const accessToken = searchParams.get("accessToken") || searchParams.get("access_token") || searchParams.get("ssoToken") || searchParams.get("sub2apiAccessToken") || searchParams.get("token");
        if (accessToken?.trim()) {
            handledSsoParams.current = true;
            searchParams.delete("accessToken");
            searchParams.delete("access_token");
            searchParams.delete("ssoToken");
            searchParams.delete("sub2apiAccessToken");
            searchParams.delete("token");
            window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
            void verifyCanvasSession(accessToken);
            return;
        }
        handledSsoParams.current = true;
        void initializeCanvasSession();
    }, [initializeCanvasSession, verifyCanvasSession]);

    useEffect(() => {
        const configuredOrigin = (import.meta.env.VITE_SUB2API_ORIGIN || "").trim();
        let allowedOrigin = "";
        try {
            allowedOrigin = configuredOrigin ? new URL(configuredOrigin).origin : "";
        } catch {
            return;
        }
        if (!allowedOrigin) return;
        const handleMessage = (event: MessageEvent<unknown>) => {
            if (event.origin !== allowedOrigin || !event.data || typeof event.data !== "object") return;
            const data = event.data as { type?: unknown; accessToken?: unknown };
            if (data.type !== "sub2api:sso" || typeof data.accessToken !== "string" || !data.accessToken.trim()) return;
            void verifyCanvasSession(data.accessToken);
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [verifyCanvasSession]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    return <>{children}</>;
}
