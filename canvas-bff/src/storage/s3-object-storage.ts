import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { type ObjectStorage, type ObjectStoragePutInput, type StoredObject, type StoredObjectSummary } from "./object-storage.js";

export type S3ObjectStorageOptions = {
    endpoint: string;
    publicEndpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    maxBytes?: number;
};

export class S3ObjectStorage implements ObjectStorage {
    private readonly client: S3Client;
    private readonly signingClient: S3Client;
    private readonly bucket: string;
    private readonly endpoint: URL;
    private readonly signingEndpoint: URL;
    private readonly maxBytes: number;

    constructor(options: S3ObjectStorageOptions) {
        this.endpoint = new URL(options.endpoint);
        this.signingEndpoint = new URL(options.publicEndpoint ?? options.endpoint);
        this.bucket = options.bucket.trim();
        if (!this.bucket || !options.accessKeyId.trim() || !options.secretAccessKey.trim()) throw new Error("S3 object storage credentials are required");
        this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
        const credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey };
        this.client = new S3Client({ endpoint: this.endpoint.toString().replace(/\/$/, ""), region: options.region, forcePathStyle: true, credentials });
        this.signingClient = options.publicEndpoint
            ? new S3Client({ endpoint: options.publicEndpoint.replace(/\/$/, ""), region: options.region, forcePathStyle: true, credentials })
            : this.client;
    }

    async put(input: ObjectStoragePutInput): Promise<StoredObject> {
        const accountId = normalizeSegment(input.accountId, "account id");
        const key = input.key ? validateKey(input.key, accountId) : `accounts/${accountId}/assets/${randomUUID()}`;
        const data = Buffer.from(input.data);
        if (data.byteLength > this.maxBytes) throw new Error("Object exceeds the configured size limit");
        if (!input.contentType.trim() || input.contentType.length > 200) throw new Error("Invalid object content type");
        const checksum = createHash("sha256").update(data).digest("hex");
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: input.contentType, Metadata: { accountId, checksum } }));
        return { key, accountId, data: Buffer.from(data), contentType: input.contentType, size: data.byteLength, checksum, createdAt: new Date() };
    }

    async assertReady(): Promise<void> {
        await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
    }

    async get(accountId: string, key: string): Promise<StoredObject | undefined> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const validKey = validateKey(key, normalizedAccountId);
        try {
            const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: validKey }));
            const data = await bodyToBuffer(result.Body);
            const checksum = result.Metadata?.checksum ?? createHash("sha256").update(data).digest("hex");
            return { key: validKey, accountId: normalizedAccountId, data, contentType: result.ContentType ?? "application/octet-stream", size: data.byteLength, checksum, createdAt: new Date() };
        } catch (error) {
            if (isNotFound(error)) return undefined;
            throw error;
        }
    }

    async list(accountId: string): Promise<StoredObject[]> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const objects = await Promise.all((await this.listMetadata(`accounts/${normalizedAccountId}/`)).map((item) => this.get(normalizedAccountId, item.key)));
        return objects.filter((item): item is StoredObject => Boolean(item));
    }

    async listAll(): Promise<StoredObjectSummary[]> {
        return this.listMetadata("accounts/");
    }

    async delete(accountId: string, key: string): Promise<boolean> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const validKey = validateKey(key, normalizedAccountId);
        try {
            await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: validKey }));
            return true;
        } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
        }
    }

    async createSignedReadUrl(accountId: string, key: string, ttlSeconds: number): Promise<string> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        const validKey = validateKey(key, normalizedAccountId);
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3_600) throw new Error("Invalid signed URL TTL");
        const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: validKey })).catch((error: unknown) => {
            if (isNotFound(error)) return undefined;
            throw error;
        });
        if (!head) return "";
        return getSignedUrl(this.signingClient, new GetObjectCommand({ Bucket: this.bucket, Key: validKey }), { expiresIn: ttlSeconds });
    }

    async readSignedUrl(accountId: string, signedUrl: string): Promise<StoredObject | undefined> {
        const normalizedAccountId = normalizeSegment(accountId, "account id");
        let parsed: URL;
        try { parsed = new URL(signedUrl); } catch { return undefined; }
        if (parsed.origin !== this.endpoint.origin && parsed.origin !== this.signingEndpoint.origin) return undefined;
        const prefix = `/${this.bucket}/`;
        if (!parsed.pathname.startsWith(prefix)) return undefined;
        const key = decodeURIComponent(parsed.pathname.slice(prefix.length));
        if (!key.startsWith(`accounts/${normalizedAccountId}/`)) return undefined;
        return this.get(normalizedAccountId, key);
    }

    private async listMetadata(prefix: string): Promise<StoredObjectSummary[]> {
        const objects: StoredObjectSummary[] = [];
        let continuationToken: string | undefined;
        do {
            const result = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
            for (const item of result.Contents ?? []) {
                const key = item.Key;
                const match = key?.match(/^accounts\/([^/]+)\//);
                if (!key || !match) continue;
                objects.push({ key, accountId: match[1], size: Number(item.Size ?? 0), createdAt: item.LastModified ?? new Date(0) });
            }
            continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
        return objects;
    }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (typeof body === "object" && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
        return Buffer.from(await body.transformToByteArray());
    }
    if (typeof body === "object" && Symbol.asyncIterator in body) {
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Uint8Array | string>) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }
    if (typeof body === "string") return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
    return Buffer.from(body as Uint8Array);
}

function normalizeSegment(value: string, label: string): string {
    if (!value.trim() || value.includes("/") || value.includes("\\") || value.includes("..")) throw new Error(`Invalid ${label}`);
    return value.trim();
}

function validateKey(key: string, accountId: string): string {
    if (!key.startsWith(`accounts/${accountId}/`) || key.includes("..") || key.includes("\\") || key.startsWith("/")) throw new Error("Invalid object key");
    return key;
}

function isNotFound(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "$metadata" in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        || Boolean(error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound", "NoSuchBucket"].includes(String((error as { name: unknown }).name)));
}
