import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import viVN from "@/i18n/locales/vi-VN";
import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "vi-VN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "vi-VN": { translation: viVN },
        "en-US": { translation: enUS },
    },
    lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "vi-VN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
