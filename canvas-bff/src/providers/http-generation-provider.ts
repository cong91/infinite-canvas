import type {
  GenerationProvider,
  ProviderResult,
} from "../worker/generation-worker.js";
import type { GenerationRecord } from "../generations/repository.js";
import { ProviderSecretBox } from "../crypto/secret-box.js";
import type { ProviderRepository } from "./repository.js";

type FetchLike = typeof fetch;

export class HttpGenerationProvider implements GenerationProvider {
  private readonly baseUrl: string;
  private readonly providers: ProviderRepository;
  private readonly secretBox: ProviderSecretBox;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    providers: ProviderRepository;
    secretBox: ProviderSecretBox;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.providers = options.providers;
    this.secretBox = options.secretBox;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async start(generation: GenerationRecord): Promise<ProviderResult> {
    const context = await this.providerContext(generation);
    if (!context)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_NOT_FOUND",
      };
    if (generation.kind === "image")
      return this.image(context.secret, generation);
    if (generation.kind === "audio")
      return this.audio(context.secret, generation);
    if (generation.kind === "video")
      return this.videoStart(context.secret, generation);
    return this.text(context.secret, generation);
  }

  async poll(generation: GenerationRecord): Promise<ProviderResult> {
    const context = await this.providerContext(generation);
    if (!context)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_NOT_FOUND",
      };
    if (!generation.providerTaskId)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_TASK_MISSING",
      };
    const response = await this.request(
      `/v1/videos/${encodeURIComponent(generation.providerTaskId)}`,
      context.secret,
    );
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const data = recordValue(payload.data);
    const status = stringValue(payload.status ?? data.status)?.toLowerCase();
    if (
      ["queued", "pending", "running", "in_progress", "processing"].includes(
        status || "",
      )
    ) {
      return {
        status: "pending",
        providerTaskId: generation.providerTaskId,
        progress: numberValue(payload.progress ?? data.progress) ?? 0,
      };
    }
    if (["failed", "cancelled", "canceled"].includes(status || ""))
      return {
        status: "failed",
        retryable: false,
        errorCode:
          status === "cancelled" || status === "canceled"
            ? "PROVIDER_CANCELLED"
            : "PROVIDER_FAILED",
      };
    const url = mediaUrl(payload);
    return url
      ? this.download(url, context.secret, "video/mp4")
      : this.download(
          `/v1/videos/${encodeURIComponent(generation.providerTaskId)}/content`,
          context.secret,
          "video/mp4",
        );
  }

  private async image(
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request("/v1/images/generations", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-image-1",
        prompt: inputString(generation, "prompt"),
        n: inputNumber(generation, "count") ?? 1,
        size: inputString(generation, "size") || undefined,
        response_format: "b64_json",
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const first = arrayValue(payload.data)[0];
    const encoded = stringValue(first?.b64_json ?? first?.base64);
    if (encoded)
      return {
        status: "succeeded",
        data: Buffer.from(encoded, "base64"),
        contentType: "image/png",
      };
    const url = stringValue(first?.url) || mediaUrl(payload);
    return url
      ? this.download(url, secret, "image/png")
      : {
          status: "failed",
          retryable: false,
          errorCode: "PROVIDER_EMPTY_OUTPUT",
        };
  }

  private async audio(
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request("/v1/audio/speech", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-4o-mini-tts",
        input: inputString(generation, "prompt"),
        voice: inputString(generation, "voice") || "alloy",
        response_format: inputString(generation, "format") || "mp3",
      },
    });
    if (!response.ok) return httpFailure(response.status);
    return {
      status: "succeeded",
      data: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg",
    };
  }

  private async videoStart(
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request("/v1/videos", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "sora-2",
        prompt: inputString(generation, "prompt"),
        seconds: inputString(generation, "seconds") || undefined,
        size: inputString(generation, "size") || undefined,
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const data = recordValue(payload.data);
    const id = stringValue(payload.id ?? data.id);
    const status = stringValue(payload.status ?? data.status)?.toLowerCase();
    if (!id && mediaUrl(payload))
      return this.download(mediaUrl(payload)!, secret, "video/mp4");
    if (!id)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_TASK_MISSING",
      };
    if (["completed", "succeeded"].includes(status || ""))
      return this.download(
        mediaUrl(payload) || `/v1/videos/${encodeURIComponent(id)}/content`,
        secret,
        "video/mp4",
      );
    return {
      status: "pending",
      providerTaskId: id,
      progress: numberValue(payload.progress ?? data.progress) ?? 0,
    };
  }

  private async text(
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request("/v1/chat/completions", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-4o-mini",
        messages: [
          { role: "user", content: inputString(generation, "prompt") },
        ],
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const firstChoice = arrayValue(payload.choices)[0];
    const message = recordValue(firstChoice?.message);
    const content = stringValue(
      message.content ?? recordValue(payload.data).content,
    );
    return content
      ? {
          status: "succeeded",
          data: content,
          contentType: "text/plain; charset=utf-8",
        }
      : {
          status: "failed",
          retryable: false,
          errorCode: "PROVIDER_EMPTY_OUTPUT",
        };
  }

  private async download(
    url: string,
    secret: string,
    fallbackContentType: string,
  ): Promise<ProviderResult> {
    if (!this.isAllowedOutputUrl(url))
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_OUTPUT_URL_NOT_ALLOWED",
      };
    const response = await this.request(url, secret);
    if (!response.ok) return httpFailure(response.status);
    return {
      status: "succeeded",
      data: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0] ||
        fallbackContentType,
      ...(isAbsoluteHttpUrl(url) ? { providerUrl: url } : {}),
    };
  }

  private isAllowedOutputUrl(url: string): boolean {
    try {
      const parsed = new URL(url, this.baseUrl);
      const base = new URL(this.baseUrl);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.origin === base.origin
      );
    } catch {
      return false;
    }
  }

  private async providerContext(
    generation: GenerationRecord,
  ): Promise<{ secret: string } | undefined> {
    const provider = await this.providers.get(
      generation.accountId,
      generation.providerId,
    );
    if (!provider || provider.status !== "active") return undefined;
    try {
      return { secret: this.secretBox.decrypt(provider.secret) };
    } catch {
      return undefined;
    }
  }

  private async request(
    path: string,
    secret: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(
        path.startsWith("http") ? path : `${this.baseUrl}${path}`,
        {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${secret}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        return new Response(null, { status: 504 });
      return new Response(null, { status: 503 });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function httpFailure(status: number): ProviderResult {
  return {
    status: "failed",
    retryable:
      status === 408 || status === 425 || status === 429 || status >= 500,
    errorCode: `UPSTREAM_HTTP_${status}`,
  };
}
async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function inputString(generation: GenerationRecord, key: string): string {
  const value = generation.input[key];
  return typeof value === "string"
    ? value.trim()
    : value === undefined || value === null
      ? ""
      : String(value);
}
function inputNumber(
  generation: GenerationRecord,
  key: string,
): number | undefined {
  const value = Number(generation.input[key]);
  return Number.isFinite(value) ? value : undefined;
}
function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function mediaUrl(payload: Record<string, unknown>): string | undefined {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  return stringValue(
    payload.url ??
      payload.video_url ??
      payload.result_url ??
      data?.url ??
      data?.video_url ??
      data?.result_url,
  );
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}
