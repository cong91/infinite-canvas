import { ArgumentMetadata, PipeTransform } from "@nestjs/common";
import { z } from "zod";
import { HttpError } from "./errors.js";

export class ZodValidationPipe<T extends z.ZodTypeAny> implements PipeTransform {
    constructor(private readonly schema: T) {}

    transform(value: unknown, _metadata: ArgumentMetadata): z.output<T> {
        const result = this.schema.safeParse(value);
        if (!result.success) throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid");
        return result.data;
    }
}
