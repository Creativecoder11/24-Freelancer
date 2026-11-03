import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorMessage, type ErrorCode } from '@24f/shared';
import { ApiError } from './api-error';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED' as ErrorCode,
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'INVALID_STATE',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Renders every error as { error: { code, message, fields?, details?, request_id }, serverTime }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    let status = 500;
    let body: Record<string, unknown>;
    if (exception instanceof ApiError) {
      status = exception.getStatus();
      const r = exception.getResponse() as { code: string; message: string };
      body = { code: r.code, message: r.message, fields: exception.fields, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = STATUS_CODE[status] ?? 'BAD_REQUEST';
      body = { code, message: errorMessage(code) };
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
      body = { code: 'INTERNAL_ERROR', message: errorMessage('INTERNAL_ERROR') };
    }
    res.status(status).json({ error: { ...body, request_id: req.id }, serverTime: new Date().toISOString() });
  }
}
