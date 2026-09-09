import { Inject, Injectable } from "@nestjs/common";

import { PROJECT_REPOSITORY } from "../app.tokens.js";
import { HttpError } from "../http/errors.js";
import type { ProjectRecord, ProjectRepository } from "./repository.js";

@Injectable()
export class ProjectsService {
    constructor(@Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository) {}

    list(accountId: string): Promise<ProjectRecord[]> { return Promise.resolve(this.projects.list(accountId)); }
    create(accountId: string, input: { name: string; data: Record<string, unknown> }): Promise<ProjectRecord> { return Promise.resolve(this.projects.create({ accountId, ...input })); }

    async get(accountId: string, id: string): Promise<ProjectRecord> {
        const project = await this.projects.get(accountId, id);
        if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        return project;
    }

    async update(accountId: string, id: string, patch: { name?: string; data?: Record<string, unknown>; revision?: number }): Promise<ProjectRecord> {
        if (!(await this.projects.get(accountId, id))) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        const project = await this.projects.update(accountId, id, patch);
        if (!project) throw new HttpError(409, "PROJECT_REVISION_CONFLICT", "Project was updated elsewhere");
        return project;
    }

    async remove(accountId: string, id: string): Promise<void> {
        if (!(await this.projects.delete(accountId, id))) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
    }
}
