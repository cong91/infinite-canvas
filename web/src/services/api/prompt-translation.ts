import type { AiTextMessage } from "./image";
import { requestImageQuestion } from "./image";
import type { Prompt } from "./prompts";
import type { AiConfig } from "@/stores/use-config-store";

export type PromptTranslation = Pick<Prompt, "title" | "description" | "tags" | "preview" | "prompt">;

const TRANSLATION_INSTRUCTIONS = `Translate the prompt-library entry into natural Vietnamese.
Keep product names, model names, code, URLs, placeholder tokens, and technical identifiers unchanged.
Translate the title, description, tags, preview, and prompt completely when they contain Chinese or English.
Return only a JSON object with exactly these fields: title (string), description (string), tags (string[]), preview (string), prompt (string).`;

export async function translatePromptToVietnamese(prompt: PromptTranslation, config: AiConfig, options?: { signal?: AbortSignal }) {
    const messages: AiTextMessage[] = [
        { role: "system", content: TRANSLATION_INSTRUCTIONS },
        {
            role: "user",
            content: JSON.stringify({ title: prompt.title, description: prompt.description, tags: prompt.tags, preview: prompt.preview, prompt: prompt.prompt }, null, 2),
        },
    ];
    const answer = await requestImageQuestion({ ...config, model: config.textModel, systemPrompt: "" }, messages, () => undefined, options);
    return parsePromptTranslation(answer);
}

export function parsePromptTranslation(value: string): PromptTranslation {
    const source = value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The translation response is not valid JSON");
    let parsed: unknown;
    try {
        parsed = JSON.parse(source.slice(start, end + 1));
    } catch {
        throw new Error("The translation response is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("The translation response is not valid");
    const record = parsed as Record<string, unknown>;
    if (!isString(record.title) || !isString(record.description) || !isString(record.preview) || !isString(record.prompt) || !Array.isArray(record.tags) || !record.tags.every(isString)) {
        throw new Error("The translation response is incomplete");
    }
    return { title: record.title, description: record.description, tags: record.tags, preview: record.preview, prompt: record.prompt };
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}
