import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";

export function AuthGate({ children }: { children: ReactNode }) {
    const location = useLocation();
    const status = useCanvasAccountStore((state) => state.status);
    const error = useCanvasAccountStore((state) => state.error);

    if (location.pathname === "/login") return <>{children}</>;
    if (status === "unknown" || status === "loading") return <AuthLoading />;
    if (status === "unauthenticated" || status === "error") {
        return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}`, error: error || undefined }} />;
    }
    return <>{children}</>;
}

function AuthLoading() {
    const { t } = useTranslation();
    return <main className="flex h-dvh items-center justify-center bg-background text-sm text-stone-500 dark:text-stone-400">{t("auth.login.loading")}</main>;
}
