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

export type GenerationServiceOptions = { generations: GenerationRepository; projects: ProjectRepository; providers: ProviderRepository };

export class GenerationConflictError extends HttpError {
    constructor() {
        super(409, "GENERATION_IDEMPOTENCY_CONFLICT", "clientRequestId already belongs to a different generation");
    }
}

export class GenerationService {
    private readonly generations: GenerationRepository;
    private readonly projects: ProjectRepository;
    private readonly providers: ProviderRepository;

    constructor(options: GenerationServiceOptions) {
        this.generations = options.generations;
        this.projects = options.projects;
        this.providers = options.providers;
    }

    async create(accountId: string, input: CreateGenerationInput): Promise<GenerationRecord> {
        const project = await this.projects.get(accountId, input.projectId);
        if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        const provider = await this.providers.get(accountId, input.providerId);
        if (!provider || provider.status !== "active") throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        if (!input.clientRequestId.trim()) throw new HttpError(400, "INVALID_REQUEST", "clientRequestId is required");
        const inputHash = hashInput(input);
        const existing = await this.generations.findByClientRequest(accountId, input.clientRequestId);
        if (existing) {
            if (existing.inputHash !== inputHash) throw new GenerationConflictError();
            return existing;
        }
        return this.generations.create({ ...input, accountId, inputHash, status: "queued", progress: 0, attempt: 0 });
    }

    async list(accountId: string): Promise<GenerationRecord[]> {
        return this.generations.list(accountId);
    }

    async get(accountId: string, id: string): Promise<GenerationRecord | undefined> {
        return this.generations.get(accountId, id);
    }

    async cancel(accountId: string, id: string): Promise<boolean> {
        return this.generations.cancel(accountId, id);
    }
}

function hashInput(input: CreateGenerationInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
