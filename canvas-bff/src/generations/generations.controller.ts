import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CanvasSessionGuard } from "../auth/auth.guard.js";
import type { CanvasAccount } from "../auth/session-service.js";
import { CurrentAccount, RequestId } from "../http/request-context.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { HttpError } from "../http/errors.js";
import { GenerationsService } from "./generations.service.js";

const generationBody = z.object({ projectId: z.string().trim().min(1), providerId: z.string().trim().min(1), kind: z.enum(["image", "video", "audio", "text"]), input: z.record(z.unknown()).default({}), clientRequestId: z.string().trim().min(1).max(200) });

@Controller("api/v1/generations")
@UseGuards(CanvasSessionGuard)
export class GenerationsController {
    constructor(@Inject(GenerationsService) private readonly generations: GenerationsService) {}

    @Get()
    async list(@CurrentAccount() account: CanvasAccount, @RequestId() requestId: string) { return { data: await this.generations.list(account), requestId }; }
    @Post()
    async create(@CurrentAccount() account: CanvasAccount, @Body(new ZodValidationPipe(generationBody)) body: z.output<typeof generationBody>, @RequestId() requestId: string) { return { data: await this.generations.create(account, body), requestId }; }
    @Get(":generationId")
    async get(@CurrentAccount() account: CanvasAccount, @Param("generationId") id: string, @RequestId() requestId: string) { const data = await this.generations.get(account, id); if (!data) throw new HttpError(404, "GENERATION_NOT_FOUND", "Generation was not found"); return { data, requestId }; }
    @Post(":generationId/cancel")
    async cancel(@CurrentAccount() account: CanvasAccount, @Param("generationId") id: string, @RequestId() requestId: string) { const data = await this.generations.cancel(account, id); if (!data) throw new HttpError(404, "GENERATION_NOT_FOUND", "Generation was not found"); return { data, requestId }; }
}
