import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedSecret = {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
};

export type MaskedSecret = {
    fingerprint: string;
    masked: string;
};

export class ProviderSecretBox {
    private readonly key: Buffer;
    private readonly keyVersion: string;

    constructor(masterKey: Buffer, keyVersion = "v1") {
        if (masterKey.length !== 32) throw new Error("Provider master key must be exactly 32 bytes");
        this.key = Buffer.from(masterKey);
        this.keyVersion = keyVersion;
    }

    static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ProviderSecretBox {
        const raw = environment.CANVAS_PROVIDER_MASTER_KEY;
        if (!raw) {
            if (environment.NODE_ENV === "production") throw new Error("CANVAS_PROVIDER_MASTER_KEY is required in production");
            return new ProviderSecretBox(randomBytes(32), "development");
        }
        const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
        return new ProviderSecretBox(key);
    }

    encrypt(secret: string): EncryptedSecret {
        if (!secret.trim()) throw new Error("Provider secret cannot be empty");
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
        return {
            ciphertext: ciphertext.toString("base64url"),
            iv: iv.toString("base64url"),
            authTag: cipher.getAuthTag().toString("base64url"),
            keyVersion: this.keyVersion,
        };
    }

    decrypt(record: EncryptedSecret): string {
        const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64url"));
        decipher.setAuthTag(Buffer.from(record.authTag, "base64url"));
        return Buffer.concat([
            decipher.update(Buffer.from(record.ciphertext, "base64url")),
            decipher.final(),
        ]).toString("utf8");
    }

    describe(secret: string): MaskedSecret {
        const normalized = secret.trim();
        const fingerprint = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
        const suffix = normalized.slice(-4);
        return { fingerprint, masked: `****${suffix}` };
    }
}
