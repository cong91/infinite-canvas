import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAssetRepository } from "../src/assets/repository.js";
import { InMemoryObjectStorage } from "../src/storage/object-storage.js";
import { ObjectStorageRetention } from "../src/storage/retention.js";

test("storage retention removes the oldest objects and their asset records across accounts", async () => {
    let now = 1_000;
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret", now: () => now });
    const assets = new InMemoryAssetRepository();
    const retention = new ObjectStorageRetention({ storage, assets, maxBytes: 5 });

    const old = await storage.put({ accountId: "account-a", data: "old", contentType: "text/plain" });
    assets.create({ accountId: "account-a", kind: "file", objectKey: old.key, metadata: {} });
    now += 1_000;
    const newest = await storage.put({ accountId: "account-b", data: "newest", contentType: "text/plain" });
    assets.create({ accountId: "account-b", kind: "file", objectKey: newest.key, metadata: {} });

    const deleted = await retention.enforce({ protectedKeys: [newest.key] });

    assert.deepEqual(deleted.map((item) => item.key), [old.key]);
    assert.equal(await storage.get("account-a", old.key), undefined);
    assert.ok(await storage.get("account-b", newest.key));
    assert.equal(assets.list("account-a").length, 0);
    assert.equal(assets.list("account-b").length, 1);
});

test("storage retention keeps the newest object when it alone is larger than the cap", async () => {
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret" });
    const assets = new InMemoryAssetRepository();
    const retention = new ObjectStorageRetention({ storage, assets, maxBytes: 2 });
    const newest = await storage.put({ accountId: "account-a", data: "larger", contentType: "text/plain" });
    assets.create({ accountId: "account-a", kind: "file", objectKey: newest.key, metadata: {} });

    assert.deepEqual(await retention.enforce({ protectedKeys: [newest.key] }), []);
    assert.ok(await storage.get("account-a", newest.key));
    assert.equal(assets.list("account-a").length, 1);
});

test("storage retention serializes concurrent enforcement with the configured lock", async () => {
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret" });
    const assets = new InMemoryAssetRepository();
    let activeLocks = 0;
    let maxActiveLocks = 0;
    let pendingRelease: Promise<void> = Promise.resolve();
    const retention = new ObjectStorageRetention({
        storage,
        assets,
        maxBytes: 1,
        lock: {
            async acquire() {
                const previousRelease = pendingRelease;
                let releaseLock!: () => void;
                pendingRelease = new Promise<void>((resolve) => { releaseLock = resolve; });
                await previousRelease;
                activeLocks += 1;
                maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
                return async () => { activeLocks -= 1; releaseLock(); };
            },
        },
    });
    await storage.put({ accountId: "account-a", data: "old", contentType: "text/plain" });

    await Promise.all([retention.enforce(), retention.enforce()]);

    assert.equal(maxActiveLocks, 1);
    assert.equal(activeLocks, 0);
});

test("storage retention leaves the object when asset cleanup fails", async () => {
    const storage = new InMemoryObjectStorage({ signingSecret: "test-signing-secret" });
    const assets = {
        async deleteByObjectKey() { throw new Error("database unavailable"); },
    } as InMemoryAssetRepository;
    const retention = new ObjectStorageRetention({ storage, assets, maxBytes: 1 });
    const old = await storage.put({ accountId: "account-a", data: "old", contentType: "text/plain" });

    await assert.rejects(retention.enforce(), /database unavailable/);
    assert.ok(await storage.get("account-a", old.key));
});
