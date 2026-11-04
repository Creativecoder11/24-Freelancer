import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { ADMIN_AUD, ADMIN_COOKIE_PATH, ADMIN_SETUP_AUD, adminEnv } from './admin-env';
import { hashAdminToken, newOpaqueToken, signJwt, verifyJwt } from './admin-crypto';
import { PRIVILEGED_ROLES } from './permissions';

export interface AccessClaims {
  sub: string;
  sid: string;
  aud: string;
}

/**
 * Admin sessions (`admin_sessions`, NEW-09-04): one row per refresh rotation, grouped by
 * `family_id`. Access JWT `aud = 24f-admin`, 15 min, in memory on the client. Refresh cookie
 * `fl_admin_rt`, httpOnly, SameSite=Strict, Path=/api/v1/admin/auth (Doc 09 §22).
 */
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  get db() {
    return this.prisma.db;
  }

  signAccess(adminId: string, sessionId: string) {
    return signJwt({ sub: adminId, sid: sessionId, aud: ADMIN_AUD }, adminEnv().accessTtlSeconds);
  }

  /** Setup token: only the set-password and TOTP enrolment endpoints accept it. */
  signSetup(adminId: string, next: 'set_password' | 'enrol_totp') {
    return signJwt({ sub: adminId, next, aud: ADMIN_SETUP_AUD }, 30 * 60);
  }

  verifyAccess(token: string): AccessClaims {
    const p = verifyJwt<{ sub: string; sid: string; aud: string }>(token, ADMIN_AUD);
    if (p === 'expired') throw new ApiError('TOKEN_EXPIRED');
    if (!p || !p.sub || !p.sid) throw new ApiError('UNAUTHENTICATED');
    return p;
  }

  verifySetup(token: string | undefined) {
    if (!token) throw new ApiError('UNAUTHENTICATED');
    const p = verifyJwt<{ sub: string; next: string }>(token, ADMIN_SETUP_AUD);
    if (p === 'expired') throw new ApiError('SESSION_EXPIRED');
    if (!p) throw new ApiError('UNAUTHENTICATED');
    return p;
  }

  async idleMinutesFor(adminId: string) {
    const roles = await this.db.adminUserRole.findMany({ where: { adminUserId: adminId }, include: { adminRole: { select: { code: true } } } });
    const env = adminEnv();
    return roles.some((r) => PRIVILEGED_ROLES.has(r.adminRole.code)) ? env.idleMinutesPrivileged : env.idleMinutes;
  }

  /** New sign-in. Caps concurrent families at ADMIN_MAX_SESSIONS (oldest revoked). */
  async create(adminId: string, ip: string | null, ua: string | null, opts: { reauth?: boolean } = {}) {
    const env = adminEnv();
    const live = await this.db.adminSession.findMany({
      where: { adminUserId: adminId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    const excess = live.length - (env.maxSessions - 1);
    for (const f of live.slice(0, Math.max(0, excess))) await this.revokeFamily(f.familyId, 'session_cap');
    const raw = newOpaqueToken();
    const familyId = (await this.db.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
    const now = new Date();
    const s = await this.db.adminSession.create({
      data: {
        adminUserId: adminId,
        refreshTokenHash: hashAdminToken(raw),
        familyId,
        ipAddress: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null,
        userAgent: ua?.slice(0, 512) ?? null,
        lastActiveAt: now,
        reauthAt: opts.reauth ? now : null,
        expiresAt: new Date(now.getTime() + env.maxHours * 3600_000),
      },
    });
    return { session: s, refreshToken: raw };
  }

  /** Rotates the refresh token. Reuse of a rotated token revokes the whole family. */
  async rotate(raw: string | undefined) {
    if (!raw) throw new ApiError('SESSION_EXPIRED');
    const s = await this.db.adminSession.findUnique({ where: { refreshTokenHash: hashAdminToken(raw) } });
    if (!s) throw new ApiError('SESSION_EXPIRED');
    if (s.revokedAt) {
      if (s.revokedReason === 'rotated') await this.revokeFamily(s.familyId, 'reuse_detected');
      throw new ApiError('SESSION_EXPIRED');
    }
    await this.assertAlive(s);
    const next = newOpaqueToken();
    const created = await this.db.$transaction(async (tx) => {
      await tx.adminSession.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedReason: 'rotated' } });
      return tx.adminSession.create({
        data: {
          adminUserId: s.adminUserId,
          refreshTokenHash: hashAdminToken(next),
          familyId: s.familyId,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          lastActiveAt: s.lastActiveAt,
          reauthAt: s.reauthAt,
          expiresAt: s.expiresAt,
        },
      });
    });
    await this.redis.client.set(`admin:rotated:${s.id}`, created.id, 'EX', 3600).catch(() => undefined);
    return { session: created, refreshToken: next };
  }

  /** Idle and absolute limits (Doc 09 §22.1). Revokes and throws SESSION_EXPIRED when past either. */
  async assertAlive(s: { id: string; familyId: string; adminUserId: string; lastActiveAt: Date; expiresAt: Date; revokedAt: Date | null }) {
    if (s.revokedAt) throw new ApiError('SESSION_EXPIRED');
    const now = Date.now();
    if (s.expiresAt.getTime() <= now) {
      await this.revokeFamily(s.familyId, 'absolute_timeout');
      throw new ApiError('SESSION_EXPIRED');
    }
    const idle = await this.idleMinutesFor(s.adminUserId);
    if (s.lastActiveAt.getTime() + idle * 60_000 <= now) {
      await this.revokeFamily(s.familyId, 'idle_timeout');
      throw new ApiError('SESSION_EXPIRED');
    }
  }

  async revokeFamily(familyId: string, reason: string) {
    const r = await this.db.adminSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    return r.count;
  }

  async revokeAllFor(adminId: string, reason: string) {
    const fams = await this.db.adminSession.findMany({ where: { adminUserId: adminId, revokedAt: null }, select: { familyId: true }, distinct: ['familyId'] });
    for (const f of fams) await this.revokeFamily(f.familyId, reason);
    return fams.length;
  }

  /** Records user activity (not background polls) at most every 15 s per family. */
  async touch(sessionId: string, familyId: string) {
    const ok = await this.redis.client.set(`admin:touch:${familyId}`, '1', 'EX', 15, 'NX').catch(() => 'OK');
    if (!ok) return;
    await this.db.adminSession.updateMany({ where: { familyId, revokedAt: null }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
    void sessionId;
  }

  setCookie(res: Response, raw: string, expiresAt: Date) {
    const env = adminEnv();
    res.cookie(env.cookieName, raw, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: ADMIN_COOKIE_PATH,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }

  clearCookie(res: Response) {
    const env = adminEnv();
    res.clearCookie(env.cookieName, { path: ADMIN_COOKIE_PATH, httpOnly: true, sameSite: 'strict', secure: env.cookieSecure });
  }
}
