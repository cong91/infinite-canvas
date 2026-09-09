export const REDACTED = "[REDACTED]";

const secretKeyPattern = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|provider[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|jwt|token|password|secret|credential)$/i;

export function isSecretKey(key: string): boolean {
    return secretKeyPattern.test(key.replace(/[\s-]/g, "")) || /(?:api|provider|access|refresh)[-_]?(?:key|token)$/i.test(key);
}

export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
        key,
        isSecretKey(key) ? REDACTED : value,
    ]));
}

export function redactUrl(value: string): string {
    try {
        const url = new URL(value);
        for (const key of url.searchParams.keys()) {
            if (isSecretKey(key)) url.searchParams.set(key, REDACTED);
        }
        return url.toString();
    } catch {
        return REDACTED;
    }
}

export function redactSecrets<T>(value: T): T {
    return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactValue);
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
        key,
        isSecretKey(key) ? REDACTED : redactValue(nested),
    ]));
}
