import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryObjectStorage } from "../src/storage/object-storage.js";

test("object storage uses account-scoped keys and validates signed URL ownership", async () => {
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret" });
    const stored = await storage.put({ accountId: "account-a", data: Buffer.from("image-data"), contentType: "image/png" });

    assert.match(stored.key, /^accounts\/account-a\/assets\//);
    assert.equal(stored.contentType, "image/png");
    assert.equal(stored.size, 10);
    assert.match(stored.checksum, /^[a-f0-9]{64}$/);

    const signedUrl = await storage.createSignedReadUrl("account-a", stored.key, 60);
    assert.equal((await storage.readSignedUrl("account-a", signedUrl))?.data.toString(), "image-data");
    assert.equal(await storage.readSignedUrl("account-b", signedUrl), undefined);
    assert.equal((await storage.get("account-b", stored.key)), undefined);
});

test("object storage rejects traversal and expired signed URLs", async () => {
    let now = 1_000;
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret", now: () => now });
    await assert.rejects(
        storage.put({ accountId: "account-a", key: "accounts/account-b/../secret", data: "x", contentType: "text/plain" }),
        /Invalid object key/,
    );
    const stored = await storage.put({ accountId: "account-a", data: "x", contentType: "text/plain" });
    const url = await storage.createSignedReadUrl("account-a", stored.key, 1);
    now = 2_001;
    assert.equal(await storage.readSignedUrl("account-a", url), undefined);
});
