import { createHash } from "node:crypto";

import type { ProjectRepository } from "../projects/repository.js";
import type { ProviderRepository } from "../providers/repository.js";
import { HttpError } from "../http/errors.js";
import { type GenerationKind, type GenerationRecord, type GenerationRepository } from "./repository.js";

export type CreateGenerationInput = {
    projectId: string;
    providerId: string;
    kind: GenerationKind;
    input: Record<string, unknown>;
    clientRequestId: string;
};

export class GenerationConflictError extends Error {}

export class GenerationService {
    private readonly generations: GenerationRepository;
    private readonly projects: ProjectRepository;
    private readonly providers: ProviderRepository;

    constructor(options: { generations: GenerationRepository; projects: ProjectRepository; providers: ProviderRepository }) {
        this.generations = options.generations;
        this.projects = options.projects;
        this.providers = options.providers;
    }

    create(accountId: string, input: CreateGenerationInput): GenerationRecord {
        const project = this.projects.get(accountId, input.projectId);
        if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        const provider = this.providers.get(accountId, input.providerId);
        if (!provider || provider.status !== "active") throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        if (!input.clientRequestId.trim()) throw new HttpError(400, "INVALID_REQUEST", "clientRequestId is required");
        const inputHash = hashInput(input);
        const existing = this.generations.findByClientRequest(accountId, input.clientRequestId);
        if (existing) {
            if (existing.inputHash !== inputHash) throw new GenerationConflictError("clientRequestId already belongs to a different generation");
            return existing;
        }
        return this.generations.create({ ...input, accountId, inputHash, status: "queued", progress: 0, attempt: 0 });
    }

    list(accountId: string): GenerationRecord[] {
        return this.generations.list(accountId);
    }

    get(accountId: string, id: string): GenerationRecord | undefined {
        return this.generations.get(accountId, id);
    }

    cancel(accountId: string, id: string): boolean {
        return this.generations.cancel(accountId, id);
    }
}

function hashInput(input: CreateGenerationInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
