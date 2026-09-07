import { HttpError } from "../http/errors.js";

export type Sub2ApiIdentity = {
    sub2ApiUserId: string;
    displayName: string;
    email?: string;
    status: string;
};

type Sub2ApiEnvelope = {
    data?: unknown;
    message?: unknown;
};

export class Sub2ApiClientError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.name = "Sub2ApiClientError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

export class Sub2ApiClient {
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    constructor(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async verifyAccessToken(accessToken: string): Promise<Sub2ApiIdentity> {
        if (!accessToken.trim()) throw new HttpError(401, "AUTHORIZATION_REQUIRED", "Authorization is required");

        let response = await this.request("/api/v1/auth/me", accessToken);
        if (response.status === 404) response = await this.request("/api/v1/user/profile", accessToken);
        if (!response.ok) throw this.toError(response);

        const body = await this.readEnvelope(response);
        return normalizeIdentity(body.data);
    }

    private async request(path: string, accessToken: string): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
                signal: controller.signal,
            });
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Sub2ApiClientError(503, "SUB2API_UNAVAILABLE", "Sub2API did not respond in time");
            }
            throw new Sub2ApiClientError(503, "SUB2API_UNAVAILABLE", "Sub2API could not be reached");
        } finally {
            clearTimeout(timeout);
        }
    }

    private async readEnvelope(response: Response): Promise<Sub2ApiEnvelope> {
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            throw new Sub2ApiClientError(502, "SUB2API_INVALID_RESPONSE", "Sub2API returned invalid JSON");
        }
        if (!body || typeof body !== "object" || !("data" in body)) {
            throw new Sub2ApiClientError(502, "SUB2API_INVALID_RESPONSE", "Sub2API returned an invalid response");
        }
        return body as Sub2ApiEnvelope;
    }

    private toError(response: Response): Sub2ApiClientError {
        if (response.status === 401 || response.status === 403) {
            return new Sub2ApiClientError(401, "SUB2API_UNAUTHORIZED", "Sub2API rejected the session");
        }
        if (response.status >= 500) {
            return new Sub2ApiClientError(503, "SUB2API_UNAVAILABLE", "Sub2API is temporarily unavailable");
        }
        return new Sub2ApiClientError(502, "SUB2API_INVALID_RESPONSE", "Sub2API returned an invalid response");
    }
}

function normalizeIdentity(value: unknown): Sub2ApiIdentity {
    const record = asRecord(value);
    const nested = asRecord(record.user);
    const source = Object.keys(nested).length > 0 ? nested : record;
    const id = source.id ?? source.user_id ?? source.userId;
    if (id === undefined || id === null || String(id).trim() === "") {
        throw new Sub2ApiClientError(502, "SUB2API_INVALID_RESPONSE", "Sub2API identity is missing an id");
    }

    const email = asOptionalString(source.email);
    const displayName = asOptionalString(source.display_name)
        ?? asOptionalString(source.displayName)
        ?? asOptionalString(source.nickname)
        ?? asOptionalString(source.username)
        ?? email
        ?? String(id);

    return {
        sub2ApiUserId: String(id),
        displayName,
        ...(email ? { email } : {}),
        status: asOptionalString(source.status) ?? "active",
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
