export type ErrorEnvelope = {
    code: string;
    message: string;
    requestId: string;
};

export class HttpError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function toErrorEnvelope(error: unknown, requestId: string): { statusCode: number; body: ErrorEnvelope } {
    if (error instanceof HttpError) {
        return { statusCode: error.statusCode, body: { code: error.code, message: error.message, requestId } };
    }
    if (isBodyParserError(error)) {
        return { statusCode: 400, body: { code: "INVALID_JSON", message: "Request body is invalid", requestId } };
    }
    return { statusCode: 500, body: { code: "INTERNAL_ERROR", message: "Internal server error", requestId } };
}

function isBodyParserError(error: unknown): error is { type: string } {
    return Boolean(error && typeof error === "object" && "type" in error && error.type === "entity.parse.failed");
}
