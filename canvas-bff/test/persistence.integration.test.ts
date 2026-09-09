import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { createDatabasePool } from "../src/database/database-pool.js";
import { PostgresSessionRepository } from "../src/auth/postgres-session-repository.js";
import { PostgresProjectRepository } from "../src/projects/postgres-repository.js";
import { PostgresProviderRepository } from "../src/providers/postgres-repository.js";
import { PostgresAssetRepository } from "../src/assets/postgres-repository.js";
import { PostgresGenerationRepository } from "../src/generations/postgres-repository.js";
import { S3ObjectStorage } from "../src/storage/s3-object-storage.js";
import { HttpGenerationProvider } from "../src/providers/http-generation-provider.js";
import { GenerationWorker } from "../src/worker/generation-worker.js";

test("PostgreSQL and MinIO retain account workspace data across adapter instances", { skip: process.env.RUN_PERSISTENCE_INTEGRATION !== "1" }, async () => {
    const environment = process.env;
    const pool = createDatabasePool(environment);
    const accountKey = `persistence-${randomUUID()}`;
    const accountRepo = new PostgresSessionRepository(pool);
    const projects = new PostgresProjectRepository(pool);
    const providers = new PostgresProviderRepository(pool);
    const assets = new PostgresAssetRepository(pool);
    const generations = new PostgresGenerationRepository(pool);
    const secretBox = new ProviderSecretBox(Buffer.alloc(32, 9));
    const storageOptions = {
        endpoint: environment.S3_ENDPOINT ?? "http://127.0.0.1:19000",
        publicEndpoint: environment.S3_PUBLIC_ENDPOINT ?? environment.S3_ENDPOINT ?? "http://127.0.0.1:19000",
        region: environment.S3_REGION ?? "us-east-1",
        bucket: environment.S3_BUCKET ?? "canvas-media",
        accessKeyId: environment.S3_ACCESS_KEY_ID ?? "canvas",
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "canvas-dev-secret",
    };
    try {
        const account = await accountRepo.upsertAccount({ sub2ApiUserId: accountKey, displayName: "Persistence Test", email: `${accountKey}@example.test`, status: "active" });
        const sessionHash = "a".repeat(64);
        await accountRepo.createSession(account, sessionHash, new Date(Date.now() + 60_000));
        assert.equal((await accountRepo.getSession(sessionHash))?.account.id, account.id);

        const project = await projects.create({ accountId: account.id, name: "Persisted canvas", data: { nodes: [{ id: "node-1" }] } });
        const provider = await providers.create({ accountId: account.id, name: "Persisted provider", providerType: "openai-compatible", model: "gpt-image-1", secret: secretBox.encrypt("sk-persisted-secret"), secretDescription: secretBox.describe("sk-persisted-secret"), status: "active" });
        const generation = await generations.create({ accountId: account.id, projectId: project.id, providerId: provider.id, kind: "image", input: { prompt: "persisted" }, inputHash: "hash", clientRequestId: `request-${accountKey}`, status: "queued", progress: 0, attempt: 0 });
        const objectStorage = new S3ObjectStorage(storageOptions);
        const stored = await objectStorage.put({ accountId: account.id, data: Buffer.from("persisted-media"), contentType: "image/png" });
        const asset = await assets.create({ accountId: account.id, projectId: project.id, kind: "image", objectKey: stored.key, providerUrl: "https://provider.example/media/1", metadata: { generationId: generation.id } });
        assert.equal(asset.objectKey, stored.key);

        const freshProjects = new PostgresProjectRepository(pool);
        const freshProviders = new PostgresProviderRepository(pool);
        const freshGenerations = new PostgresGenerationRepository(pool);
        const freshStorage = new S3ObjectStorage(storageOptions);
        assert.equal((await freshProjects.get(account.id, project.id))?.name, "Persisted canvas");
        assert.equal((await freshProviders.get(account.id, provider.id))?.secretDescription.masked, "****cret");
        assert.equal((await freshGenerations.get(account.id, generation.id))?.status, "queued");
        assert.deepEqual((await freshStorage.get(account.id, stored.key))?.data, Buffer.from("persisted-media"));
        const signedUrl = await freshStorage.createSignedReadUrl(account.id, stored.key, 60);
        const response = await fetch(signedUrl);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "persisted-media");
        await generations.cancel(account.id, generation.id);

        const workerGeneration = await generations.create({ accountId: account.id, projectId: project.id, providerId: provider.id, kind: "image", input: { prompt: "worker output", model: "gpt-image-1" }, inputHash: "worker-hash", clientRequestId: `worker-${accountKey}`, status: "queued", progress: 0, attempt: 0 });
        const workerProvider = new HttpGenerationProvider({
            baseUrl: "http://sub2api.test",
            providers: freshProviders,
            secretBox,
            fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("worker-media").toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
        });
        const worker = new GenerationWorker({ generationRepository: freshGenerations, assetRepository: assets, objectStorage: freshStorage, provider: workerProvider, workerId: "integration-worker" });
        const completed = await worker.runOnce();
        assert.equal(completed?.id, workerGeneration.id);
        assert.equal(completed?.status, "succeeded");
        assert.ok(completed?.outputAssetId);
        const workerAsset = await assets.get(account.id, completed!.outputAssetId!);
        assert.ok(workerAsset?.objectKey);
        const workerSignedUrl = await freshStorage.createSignedReadUrl(account.id, workerAsset!.objectKey!, 60);
        assert.equal(await (await fetch(workerSignedUrl)).text(), "worker-media");
    } finally {
        await pool.query("DELETE FROM canvas_accounts WHERE sub2api_user_id = $1", [accountKey]);
        await pool.end();
    }
});
