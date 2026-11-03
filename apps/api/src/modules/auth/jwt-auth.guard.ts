import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { UserStatus } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { SessionService } from './session.service';

/** What `@CurrentUser()` returns. */
export interface AuthUser {
  id: string;
  sessionId: string;
  status: UserStatus;
}

export type AuthedRequest = Request & { user?: AuthUser };

const ALLOW_STATUS = 'auth:allowStatus';
/** Statuses allowed on a route. Default: active, restricted (Doc 04 §3.11). */
export const AllowStatus = (...statuses: UserStatus[]) => SetMetadata(ALLOW_STATUS, statuses);

/**
 * Bearer access-token guard (Doc 04 §3.11: JwtGuard + AccountStatusGuard). Apply with
 * `@UseGuards(JwtAuthGuard)` on controllers or handlers; `@CurrentUser()` then gives the caller.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.header('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) throw new ApiError('UNAUTHENTICATED');
    const claims = this.sessions.verifyAccess(m[1]!.trim());
    if (await this.sessions.isDenied(claims.sid)) throw new ApiError('SESSION_EXPIRED');

    const status = await this.status(claims.sub);
    if (!status) throw new ApiError('SESSION_EXPIRED');
    if (status === 'suspended' || status === 'closed') {
      await this.sessions.revokeAll(claims.sub, `status_${status}`);
      throw new ApiError(status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_CLOSED');
    }
    const allowed = this.reflector.getAllAndOverride<UserStatus[] | undefined>(ALLOW_STATUS, [ctx.getHandler(), ctx.getClass()]) ?? ['active', 'restricted'];
    if (!allowed.includes(status)) throw new ApiError('ACCOUNT_RESTRICTED');

    req.user = { id: claims.sub, sessionId: claims.sid, status };
    res.setHeader('Cache-Control', 'no-store');
    void this.sessions.touch(claims.sid);
    return true;
  }

  /** users.status through a 30 s Redis cache; falls back to the database. */
  private async status(userId: string): Promise<UserStatus | null> {
    const key = `user_status:${userId}`;
    try {
      const cached = await this.redis.client.get(key);
      if (cached) return cached as UserStatus;
    } catch {
      /* Redis down: read the database */
    }
    const u = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!u) return null;
    await this.redis.client.set(key, u.status, 'EX', 30).catch(() => undefined);
    return u.status as UserStatus;
  }
}

/** Deletes the cached status (call on any status change). */
export async function invalidateUserStatus(redis: RedisService, userId: string) {
  await redis.client.del(`user_status:${userId}`).catch(() => undefined);
}

/** `@CurrentUser()` → AuthUser; `@CurrentUser('id')` → the user UUID. */
export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new ApiError('UNAUTHENTICATED');
  return field ? user[field] : user;
});
