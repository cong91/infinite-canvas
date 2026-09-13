import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CanvasSessionToken, CurrentAccount, RequestId } from "../http/request-context.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import type { CanvasAccount } from "../auth/session-service.js";
import { CanvasSessionGuard } from "../auth/auth.guard.js";
import { providerBody, providerPatch, ProvidersService } from "./providers.service.js";

@Controller("api/v1/providers")
@UseGuards(CanvasSessionGuard)
export class ProvidersController {
    constructor(@Inject(ProvidersService) private readonly providers: ProvidersService) {}

    @Get("catalog")
    async catalog(@CanvasSessionToken() sessionToken: string | undefined, @RequestId() requestId: string) { return { data: await this.providers.catalogForSession(sessionToken), requestId }; }
    @Get()
    async list(@CurrentAccount() account: CanvasAccount, @RequestId() requestId: string) { return { data: await this.providers.list(account.id), requestId }; }
    @Get(":providerId")
    async get(@CurrentAccount() account: CanvasAccount, @Param("providerId") id: string, @RequestId() requestId: string) { return { data: await this.providers.get(account.id, id), requestId }; }
    @Get(":providerId/models")
    async models(@CurrentAccount() account: CanvasAccount, @Param("providerId") id: string, @RequestId() requestId: string) { return { data: await this.providers.models(account.id, id), requestId }; }
    @Post()
    async create(@CurrentAccount() account: CanvasAccount, @CanvasSessionToken() sessionToken: string | undefined, @Body(new ZodValidationPipe(providerBody)) body: z.output<typeof providerBody>, @RequestId() requestId: string) { return { data: await this.providers.create(account.id, sessionToken, body), requestId }; }
    @Patch(":providerId")
    async update(@CurrentAccount() account: CanvasAccount, @Param("providerId") id: string, @Body(new ZodValidationPipe(providerPatch)) body: z.output<typeof providerPatch>, @RequestId() requestId: string) { return { data: await this.providers.update(account.id, id, body), requestId }; }
    @Delete(":providerId")
    @HttpCode(204)
    async remove(@CurrentAccount() account: CanvasAccount, @Param("providerId") id: string) { await this.providers.remove(account.id, id); }
}
