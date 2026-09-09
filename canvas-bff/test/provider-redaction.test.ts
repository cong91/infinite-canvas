import assert from "node:assert/strict";
import test from "node:test";

import { ProviderSecretBox } from "../src/crypto/secret-box.js";
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
