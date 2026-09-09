import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CanvasSessionGuard } from "../auth/auth.guard.js";
import type { CanvasAccount } from "../auth/session-service.js";
import { CurrentAccount, RequestId } from "../http/request-context.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { AssetsService } from "./assets.service.js";

const assetBody = z.object({ projectId: z.string().trim().min(1).optional(), kind: z.enum(["image", "video", "audio", "file"]), objectKey: z.string().trim().max(500).optional(), providerUrl: z.string().url().max(2_000).optional(), metadata: z.record(z.unknown()).default({}) });

@Controller("api/v1/assets")
@UseGuards(CanvasSessionGuard)
export class AssetsController {
    constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}
    @Get()
    async list(@CurrentAccount() account: CanvasAccount, @Query("projectId") projectId: string | undefined, @RequestId() requestId: string) { return { data: await this.assets.list(account.id, projectId), requestId }; }
    @Post("import")
    async create(@CurrentAccount() account: CanvasAccount, @Body(new ZodValidationPipe(assetBody)) body: z.output<typeof assetBody>, @RequestId() requestId: string) { return { data: await this.assets.create(account.id, body), requestId }; }
    @Get(":assetId")
    async get(@CurrentAccount() account: CanvasAccount, @Param("assetId") id: string, @RequestId() requestId: string) { return { data: await this.assets.get(account.id, id), requestId }; }
    @Delete(":assetId")
    @HttpCode(204)
    async remove(@CurrentAccount() account: CanvasAccount, @Param("assetId") id: string) { await this.assets.remove(account.id, id); }
}

@Controller("api/v1/projects/:projectId/assets")
@UseGuards(CanvasSessionGuard)
export class ProjectAssetsController {
    constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}
    @Get()
    async list(@CurrentAccount() account: CanvasAccount, @Param("projectId") projectId: string, @RequestId() requestId: string) { return { data: await this.assets.list(account.id, projectId), requestId }; }
}
