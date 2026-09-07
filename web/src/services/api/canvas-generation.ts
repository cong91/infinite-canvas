import { canvasBff, type CanvasGeneration } from "./canvas-bff";

export type CanvasGenerationInput = {
    projectId: string;
    providerId: string;
    kind: CanvasGeneration["kind"];
    input?: Record<string, unknown>;
    clientRequestId: string;
};

/** Account-backed generation calls. Provider credentials never cross this boundary. */
export const canvasGenerationApi = {
    list: () => canvasBff.listGenerations(),
    get: (generationId: string) => canvasBff.getGeneration(generationId),
    submit: (input: CanvasGenerationInput) => canvasBff.createGeneration(input),
    cancel: (generationId: string) => canvasBff.cancelGeneration(generationId),
};
