import { Module } from "@nestjs/common";

import { SecurityMiddleware } from "./security.middleware.js";

@Module({ providers: [SecurityMiddleware], exports: [SecurityMiddleware] })
export class HttpModule {}
