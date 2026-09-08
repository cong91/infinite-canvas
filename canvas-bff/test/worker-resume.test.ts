import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAssetRepository } from "../src/assets/repository.js";
import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { InMemoryGenerationRepository } from "../src/generations/repository.js";
import { GenerationService } from "../src/generations/service.js";
import { InMemoryObjectStorage } from "../src/storage/object-storage.js";
import { GenerationWorker, type GenerationProvider } from "../src/worker/generation-worker.js";
import { InMemoryProjectRepository } from "../src/projects/repository.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";

function fixture() {
    const now = { value: 10_000 };
    const clock = () => now.value;
    const projects = new InMemoryProjectRepository();
    const providers = new InMemoryProviderRepository();
    const assets = new InMemoryAssetRepository();
    const generations = new InMemoryGenerationRepository(clock);
    const accountId = "account-a";
    const project = projects.create({ accountId, name: "Demo", data: {} });
    const provider = providers.create({
        accountId,
        name: "Provider",
        providerType: "openai-compatible",
        secret: new ProviderSecretBox(Buffer.alloc(32, 2)).encrypt("provider-secret"),
        secretDescription: { fingerprint: "fingerprint", masked: "****cret" },
        status: "active",
    });
    const service = new GenerationService({ generations, projects, providers });
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret", now: clock });
    return { now, clock, accountId, project, provider, assets, generations, service, storage };
}

test("worker resumes a leased provider task after a worker restart and persists the asset", async () => {
    const fixtureData = fixture();
    const generation = await fixtureData.service.create(fixtureData.accountId, {
        projectId: fixtureData.project.id,
        providerId: fixtureData.provider.id,
        kind: "video",
        input: { prompt: "a moving tree" },
        clientRequestId: "request-video-1",
    });
    fixtureData.generations.claimNext("worker-crashed", new Date(fixtureData.now.value), 5_000);
    fixtureData.generations.setProviderTask(generation.id, "provider-task-1", "worker-crashed", new Date(fixtureData.now.value - 1_000));

    let pollCalls = 0;
    const provider: GenerationProvider = {
        async start() {
            throw new Error("start must not be called when a provider task already exists");
        },
        async poll() {
            pollCalls += 1;
            return { status: "succeeded", data: Buffer.from("video-data"), contentType: "video/mp4", providerUrl: "https://provider.example/video/1" };
        },
    };
    const worker = new GenerationWorker({ generationRepository: fixtureData.generations, assetRepository: fixtureData.assets, objectStorage: fixtureData.storage, provider, workerId: "worker-restarted", leaseMs: 5_000, now: fixtureData.clock });
    const result = await worker.runOnce();

    assert.equal(result?.status, "succeeded");
    assert.equal(pollCalls, 1);
    assert.equal(fixtureData.assets.list(fixtureData.accountId, fixtureData.project.id).length, 1);
    assert.equal((await fixtureData.storage.list(fixtureData.accountId)).length, 1);
});

test("worker does not invoke a provider when a queued generation is cancelled", async () => {
    const fixtureData = fixture();
    const generation = await fixtureData.service.create(fixtureData.accountId, {
        projectId: fixtureData.project.id,
        providerId: fixtureData.provider.id,
        kind: "image",
        input: { prompt: "cancel me" },
        clientRequestId: "request-cancel-1",
    });
    assert.equal(await fixtureData.service.cancel(fixtureData.accountId, generation.id), true);
    let calls = 0;
    const provider: GenerationProvider = {
        async start() {
            calls += 1;
            return { status: "succeeded", data: Buffer.from("should-not-run"), contentType: "image/png" };
        },
        async poll() {
            calls += 1;
            return { status: "succeeded", data: Buffer.from("should-not-run"), contentType: "image/png" };
        },
    };
    const worker = new GenerationWorker({ generationRepository: fixtureData.generations, assetRepository: fixtureData.assets, objectStorage: fixtureData.storage, provider, workerId: "worker-1", now: fixtureData.clock });
    assert.equal(await worker.runOnce(), undefined);
    assert.equal(calls, 0);
});

test("worker retries a retryable provider failure without creating another generation", async () => {
    const fixtureData = fixture();
    await fixtureData.service.create(fixtureData.accountId, {
        projectId: fixtureData.project.id,
        providerId: fixtureData.provider.id,
        kind: "audio",
        input: { prompt: "retry me" },
        clientRequestId: "request-retry-1",
    });
    let calls = 0;
    const provider: GenerationProvider = {
        async start() {
            calls += 1;
            return calls === 1 ? { status: "failed", retryable: true, errorCode: "UPSTREAM_TIMEOUT" } : { status: "succeeded", data: Buffer.from("audio-data"), contentType: "audio/mpeg" };
        },
        async poll() {
            throw new Error("poll is not expected");
        },
    };
    const worker = new GenerationWorker({ generationRepository: fixtureData.generations, assetRepository: fixtureData.assets, objectStorage: fixtureData.storage, provider, workerId: "worker-1", now: fixtureData.clock });
    assert.equal((await worker.runOnce())?.status, "queued");
    assert.equal((await worker.runOnce())?.status, "succeeded");
    assert.equal((await fixtureData.service.list(fixtureData.accountId)).length, 1);
});
