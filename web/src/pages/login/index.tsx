import { Button } from "antd";
import { ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { SUB2API_URL } from "@/constant/env";
import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";

export default function LoginPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const status = useCanvasAccountStore((state) => state.status);
    const error = useCanvasAccountStore((state) => state.error);
    const initialize = useCanvasAccountStore((state) => state.initialize);
    const navigationState = location.state as { from?: unknown; error?: unknown } | null;
    const redirect = typeof navigationState?.from === "string" && navigationState.from.startsWith("/") ? navigationState.from : "/";
    const stateError = typeof navigationState?.error === "string" ? navigationState.error : "";

    useEffect(() => {
        if (status === "authenticated") navigate(redirect, { replace: true });
    }, [navigate, redirect, status]);

    const loginUrl = `${SUB2API_URL}/login`;
    const failure = stateError || error;

    return (
        <main className="flex h-dvh items-center justify-center bg-background px-6 text-foreground">
            <section className="w-full max-w-md border border-stone-200 bg-background p-8 shadow-sm dark:border-stone-800">
                <div className="mb-6 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ShieldAlert className="size-5" />
                </div>
                <h1 className="text-2xl font-semibold">{t("auth.login.title")}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("auth.login.description")}</p>
                {failure ? <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{failure}</p> : null}
                <div className="mt-6 flex flex-wrap gap-3">
                    <Button type="primary" icon={<ExternalLink className="size-4" />} href={loginUrl} target="_top">
                        {t("auth.login.openSub2Api")}
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} loading={status === "loading"} onClick={() => void initialize()}>
                        {t("auth.login.retry")}
                    </Button>
                </div>
                <p className="mt-5 text-xs leading-5 text-stone-400">{t("auth.login.hint")}</p>
            </section>
        </main>
    );
}
