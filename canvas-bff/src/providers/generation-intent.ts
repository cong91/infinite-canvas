import type { GenerationRecord } from "../generations/repository.js";

export type GenerationIntent = {
  kind: GenerationRecord["kind"];
  model: string;
  prompt: string;
  parameters: Record<string, unknown>;
};

/** Normalize Canvas input once before it crosses a provider protocol boundary. */
export function buildGenerationIntent(
  generation: GenerationRecord,
): GenerationIntent {
  const { kind, input } = generation;
  const model = stringValue(input.model) || defaultModel(kind);
  const prompt = stringValue(input.prompt);
  const parameters: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === "model" || key === "prompt" || value === undefined || value === null)
      continue;
    if (key === "referenceImages") {
      const urls = imageReferenceUrls(value);
      if (urls.length) {
        // Seedance takes the input frame as `input_reference`; xAI takes
        // `reference_images`. Sending xAI's field to Seedance leaves the task
        // typed text-to-video and the reference is dropped upstream.
        if (isSeedanceModel(model)) parameters.input_reference = urls[0];
        else parameters.reference_images = urls.map((url) => ({ image_url: url }));
      }
      continue;
    }
    if (key === "referenceVideos") {
      const video = firstMediaPayload(value);
      if (video) parameters.video = video;
      continue;
    }
    if (key === "referenceAudios") {
      const audio = firstMediaPayload(value);
      if (audio) parameters.audio = audio;
      continue;
    }
    parameters[canonicalParameterName(key)] = value;
  }

  if (kind === "video") normalizeVideoParameters(input, parameters, model);

  removeEmptyParameters(parameters);

  return { kind, model, prompt, parameters };
}

/** JSON body accepted by the Sub2API media gateway. */
export function generationIntentToSub2ApiBody(
  intent: GenerationIntent,
): Record<string, unknown> {
  return {
    model: intent.model,
    prompt: intent.prompt,
    ...intent.parameters,
  };
}

function normalizeVideoParameters(
  input: Record<string, unknown>,
  parameters: Record<string, unknown>,
  model: string,
) {
  for (const key of [
    "seconds",
    "size",
    "quality",
    "vquality",
    "ratio",
    "aspectRatio",
    "aspect_ratio",
    "generateAudio",
    "generate_audio",
    "watermark",
  ])
    delete parameters[key];

  // Non-positive seconds (e.g. "-1" smart mode) means "let the provider decide".
  const duration = numberValue(input.duration ?? input.seconds);
  if (duration !== undefined && duration > 0) parameters.duration = Math.floor(duration);

  const resolution = normalizeResolution(
    stringValue(input.resolution ?? input.quality ?? input.vquality) ||
      inferResolutionFromSize(stringValue(input.size)),
  );
  if (resolution) parameters.resolution = resolution;

  // New-api seedance channels (e.g. iliu.ai) accept `ratio` but reject
  // `aspect_ratio`/`watermark` with a 502, so keep those fields Grok-only.
  const seedance = /seedance/i.test(model);

  const aspectRatio = normalizeAspectRatio(
    stringValue(input.aspect_ratio ?? input.aspectRatio ?? input.ratio) ||
      stringValue(input.size),
  );
  if (aspectRatio) parameters[seedance ? "ratio" : "aspect_ratio"] = aspectRatio;

  const generateAudio = booleanValue(input.generate_audio ?? input.generateAudio);
  if (generateAudio !== undefined) parameters.generate_audio = generateAudio;

  const watermark = booleanValue(input.watermark);
  if (watermark !== undefined && !seedance) parameters.watermark = watermark;
}

function canonicalParameterName(key: string) {
  if (key === "aspectRatio") return "aspect_ratio";
  return key;
}

// Gateways reject known-but-empty fields (e.g. `reference_images: []` -> 422
// 不支持字段), so a blank value must be absent rather than present-and-empty.
function removeEmptyParameters(parameters: Record<string, unknown>) {
  for (const [key, value] of Object.entries(parameters))
    if (isEmptyParameter(value)) delete parameters[key];
}

function isEmptyParameter(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

function imageReferenceUrls(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

/** Seedance/Doubao channels read the input frame from `input_reference`, not `reference_images`. */
function isSeedanceModel(model: string) {
  return /seedance|doubao/i.test(model);
}

/** Grok media contract: the source video/audio is a single {url} object. */
function firstMediaPayload(value: unknown) {
  const urls = Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
  return urls.length ? { url: urls[0] } : undefined;
}

function defaultModel(kind: GenerationRecord["kind"]) {
  if (kind === "image") return "gpt-image-1";
  if (kind === "audio") return "gpt-4o-mini-tts";
  if (kind === "video") return "sora-2";
  return "gpt-4o-mini";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanValue(value: unknown): boolean | string | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

function normalizeResolution(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  if (normalized === "low" || normalized === "480" || normalized === "480p") return "480p";
  if (normalized === "medium" || normalized === "high" || normalized === "auto" || normalized === "720" || normalized === "720p") return "720p";
  if (normalized === "1080" || normalized === "1080p") return "1080p";
  return value;
}

function inferResolutionFromSize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.replace(/\s+/g, "").match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  return normalizeResolution(String(Math.max(Number(match[1]), Number(match[2]))));
}

function normalizeAspectRatio(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === "auto") return undefined;
  const ratio = value.match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/i);
  if (!ratio) return undefined;
  const width = Number(ratio[1]);
  const height = Number(ratio[2]);
  if (!width || !height) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}
