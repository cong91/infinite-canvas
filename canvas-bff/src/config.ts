import { z } from "zod";

export const DEFAULT_PORT = 17372;

const urlOrigin = z.string().url().transform((value, context) => {
    try {
        const url = new URL(value);
        if (!url.origin || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "URL must be an origin without a path, query or hash" });
            return z.NEVER;
        }
        return url.origin;
    } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "URL must be a valid origin" });
        return z.NEVER;
    }
});

export const canvasBffConfigSchema = z.object({
    port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
    canvasOrigin: urlOrigin,
    sub2ApiBaseUrl: urlOrigin,
    sub2ApiCanvasBffSecret: z.string().trim().min(32).optional(),
    environment: z.enum(["development", "test", "production"]).default("development"),
}).superRefine((value, context) => {
    if (value.environment === "production" && !value.sub2ApiCanvasBffSecret) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "SUB2API_CANVAS_BFF_SECRET is required in production" });
    }
    if (value.environment === "production" && new URL(value.canvasOrigin).protocol !== "https:") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "CANVAS_ORIGIN must use HTTPS in production" });
    }
});

export type CanvasBffConfig = z.output<typeof canvasBffConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CanvasBffConfig {
    return canvasBffConfigSchema.parse({
        port: env.PORT,
        canvasOrigin: env.CANVAS_ORIGIN,
        sub2ApiBaseUrl: env.SUB2API_BASE_URL,
        sub2ApiCanvasBffSecret: env.SUB2API_CANVAS_BFF_SECRET,
        environment: env.NODE_ENV,
    });
}
