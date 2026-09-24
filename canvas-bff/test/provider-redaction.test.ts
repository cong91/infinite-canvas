import assert from "node:assert/strict";
import test from "node:test";

import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { HttpError } from "../src/http/errors.js";
import { Sub2ApiCatalogAdapter } from "../src/providers/sub2api-catalog.js";

test("provider secret encryption decrypts and exposes only a fingerprint", () => {
    const box = new ProviderSecretBox(Buffer.alloc(32, 7));
    const encrypted = box.encrypt("provider-secret-value");
    assert.equal(box.decrypt(encrypted), "provider-secret-value");
    assert.notEqual(encrypted.ciphertext, "provider-secret-value");
    assert.equal(box.describe("provider-secret-value").masked, "****alue");
    assert.equal(box.describe("provider-secret-value").fingerprint.length, 16);
});

test("catalog adapter allowlists paths and redacts Sub2Api key values", async () => {
    const calls: string[] = [];
    const adapter = new Sub2ApiCatalogAdapter("https://sub2api.example.test", async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
        const data = url.pathname === "/api/v1/keys"
            ? [{ id: "key-1", name: "OpenAI", key: "sk-super-secret" }]
            : [{ id: "catalog-1", name: "Catalog" }];
        return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const catalog = await adapter.listCatalog("fixture-token");
    assert.deepEqual(catalog.keys[0], {
        id: "key-1",
        name: "OpenAI",
        fingerprint: "ee0170808afdf2a6",
        maskedKey: "****cret",
    });
    assert.equal(JSON.stringify(catalog).includes("sk-super-secret"), false);
    assert.deepEqual(calls.sort(), [
        "/api/v1/channels/available",
        "/api/v1/groups/available",
        "/api/v1/groups/rates",
        "/api/v1/keys",
    ]);
});

test("catalog adapter lists provider models with the provider secret", async () => {
    const adapter = new Sub2ApiCatalogAdapter("https://sub2api.example.test", async (input, init) => {
        assert.equal(String(input), "https://sub2api.example.test/v1/models");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-provider-secret");
        return new Response(JSON.stringify({ data: [{ id: "gpt-image-1" }, { id: "grok-imagine-video" }, { id: "gpt-image-1" }] }), { status: 200 });
    });
    assert.deepEqual(await adapter.listModels("sk-provider-secret"), ["gpt-image-1", "grok-imagine-video"]);
});

test("catalog adapter flattens nested provider references without object stringification", async () => {
    const adapter = new Sub2ApiCatalogAdapter("https://sub2api.example.test", async (input) => {
        const path = new URL(String(input)).pathname;
        const data = path === "/api/v1/keys"
            ? [{
                id: { id: "key-nested", name: "Grok video" },
                name: "Grok video",
                provider: { id: "grok", name: "xAI" },
                group: { id: 42, name: "grok-video" },
                channel: { id: 9, name: "xai-primary" },
                key: "sk-nested-secret",
            }]
            : [{ id: 42, name: "grok-video", provider: { id: "grok", name: "xAI" } }];

        return new Response(JSON.stringify({ data }), { status: 200 });
    });

    const catalog = await adapter.listCatalog("fixture-token");
    assert.equal(catalog.keys[0].providerType, "xAI");
    assert.equal(catalog.keys[0].id, "key-nested");
    assert.equal(catalog.keys[0].group, "grok-video");
    assert.equal(catalog.keys[0].channel, "xai-primary");
    assert.equal(JSON.stringify(catalog).includes("[object Object]"), false);
    const resolved = await adapter.getApiKeySecret("fixture-token", "key-nested");
    assert.equal(resolved.secret, "sk-nested-secret");
});

test("catalog adapter extracts group capability flags for image and video filtering", async () => {
    const adapter = new Sub2ApiCatalogAdapter("https://sub2api.example.test", async (input) => {
        const path = new URL(String(input)).pathname;
        const data = path === "/api/v1/groups/available"
            ? [
                { id: 1, name: "image-group", platform: "grok", allow_image_generation: true, rate_multiplier: 1 },
                { id: 2, name: "batch-image-group", allow_batch_image_generation: true },
                { id: 3, name: "video-multiplier-group", video_rate_multiplier: 1.5 },
                { id: 4, name: "video-price-group", video_price_720p: 0.1 },
                { id: 5, name: "video-models-group", video_model_prices: { "grok-imagine-video": { price: 1 } } },
                { id: 6, name: "text-only-group", allow_image_generation: false, video_rate_multiplier: 0 },
            ]
            : [];
        return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const catalog = await adapter.listCatalog("fixture-token");
    const byName = new Map(catalog.groups.map((item) => [item.name, item]));
    const image = byName.get("image-group");
    assert.equal(image?.allowImageGeneration, true);
    assert.equal(image?.videoCapable, undefined);
    assert.equal(image?.platform, "grok");
    assert.equal(image?.rateMultiplier, 1);
    assert.equal(byName.get("batch-image-group")?.allowImageGeneration, true);
    assert.equal(byName.get("video-multiplier-group")?.videoCapable, true);
    assert.equal(byName.get("video-price-group")?.videoCapable, true);
    assert.equal(byName.get("video-models-group")?.videoCapable, true);
    const textOnly = byName.get("text-only-group");
    assert.equal(textOnly?.allowImageGeneration, undefined);
    assert.equal(textOnly?.videoCapable, undefined);
});

test("catalog adapter createKey maps upstream failures and validates the response", async () => {
    const bodies: unknown[] = [];
    const adapter = new Sub2ApiCatalogAdapter("https://sub2api.example.test", async (_input, init) => {
        const call = bodies.push(JSON.parse(String(init?.body)));
        if (call === 1) return new Response(JSON.stringify({ message: "group requires a subscription" }), { status: 400 });
        if (call === 2) return new Response(JSON.stringify({}), { status: 401 });
        if (call === 3) return new Response(JSON.stringify({ data: { id: 9, name: "key-9" } }), { status: 200 });
        return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    });

    await assert.rejects(adapter.createKey("fixture-token", { name: "K", groupId: "grok-media" }), (error: HttpError) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "SUB2API_KEY_CREATE_FAILED");
        assert.equal(error.message, "group requires a subscription");
        return true;
    });
    await assert.rejects(adapter.createKey("fixture-token", { name: "K", groupId: "5" }), (error: HttpError) => {
        assert.equal(error.statusCode, 401);
        assert.equal(error.code, "SUB2API_UNAUTHORIZED");
        return true;
    });
    await assert.rejects(adapter.createKey("fixture-token", { name: "K", groupId: "5" }), (error: HttpError) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "SUB2API_INVALID_RESPONSE");
        return true;
    });
    await assert.rejects(adapter.createKey("fixture-token", { name: "K", groupId: "5" }), (error: HttpError) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "SUB2API_INVALID_RESPONSE");
        return true;
    });
    assert.deepEqual(bodies[0], { name: "K", group_id: "grok-media" });
    assert.deepEqual(bodies[1], { name: "K", group_id: 5 });
});
