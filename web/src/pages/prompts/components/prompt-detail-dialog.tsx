import { Copy, FileText, FolderPlus, Languages } from "lucide-react";
import { App, Button, Modal, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { translatePromptToVietnamese, type PromptTranslation } from "@/services/api/prompt-translation";
import { useConfigStore } from "@/stores/use-config-store";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [translation, setTranslation] = useState<PromptTranslation | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const translationAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        translationAbortRef.current?.abort();
        translationAbortRef.current = null;
        setTranslation(null);
        setShowOriginal(false);
        setIsTranslating(false);
        return () => translationAbortRef.current?.abort();
    }, [prompt?.sourceId, prompt?.id]);

    const translate = async () => {
        if (!prompt || isTranslating) return;
        if (!isAiConfigReady(config, config.textModel)) {
            message.info(t("prompts.translationConfigRequired"));
            openConfigDialog(false, "channels");
            return;
        }
        setIsTranslating(true);
        const controller = new AbortController();
        translationAbortRef.current = controller;
        try {
            setTranslation(await translatePromptToVietnamese(prompt, config, { signal: controller.signal }));
            setShowOriginal(false);
            message.success(t("prompts.translated"));
        } catch (error) {
            if (!controller.signal.aborted) message.error(t("prompts.translationFailed"));
        } finally {
            if (translationAbortRef.current === controller) {
                translationAbortRef.current = null;
                setIsTranslating(false);
            }
        }
    };

    const displayed = translation && !showOriginal ? translation : prompt;

    return (
        <Modal title={displayed?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        {prompt.coverUrl ? (
                            <img src={prompt.coverUrl} alt={prompt.title} className="h-48 w-full rounded-lg object-cover sm:h-56" />
                        ) : (
                            <div className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56">
                                <FileText className="size-9" />
                            </div>
                        )}
                        {prompt.referenceImageUrls.length > 1 ? (
                            <div className="grid grid-cols-6 gap-2">
                                {prompt.referenceImageUrls
                                    .filter((url) => url !== prompt.coverUrl)
                                    .slice(0, 6)
                                    .map((url) => (
                                        <img key={url} src={url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" />
                                    ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        <div className="flex flex-wrap gap-1.5">
                            {displayed?.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {displayed?.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{displayed.description}</p> : null}
                        {displayed?.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{displayed.preview}</pre> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{displayed?.prompt}</p>
                        {prompt.createdAt || prompt.updatedAt ? (
                            <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                {prompt.createdAt ? t("common.created", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) }) : null}
                                {prompt.createdAt && prompt.updatedAt ? " · " : null}
                                {prompt.updatedAt ? t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) }) : null}
                            </div>
                        ) : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <Space wrap>
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                {t("common.copyPrompt")}
                            </Button>
                            {translation ? (
                                <Button icon={<Languages className="size-4" />} onClick={() => setShowOriginal((value) => !value)}>
                                    {showOriginal ? t("prompts.showTranslation") : t("prompts.showOriginal")}
                                </Button>
                            ) : (
                                <Button icon={<Languages className="size-4" />} loading={isTranslating} onClick={() => void translate()}>
                                    {t("prompts.translate")}
                                </Button>
                            )}
                            {onSaveAsset ? (
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    {t("common.addToAssets")}
                                </Button>
                            ) : null}
                        </Space>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
