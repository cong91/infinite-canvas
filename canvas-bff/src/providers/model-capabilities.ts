/** Static per-model generation capabilities. Bump these when a provider ships new limits. */
export type ModelCapabilityRule = {
    /** Model names starting with this prefix (case-insensitive) match the rule. */
    pattern: string;
    maxDurationSeconds: number;
};

const VIDEO_DURATION_LIMITS: ModelCapabilityRule[] = [
    // Verified by upstream replay 2026-09-26: xAI rejects duration > 15 with 400.
    { pattern: "grok-imagine-video", maxDurationSeconds: 15 },
];

export function videoDurationLimit(model: string | undefined): number | undefined {
    const name = String(model ?? "")
        .trim()
        .toLowerCase();
    if (!name) return undefined;
    return VIDEO_DURATION_LIMITS.find((rule) => name.startsWith(rule.pattern.toLowerCase()))?.maxDurationSeconds;
}

export function videoDurationLimits(): ModelCapabilityRule[] {
    return VIDEO_DURATION_LIMITS;
}
