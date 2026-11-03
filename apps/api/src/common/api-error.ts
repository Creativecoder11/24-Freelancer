import { HttpException } from '@nestjs/common';
import { errorMessage, errorStatus, type ErrorCode } from '@24f/shared';

/** Throw this everywhere: it renders as the Doc 06 §4 envelope. */
export class ApiError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly fields?: Record<string, string[]>,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message: message ?? errorMessage(code) }, errorStatus(code) ?? 400);
  }
}
