import type { VideoDurationLimitRule } from "@/services/api/canvas-bff";

/** Resolve the max video duration a model supports. Prefix match, case-insensitive; undefined = no known limit. */
export function videoDurationLimit(model: string | undefined, rules: VideoDurationLimitRule[] | undefined | null): number | undefined {
    const name = String(model || "")
        .trim()
        .toLowerCase();
    if (!name || !rules?.length) return undefined;
    return rules.find((rule) => name.startsWith(rule.pattern.toLowerCase()))?.maxDurationSeconds;
}
