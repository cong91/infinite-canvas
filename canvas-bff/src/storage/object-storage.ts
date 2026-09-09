import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type ObjectStoragePutInput = {
    accountId: string;
    data: Buffer | Uint8Array | string;
    contentType: string;
    key?: string;
};

export type StoredObject = {
    key: string;
    accountId: string;
    data: Buffer;
    contentType: string;
    size: number;
    checksum: string;
    createdAt: Date;
};

export type StoredObjectSummary = Pick<StoredObject, "key" | "accountId" | "size" | "createdAt">;

export interface ObjectStorage {
    put(input: ObjectStoragePutInput): Promise<StoredObject>;
    get(accountId: string, key: string): Promise<StoredObject | undefined>;
    list(accountId: string): Promise<StoredObject[]>;
    listAll(): Promise<StoredObjectSummary[]>;
    delete(accountId: string, key: string): Promise<boolean>;
    createSignedReadUrl(accountId: string, key: string, ttlSeconds: number): Promise<string>;
    readSignedUrl(accountId: string, signedUrl: string): Promise<StoredObject | undefined>;
}

type SignedPayload = { accountId: string; key: string; expiresAt: number };

export class InMemoryObjectStorage implements ObjectStorage {
    private readonly objects = new Map<string, StoredObject>();
    private readonly signingSecret: Buffer;
    private readonly now: () => number;
    private readonly maxBytes: number;

    constructor(options: { signingSecret: string; now?: () => number; maxBytes?: number }) {
        if (!options.signingSecret.trim()) throw new Error("Object storage signing secret is required");
        this.signingSecret = Buffer.from(options.signingSecret, "utf8");
        this.now = options.now ?? Date.now;
        this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    }

    async put(input: ObjectStoragePutInput): Promise<StoredObject> {
        const accountId = normalizeSegment(input.accountId, "account id");
        const key = input.key ? validateKey(input.key, accountId) : `accounts/${accountId}/assets/${randomUUID()}`;
        const data = Buffer.from(input.data);
        if (data.byteLength > this.maxBytes) throw new Error("Object exceeds the configured size limit");
        if (!input.contentType.trim() || input.contentType.length > 200) throw new Error("Invalid object content type");
        const record: StoredObject = {
            key,
            accountId,
            data: Buffer.from(data),
            contentType: input.contentType,
            size: data.byteLength,
            checksum: createHash("sha256").update(data).digest("hex"),
            createdAt: new Date(this.now()),
        };
        this.objects.set(key, record);
        return cloneObject(record);
    }

    async get(accountId: string, key: string): Promise<StoredObject | undefined> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const record = this.objects.get(key);
        return record?.accountId === normalizedAccountId ? cloneObject(record) : undefined;
    }

    async list(accountId: string): Promise<StoredObject[]> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        return [...this.objects.values()].filter((record) => record.accountId === normalizedAccountId).map(cloneObject);
    }

    async listAll(): Promise<StoredObjectSummary[]> {
        return [...this.objects.values()].map(toSummary);
    }

    async delete(accountId: string, key: string): Promise<boolean> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const record = this.objects.get(validateKey(key, normalizedAccountId));
        return Boolean(record?.accountId === normalizedAccountId && this.objects.delete(key));
    }

    async createSignedReadUrl(accountId: string, key: string, ttlSeconds: number): Promise<string> {
        const record = await this.get(accountId, key);
        if (!record) return "";
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3_600) throw new Error("Invalid signed URL TTL");
        const payload: SignedPayload = { accountId: record.accountId, key: record.key, expiresAt: this.now() + ttlSeconds * 1_000 };
        const encoded = encodePayload(payload);
        return `https://canvas-storage.invalid/object/${encoded}.${sign(encoded, this.signingSecret)}`;
    }

    async readSignedUrl(accountId: string, signedUrl: string): Promise<StoredObject | undefined> {
        let pathname: string;
        try {
            const parsed = new URL(signedUrl);
            if (parsed.origin !== "https://canvas-storage.invalid") return undefined;
            pathname = parsed.pathname;
        } catch {
            return undefined;
        }
        const match = /^\/object\/([^./]+)\.([A-Za-z0-9_-]+)$/.exec(pathname);
        if (!match) return undefined;
        const [encoded, signature] = match.slice(1);
        const expected = sign(encoded, this.signingSecret);
        if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
        let payload: SignedPayload;
        try {
            payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedPayload;
        } catch {
            return undefined;
        }
        if (payload.accountId !== accountId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= this.now()) return undefined;
        return this.get(accountId, payload.key);
    }
}

function normalizeSegment(value: string, label: string): string {
    if (!value.trim() || value.includes("/") || value.includes("\\") || value.includes("..")) throw new Error(`Invalid ${label}`);
    return value.trim();
}

function validateKey(key: string, accountId: string): string {
    if (!key.startsWith(`accounts/${accountId}/`) || key.includes("..") || key.includes("\\") || key.startsWith("/")) throw new Error("Invalid object key");
    return key;
}

function encodePayload(payload: SignedPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(value: string, secret: Buffer): string {
    return createHmac("sha256", secret).update(value).digest("base64url");
}

function cloneObject(record: StoredObject): StoredObject {
    return { ...record, data: Buffer.from(record.data), createdAt: new Date(record.createdAt) };
}

function toSummary(record: StoredObject): StoredObjectSummary {
    return { key: record.key, accountId: record.accountId, size: record.size, createdAt: new Date(record.createdAt) };
}
