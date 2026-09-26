import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { imageToDataUrl } from "@/services/image-storage";
import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { canvasBff, decodeCanvasModel, type CanvasGeneration } from "./canvas-bff";
import type { ReferenceImage } from "@/types/image";

export type CanvasGenerationInput = {
    projectId: string;
    providerId: string;
    kind: CanvasGeneration["kind"];
    input?: Record<string, unknown>;
    clientRequestId: string;
};

export function isCanvasAccountAuthenticated() {
    return useCanvasAccountStore.getState().status === "authenticated";
}

export async function submitCanvasGeneration(kind: CanvasGeneration["kind"], config: AiConfig, prompt: string, extra: Record<string, unknown> = {}, options?: { signal?: AbortSignal }) {
    throwIfAborted(options?.signal);
    const providerStore = useCanvasProviderStore.getState();
    const [, projects] = await Promise.all([providerStore.load(), canvasBff.listProjects()]);
    const providerState = useCanvasProviderStore.getState();
    if (!providerState.providersLoaded && providerState.error) throw new Error(providerState.error);
    const providers = providerState.providers;
    const capabilityModel = kind === "image" ? config.imageModel : kind === "video" ? config.videoModel : kind === "audio" ? config.audioModel : config.textModel;
    const selectedValue = capabilityModel || config.model;
    const configuredModel = modelOptionName(selectedValue);
    const explicitModel = decodeCanvasModel(selectedValue) || decodeCanvasModel(config.model || "");
    const selectedProviderId = explicitModel?.providerId;
    const provider = selectedProviderId ? providers.find((item) => item.status === "active" && item.id === selectedProviderId) : undefined;
    if (!explicitModel || !provider) throw new Error("Select an active Canvas provider and model before generating");
    const project = projects[0] || (await canvasBff.createProject({ name: "Canvas Workbench", data: { source: "workbench" } }));
    return canvasBff.createGeneration({
        projectId: project.id,
        providerId: provider.id,
        kind,
        input: { model: explicitModel?.model || configuredModel, prompt, ...extra },
        clientRequestId: `canvas-${kind}-${nanoid()}`,
    });
}

export async function waitForCanvasGeneration(generationId: string, options?: { signal?: AbortSignal }): Promise<CanvasGeneration> {
    for (;;) {
        throwIfAborted(options?.signal);
        const generation = await canvasBff.getGeneration(generationId);
        if (["succeeded", "failed", "cancelled"].includes(generation.status)) {
            if (generation.status !== "succeeded") throw new Error(canvasGenerationError(generation.errorCode));
            return generation;
        }
        await delay(1_000, options?.signal);
    }
}

function canvasGenerationError(errorCode?: string) {
    if (errorCode === "PROVIDER_NO_ELIGIBLE_ACCOUNT") return i18n.t("apiErrors.noEligibleVideoAccount");
    return errorCode || i18n.t("apiErrors.videoGenerationFailed");
}

export async function readCanvasGenerationBlob(generation: CanvasGeneration, options?: { signal?: AbortSignal }) {
    const url = generation.asset?.signedUrl;
    if (!url) throw new Error("Canvas generation did not return an asset URL");
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error("Canvas output could not be downloaded");
    return response.blob();
}

export async function requestCanvasImage(config: AiConfig, prompt: string, options?: { signal?: AbortSignal; onCanvasTask?: (generationId: string) => void }) {
    const generation = await submitCanvasGeneration("image", config, prompt, { count: config.count, size: config.size, quality: config.quality }, options);
    options?.onCanvasTask?.(generation.id);
    return awaitCanvasImage(generation.id, options);
}

export async function requestCanvasImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: { signal?: AbortSignal; onCanvasTask?: (generationId: string) => void }) {
    const referenceImages = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const generation = await submitCanvasGeneration("image", config, prompt, { count: config.count, size: config.size, quality: config.quality, referenceImages }, options);
    options?.onCanvasTask?.(generation.id);
    return awaitCanvasImage(generation.id, options);
}

/** Poll a submitted canvas image generation until it settles and download the result as a data URL. assetId links to the cloud-cached asset in BFF storage. */
export async function awaitCanvasImage(generationId: string, options?: { signal?: AbortSignal }) {
    const completed = await waitForCanvasGeneration(generationId, options);
    const blob = await readCanvasGenerationBlob(completed, options);
    return { id: nanoid(), dataUrl: await blobToDataUrl(blob), assetId: completed.outputAssetId };
}

export async function requestCanvasAudio(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("audio", config, prompt, { voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    return readCanvasGenerationBlob(completed, options);
}

export async function requestCanvasText(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("text", config, prompt, { reasoningEffort: config.reasoningEffort }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    const blob = await readCanvasGenerationBlob(completed, options);
    return blob.text();
}

/** Account-backed generation calls. Provider credentials never cross this boundary. */
export const canvasGenerationApi = {
    list: () => canvasBff.listGenerations(),
    get: (generationId: string) => canvasBff.getGeneration(generationId),
    submit: (input: CanvasGenerationInput) => canvasBff.createGeneration(input),
    cancel: (generationId: string) => canvasBff.cancelGeneration(generationId),
};

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("Canvas image could not be read"));
        reader.readAsDataURL(blob);
    });
}
