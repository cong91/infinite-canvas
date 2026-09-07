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
    environment: z.enum(["development", "test", "production"]).default("development"),
});

export type CanvasBffConfig = z.output<typeof canvasBffConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CanvasBffConfig {
    return canvasBffConfigSchema.parse({
        port: env.PORT,
        canvasOrigin: env.CANVAS_ORIGIN,
        sub2ApiBaseUrl: env.SUB2API_BASE_URL,
        environment: env.NODE_ENV,
    });
}
