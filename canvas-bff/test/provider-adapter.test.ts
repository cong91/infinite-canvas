import assert from "node:assert/strict";
import test from "node:test";

import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";
import { HttpGenerationProvider } from "../src/providers/http-generation-provider.js";

const secretBox = new ProviderSecretBox(Buffer.alloc(32, 7));

function fixture(baseUrl?: string, sub2ApiKeyId?: string) {
  const providers = new InMemoryProviderRepository();
  const provider = providers.create({
    accountId: "account-a",
    name: "Sub2API key",
    providerType: "openai-compatible",
    ...(baseUrl ? { baseUrl } : {}),
    model: "gpt-image-2",
    ...(sub2ApiKeyId ? { sub2ApiKeyId } : {}),
    secret: secretBox.encrypt("sk-provider-secret"),
    secretDescription: secretBox.describe("sk-provider-secret"),
    status: "active",
  });
  return { providers, provider };
}

test("image adapter decrypts the provider secret and ingests base64 output", async () => {
  const { providers, provider } = fixture();
  let request: Request | undefined;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const result = await adapter.start({
    id: "generation-1",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "a tree", model: "gpt-image-2" },
    inputHash: "hash",
    clientRequestId: "request-1",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded")
    assert.equal(Buffer.from(result.data).toString(), "image-bytes");
  assert.equal(
    request?.url,
    "https://sub2api.example.test/v1/images/generations",
  );
  assert.equal(
    request?.headers.get("authorization"),
    "Bearer sk-provider-secret",
  );
  assert.equal((await request?.json()).prompt, "a tree");
});

test("image adapter uses the provider-specific endpoint for third-party providers", async () => {
  const { providers, provider } = fixture("https://third-party.example.test");
  let requestUrl = "";
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("third-party-image").toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await adapter.start({
    id: "generation-third-party",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "a tree", model: "image-model" },
    inputHash: "hash-third-party",
    clientRequestId: "request-third-party",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(requestUrl, "https://third-party.example.test/v1/images/generations");
});

test("audio adapter returns binary provider output", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
  });
  const result = await adapter.start({
    id: "generation-2",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "audio",
    input: { prompt: "hello", model: "tts-1", voice: "alloy" },
    inputHash: "hash",
    clientRequestId: "request-2",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded")
    assert.deepEqual(Buffer.from(result.data), Buffer.from([1, 2, 3]));
});

test("adapter does not impose a default provider request timeout", async () => {
  const { providers, provider } = fixture();
  let signal: AbortSignal | undefined;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      signal = init?.signal;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image").toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const result = await adapter.start({
    id: "generation-no-timeout",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "long-running" },
    inputHash: "hash",
    clientRequestId: "request-no-timeout",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(signal, undefined);
});

