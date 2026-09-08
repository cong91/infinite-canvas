import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAssetRepository } from "../src/assets/repository.js";
import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { GenerationConflictError, GenerationService } from "../src/generations/service.js";
import { InMemoryGenerationRepository } from "../src/generations/repository.js";
import { InMemoryProjectRepository } from "../src/projects/repository.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";

function createFixture() {
    const projects = new InMemoryProjectRepository();
    const providers = new InMemoryProviderRepository();
    const assets = new InMemoryAssetRepository();
    const accountId = "account-a";
    const project = projects.create({ accountId, name: "Demo", data: {} });
    const provider = providers.create({
        accountId,
        name: "Provider",
        providerType: "openai-compatible",
        secret: new ProviderSecretBox(Buffer.alloc(32, 1)).encrypt("provider-secret"),
        secretDescription: { fingerprint: "fingerprint", masked: "****cret" },
        status: "active",
    });
    const service = new GenerationService({ generations: new InMemoryGenerationRepository(), projects, providers });
    return { service, accountId, project, provider };
}

test("generation creation is idempotent per account and client request id", async () => {
    const { service, accountId, project, provider } = createFixture();
    const input = { projectId: project.id, providerId: provider.id, kind: "image" as const, input: { prompt: "a tree" }, clientRequestId: "request-1" };
    const first = await service.create(accountId, input);
    const duplicate = await service.create(accountId, input);

    assert.equal(duplicate.id, first.id);
    assert.equal((await service.list(accountId)).length, 1);
});

test("generation rejects a changed payload for an existing idempotency key and foreign records", async () => {
    const { service, accountId, project, provider } = createFixture();
    await service.create(accountId, { projectId: project.id, providerId: provider.id, kind: "image", input: { prompt: "a tree" }, clientRequestId: "request-1" });
    await assert.rejects(
        () => service.create(accountId, { projectId: project.id, providerId: provider.id, kind: "image", input: { prompt: "a house" }, clientRequestId: "request-1" }),
        GenerationConflictError,
    );
    await assert.rejects(
        () => service.create("account-b", { projectId: project.id, providerId: provider.id, kind: "image", input: {}, clientRequestId: "request-2" }),
        /Project was not found/,
    );
    assert.equal(await service.get("account-b", (await service.list(accountId))[0].id), undefined);
});
