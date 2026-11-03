import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ApiError } from './api-error';

/** Validates query/body with a shared zod schema; maps issues to VALIDATION_FAILED field errors. */
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const parsed = this.schema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fields[key] ??= []).push(issue.message);
    }
    throw new ApiError('VALIDATION_FAILED', undefined, fields);
  }
}