test("video adapter maps asynchronous start and completed poll", async () => {
  const { providers, provider } = fixture();
  const calls: string[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/videos"))
        return new Response(
          JSON.stringify({ id: "video-task-1", status: "queued" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (url.endsWith("/v1/videos/video-task-1"))
        return new Response(
          JSON.stringify({ id: "video-task-1", status: "completed" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    },
  });
  const generation = {
    id: "generation-3",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "a moving tree", model: "video-model" },
    inputHash: "hash",
    clientRequestId: "request-3",
    status: "running" as const,
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const started = await adapter.start(generation);
  assert.deepEqual(started, {
    status: "pending",
    providerTaskId: "video-task-1",
    progress: 0,
  });
  const completed = await adapter.poll({
    ...generation,
    providerTaskId: "video-task-1",
  });
  assert.equal(completed.status, "succeeded");
  if (completed.status === "succeeded")
    assert.deepEqual(Buffer.from(completed.data), Buffer.from([9, 8, 7]));
  assert.deepEqual(calls, [
    "https://sub2api.example.test/v1/videos",
    "https://sub2api.example.test/v1/videos/video-task-1",
    "https://sub2api.example.test/v1/videos/video-task-1/content",
  ]);
});

test("video adapter follows Sub2API request_id and done response", async () => {
  const { providers, provider } = fixture();
  const calls: string[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/videos"))
        return new Response(JSON.stringify({ request_id: "grok-task-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/v1/videos/grok-task-1"))
        return new Response(
          JSON.stringify({
            status: "done",
            video: { url: "https://cdn.x.ai/video.mp4" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    },
  });
  const generation = {
    id: "generation-grok-video",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "a moving tree", model: "grok-imagine-video" },
    inputHash: "hash",
    clientRequestId: "request-grok-video",
    status: "running" as const,
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const started = await adapter.start(generation);
  assert.deepEqual(started, {
    status: "pending",
    providerTaskId: "grok-task-1",
    progress: 0,
  });
  const completed = await adapter.poll({
    ...generation,
    providerTaskId: "grok-task-1",
  });
  assert.equal(completed.status, "succeeded");
  if (completed.status === "succeeded")
    assert.deepEqual(Buffer.from(completed.data), Buffer.from([4, 5, 6]));
  assert.deepEqual(calls, [
    "https://sub2api.example.test/v1/videos",
    "https://sub2api.example.test/v1/videos/grok-task-1",
    "https://sub2api.example.test/v1/videos/grok-task-1/content",
  ]);
});

test("Sub2API video adapter sends a canonical intent without model-specific routing", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-video-key");
  const requests: Request[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/v1/videos/generations"))
        return new Response(JSON.stringify({ request_id: "grok-task-canonical" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (request.url.endsWith("/v1/videos/grok-task-canonical"))
        return new Response(
          JSON.stringify({
            status: "done",
            video: { url: "https://cdn.x.ai/video.mp4" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    },
  });
  const generation = {
    id: "generation-canonical-video",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: {
      prompt: "a moving tree",
      model: "grok-imagine-video-1.5",
      seconds: "8",
      size: "1280x720",
      quality: "720",
      generateAudio: "true",
      watermark: "false",
    },
    inputHash: "hash-canonical-video",
    clientRequestId: "request-canonical-video",
    status: "running" as const,
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  assert.deepEqual(await adapter.start(generation), {
    status: "pending",
    providerTaskId: "grok-task-canonical",
    progress: 0,
  });
  const body = (await requests[0].json()) as Record<string, unknown>;
  assert.deepEqual(body, {
    model: "grok-imagine-video-1.5",
    prompt: "a moving tree",
    duration: 8,
    resolution: "720p",
    aspect_ratio: "16:9",
    generate_audio: true,
    watermark: false,
  });
  const completed = await adapter.poll({ ...generation, providerTaskId: "grok-task-canonical" });
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "https://sub2api.example.test/v1/videos/generations",
      "https://sub2api.example.test/v1/videos/grok-task-canonical",
      "https://cdn.x.ai/video.mp4",
    ],
  );
  assert.equal(requests[2].headers.has("authorization"), false);
});

test("video adapter accepts nested request IDs returned by Sub2API", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-video-key-nested");
  const requests: Request[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/v1/videos/generations"))
        return new Response(JSON.stringify({ video: { request_id: "nested-task" } }), { status: 200 });
      if (request.url.endsWith("/v1/videos/nested-task"))
        return new Response(JSON.stringify({ data: { video: { status: "done", url: "https://cdn.x.ai/nested.mp4" } } }), { status: 200 });
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "video/mp4" } });
    },
  });
  const result = await adapter.start({
    id: "generation-nested-task",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video",
    input: { prompt: "nested", model: "grok-imagine-video" },
    inputHash: "nested-hash",
    clientRequestId: "nested-client-request",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, { status: "pending", providerTaskId: "nested-task", progress: 0 });
  assert.equal(requests[0].headers.get("idempotency-key"), "nested-client-request");
  assert.equal((await adapter.poll({
    id: "generation-nested-task",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video",
    input: { prompt: "nested", model: "grok-imagine-video" },
    inputHash: "nested-hash",
    clientRequestId: "nested-client-request",
    status: "provider_polling",
    progress: 0,
    providerTaskId: "nested-task",
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })).status, "succeeded");
});

test("adapter honors an explicit non-retryable Sub2API error contract", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-contract-error");
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { code: "SUB2API_NO_ELIGIBLE_ACCOUNT", retryable: false } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  });
  const result = await adapter.start({
    id: "generation-contract-error",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video",
    input: { prompt: "contract", model: "grok-imagine-video" },
    inputHash: "contract-hash",
    clientRequestId: "contract-client-request",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, { status: "failed", retryable: false, errorCode: "PROVIDER_NO_ELIGIBLE_ACCOUNT" });
});

test("video adapter treats expired and unknown statuses as terminal failures", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      const status = url.endsWith("expired") ? "expired" : "mystery";
      return new Response(JSON.stringify({ status }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const generation = {
    id: "generation-status",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "status" },
    inputHash: "hash",
    clientRequestId: "request-status",
    status: "provider_polling" as const,
    progress: 0,
    providerTaskId: "expired",
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  assert.deepEqual(await adapter.poll(generation), {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_EXPIRED",
  });
  assert.deepEqual(
    await adapter.poll({ ...generation, providerTaskId: "unknown" }),
    {
      status: "failed",
      retryable: false,
      errorCode: "PROVIDER_STATUS_UNKNOWN",
    },
  );
});

test("adapter marks upstream rate limits retryable without exposing secrets", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () => new Response("", { status: 429 }),
  });
  const result = await adapter.start({
    id: "generation-4",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "retry" },
    inputHash: "hash",
    clientRequestId: "request-4",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, {
    status: "failed",
    retryable: true,
    errorCode: "UPSTREAM_HTTP_429",
  });
});

test("video adapter treats an unavailable Grok media account pool as terminal", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "grok_media_no_eligible_account",
            message: "No eligible Grok media accounts",
          },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
  });

  const result = await adapter.start({
    id: "generation-no-grok-account",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video",
    input: { prompt: "a moving tree", model: "grok-imagine-video" },
    inputHash: "hash-no-grok-account",
    clientRequestId: "request-no-grok-account",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.deepEqual(result, {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_NO_ELIGIBLE_ACCOUNT",
  });
});

