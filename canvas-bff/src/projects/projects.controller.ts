import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CurrentAccount, RequestId } from "../http/request-context.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import type { CanvasAccount } from "../auth/session-service.js";
import { CanvasSessionGuard } from "../auth/auth.guard.js";
import { ProjectsService } from "./projects.service.js";

const projectBody = z.object({ name: z.string().trim().min(1).max(200), data: z.record(z.unknown()).default({}) });
const projectPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), data: z.record(z.unknown()).optional(), revision: z.number().int().positive().optional() });

@Controller("api/v1/projects")
@UseGuards(CanvasSessionGuard)
export class ProjectsController {
    constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

    @Get()
    async list(@CurrentAccount() account: CanvasAccount, @RequestId() requestId: string) { return { data: (await this.projects.list(account.id)).map(toPublic), requestId }; }

    @Post()
    async create(@CurrentAccount() account: CanvasAccount, @Body(new ZodValidationPipe(projectBody)) body: z.output<typeof projectBody>, @RequestId() requestId: string) {
        return { data: toPublic(await this.projects.create(account.id, body)), requestId };
    }

    @Get(":projectId")
    async get(@CurrentAccount() account: CanvasAccount, @Param("projectId") id: string, @RequestId() requestId: string) { return { data: toPublic(await this.projects.get(account.id, id)), requestId }; }

    @Patch(":projectId")
    async update(@CurrentAccount() account: CanvasAccount, @Param("projectId") id: string, @Body(new ZodValidationPipe(projectPatch)) body: z.output<typeof projectPatch>, @RequestId() requestId: string) {
        return { data: toPublic(await this.projects.update(account.id, id, body)), requestId };
    }

    @Delete(":projectId")
    @HttpCode(204)
    async remove(@CurrentAccount() account: CanvasAccount, @Param("projectId") id: string) { await this.projects.remove(account.id, id); }
}

function toPublic(project: { id: string; name: string; data: Record<string, unknown>; revision: number; createdAt: Date; updatedAt: Date }) {
    return { id: project.id, name: project.name, data: project.data, revision: project.revision, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() };
}
