import { CallHandler, CanActivate, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { tap } from 'rxjs';
import { ApiError } from '../../../common/api-error';
import { AdminSessionService } from './admin-session.service';
import { AuditService } from './audit.service';
import { buildCtx, PERMS_KEY, REAUTH_KEY, type AdminRequest } from './admin-context';
import { adminEnv } from './admin-env';
import { hasPerm } from './permissions';

function ipAllowed(ip: string | undefined, list: string[]): boolean {
  if (!list.length) return true;
  const addr = (ip ?? '').replace(/^::ffff:/, '');
  const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  for (const entry of list) {
    const [net, bitsRaw] = entry.split('/');
    if (!net) continue;
    if (!bitsRaw) {
      if (net === addr) return true;
      continue;
    }
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr) || !/^\d+\.\d+\.\d+\.\d+$/.test(net)) continue;
    const bits = Number(bitsRaw);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((toInt(addr) & mask) === (toInt(net) & mask)) return true;
  }
  return false;
}

/**
 * AdminRoleGuard (Doc 09 §2.2, §4, §22): IP allow-list, admin bearer (aud 24f-admin), live
 * session with idle and absolute limits, admin status, permission keys from `@Perms`, and
 * TOTP re-auth from `@Reauth`. Every 403 writes `admin.forbidden`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const env = adminEnv();
    if (!ipAllowed(req.ip, env.ipAllowlist)) {
      await this.audit.safe(null, { action: 'admin.ip_blocked', entityType: 'route', after: { route: req.path, ip: req.ip } });
      throw new ApiError('ADMIN_FORBIDDEN');
    }
    const m = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
    if (!m) throw new ApiError('UNAUTHENTICATED');
    const claims = this.sessions.verifyAccess(m[1]!.trim());
    const db = this.sessions.db;
    const row = await db.adminSession.findUnique({ where: { id: claims.sid } });
    if (!row || row.adminUserId !== claims.sub) throw new ApiError('SESSION_EXPIRED');
    const live = row.revokedAt ? await db.adminSession.findFirst({ where: { familyId: row.familyId, revokedAt: null }, orderBy: { createdAt: 'desc' } }) : row;
    if (!live) throw new ApiError('SESSION_EXPIRED');
    await this.sessions.assertAlive(live);

    const admin = await db.adminUser.findUnique({
      where: { id: claims.sub },
      include: { adminUserRolesByAdminUser: { include: { adminRole: { select: { code: true, permissions: true } } } } },
    });
    if (!admin || admin.status !== 'active') {
      await this.sessions.revokeFamily(live.familyId, 'disabled');
      throw new ApiError('SESSION_EXPIRED');
    }
    const roles = admin.adminUserRolesByAdminUser.map((r) => r.adminRole.code);
    const perms = [...new Set(admin.adminUserRolesByAdminUser.flatMap((r) => r.adminRole.permissions))];
    const ctx = buildCtx(req, admin, roles, perms, live.id, live.reauthAt);
    req.admin = ctx;

    if (req.header('x-admin-background') !== '1') await this.sessions.touch(live.id, live.familyId);

    const need = this.reflector.getAllAndOverride<string[] | undefined>(PERMS_KEY, [context.getHandler(), context.getClass()]);
    if (need && need.length && !need.some((k) => hasPerm(perms, k))) {
      await this.audit.safe(ctx, { action: 'admin.forbidden', entityType: 'route', after: { route: `${req.method} ${req.route?.path ?? req.path}`, required: need } });
      ctx.audited = true;
      throw new ApiError('ADMIN_FORBIDDEN');
    }
    const reauth = this.reflector.getAllAndOverride<boolean | undefined>(REAUTH_KEY, [context.getHandler(), context.getClass()]);
    if (reauth && (env.totpRequired || ctx.totpEnrolled)) {
      const fresh = live.reauthAt && live.reauthAt.getTime() + env.reauthWindowMinutes * 60_000 > Date.now();
      if (!fresh) throw new ApiError('ADMIN_REAUTH_REQUIRED');
    }
    return true;
  }
}

/**
 * Audit safety net (Doc 09 §20.1): a successful non-GET admin call whose service forgot its
 * audit row gets a generic one.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    return next.handle().pipe(
      tap(() => {
        const ctx = req.admin;
        if (!ctx || req.method === 'GET' || ctx.audited) return;
        void this.audit.safe(ctx, {
          action: `admin.${req.method.toLowerCase()}`,
          entityType: 'route',
          entityRef: (req.params?.ref ?? req.params?.publicId ?? req.params?.key ?? null) as string | null,
          after: { route: req.route?.path ?? req.path, params: req.params },
        });
      }),
    );
  }
}
