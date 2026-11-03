import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';

/** Wraps handler results as { data, meta?, serverTime } (Doc 06 §1.6). Return `Paged` for meta. */
export class Paged<T> {
  constructor(
    public readonly data: T,
    public readonly meta: Record<string, unknown>,
  ) {}
}

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((result) => {
        const serverTime = new Date().toISOString();
        if (result instanceof Paged) return { data: result.data, meta: result.meta, serverTime };
        return { data: result ?? null, serverTime };
      }),
    );
  }
}