test("adapter rejects media URLs outside the configured Sub2API origin", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [{ url: "https://attacker.example.test/image.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const result = await adapter.start({
    id: "generation-5",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "blocked" },
    inputHash: "hash",
    clientRequestId: "request-5",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_OUTPUT_URL_NOT_ALLOWED",
  });
});

test("Sub2API image CDN output is downloaded without forwarding the API key", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-key-1");
  const requests: Request[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/v1/images/generations"))
        return new Response(
          JSON.stringify({
            data: [{ url: "https://cdn.example.test/generated/image.png?signature=abc" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    },
  });

  const result = await adapter.start({
    id: "generation-sub2api-cdn",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "a tree", model: "gpt-image-2" },
    inputHash: "hash-sub2api-cdn",
    clientRequestId: "request-sub2api-cdn",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://cdn.example.test/generated/image.png?signature=abc");
  assert.equal(requests[1].headers.has("authorization"), false);
});

test("Sub2API external output URLs cannot target private addresses", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-key-2");
  let downloadAttempted = false;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      if (String(input).endsWith("/v1/images/generations"))
        return new Response(JSON.stringify({ data: [{ url: "https://127.0.0.1/image.png" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      downloadAttempted = true;
      return new Response(new Uint8Array([1]), { status: 200 });
    },
  });

  const result = await adapter.start({
    id: "generation-sub2api-private-url",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "blocked", model: "gpt-image-2" },
    inputHash: "hash-sub2api-private-url",
    clientRequestId: "request-sub2api-private-url",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.deepEqual(result, {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_OUTPUT_URL_NOT_ALLOWED",
  });
  assert.equal(downloadAttempted, false);
});

test("Sub2API external output URLs cannot target IPv4-mapped private addresses", async () => {
  const { providers, provider } = fixture(undefined, "sub2api-key-3");
  let downloadAttempted = false;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      if (String(input).endsWith("/v1/images/generations"))
        return new Response(JSON.stringify({ data: [{ url: "https://[::ffff:127.0.0.1]/image.png" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      downloadAttempted = true;
      return new Response(new Uint8Array([1]), { status: 200 });
    },
  });

  const result = await adapter.start({
    id: "generation-sub2api-mapped-private-url",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "blocked", model: "gpt-image-2" },
    inputHash: "hash-sub2api-mapped-private-url",
    clientRequestId: "request-sub2api-mapped-private-url",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.status, "failed");
  assert.equal(downloadAttempted, false);
});
