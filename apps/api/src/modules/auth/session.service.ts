import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { COOKIE_NAMES } from '@24f/shared';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SettingsService } from '../settings/settings.service';
import { ApiError } from '../../common/api-error';
import { accessSecret, hashDeviceId, hashRefreshToken, newDeviceId, newRefreshToken } from './auth.crypto';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  deviceId: string;
  /** True when the device cookie was just minted for this request. */
  deviceIsNew: boolean;
}

export interface AccessClaims {
  sub: string;
  sid: string;
}

const REFRESH_PATH = '/api/v1/auth';
const REVOKED_SID_TTL = 15 * 60;

/** Parses "Chrome on Windows" style labels from a user agent. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//.test(ua)
              ? 'curl'
              : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Access tokens, refresh rotation with reuse detection, cookies and devices (Doc 04 §3.7, §3.8). */
@Injectable()
export class SessionService {
  private readonly jwt = new JwtService({});

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  // ----- request context and cookies -----

  context(req: Request, res: Response): RequestContext {
    const env = getEnv();
    let did = (req.cookies?.[COOKIE_NAMES.device] as string | undefined) ?? '';
    let deviceIsNew = false;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(did)) {
      did = newDeviceId();
      deviceIsNew = true;
      res.cookie(COOKIE_NAMES.device, did, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 86400_000,
      });
    }
    const ua = req.header('user-agent') ?? null;
    return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, 512) : null, deviceId: did, deviceIsNew };
  }

  setAuthCookies(res: Response, refreshToken: string, keepSignedIn: boolean, expiresAt: Date) {
    const env = getEnv();
    const maxAge = keepSignedIn ? Math.max(0, expiresAt.getTime() - Date.now()) : undefined;
    res.cookie(env.REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'strict',
      path: REFRESH_PATH,
      ...(maxAge !== undefined ? { maxAge } : {}),
    });
    res.cookie(env.SESSION_HINT_COOKIE_NAME, '1', {
      httpOnly: false,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      ...(env.SESSION_HINT_COOKIE_DOMAIN ? { domain: env.SESSION_HINT_COOKIE_DOMAIN } : {}),
      ...(maxAge !== undefined ? { maxAge } : {}),
    });
  }

  clearAuthCookies(res: Response) {
    const env = getEnv();
    res.clearCookie(env.REFRESH_COOKIE_NAME, { path: REFRESH_PATH, httpOnly: true, sameSite: 'strict', secure: env.COOKIE_SECURE });
    res.clearCookie(env.SESSION_HINT_COOKIE_NAME, {
      path: '/',
      ...(env.SESSION_HINT_COOKIE_DOMAIN ? { domain: env.SESSION_HINT_COOKIE_DOMAIN } : {}),
    });
  }

  // ----- tokens -----

  accessTtl() {
    return getEnv().JWT_ACCESS_TTL;
  }

  signAccess(userId: string, sessionId: string) {
    const env = getEnv();
    return this.jwt.sign({ sid: sessionId } satisfies Partial<AccessClaims>, {
      secret: accessSecret(),
      algorithm: 'HS256',
      subject: userId,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: env.JWT_ACCESS_TTL,
    });
  }

  /** Throws TOKEN_EXPIRED / UNAUTHENTICATED. */
  verifyAccess(token: string): AccessClaims {
    const env = getEnv();
    try {
      const p = this.jwt.verify<{ sub: string; sid: string }>(token, {
        secret: accessSecret(),
        algorithms: ['HS256'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });
      if (!p.sub || !p.sid) throw new ApiError('UNAUTHENTICATED');
      return { sub: p.sub, sid: p.sid };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error).name === 'TokenExpiredError') throw new ApiError('TOKEN_EXPIRED');
      throw new ApiError('UNAUTHENTICATED');
    }
  }

  /** Short-lived purpose tokens (reset token, login ticket). */
  signPurpose(aud: string, sub: string, claims: Record<string, unknown>, ttlSeconds: number) {
    return this.jwt.sign(claims, { secret: accessSecret(), algorithm: 'HS256', subject: sub, audience: aud, issuer: getEnv().JWT_ISSUER, expiresIn: ttlSeconds });
  }
  verifyPurpose<T extends object>(aud: string, token: string): (T & { sub: string }) | null {
    try {
      return this.jwt.verify<T & { sub: string }>(token, { secret: accessSecret(), algorithms: ['HS256'], audience: aud, issuer: getEnv().JWT_ISSUER });
    } catch {
      return null;
    }
  }

  private async ttlSeconds(keep: boolean) {
    const env = getEnv();
    if (keep) return env.JWT_REFRESH_TTL_REMEMBER;
    const hours = await this.settings.number('refresh_ttl_hours_session', env.JWT_REFRESH_TTL_SESSION / 3600);
    return Math.round(hours * 3600);
  }

  // ----- sessions -----

  /** New login: new family, cap of SESSION_MAX_PER_USER families. */
  async create(userId: string, keepSignedIn: boolean, ctx: RequestContext) {
    const raw = newRefreshToken();
    const expiresAt = new Date(Date.now() + (await this.ttlSeconds(keepSignedIn)) * 1000);
    const session = await this.prisma.db.authSession.create({
      data: {
        userId,
        refreshTokenHash: hashRefreshToken(raw),
        familyId: randomUUID(),
        keepSignedIn,
        deviceLabel: deviceLabel(ctx.userAgent).slice(0, 120),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        expiresAt,
      },
    });
    await this.enforceCap(userId);
    await this.prisma.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    return { session, refreshToken: raw, accessToken: this.signAccess(userId, session.id), expiresIn: this.accessTtl() };
  }

  private async enforceCap(userId: string) {
    const max = getEnv().SESSION_MAX_PER_USER;
    const live = await this.prisma.db.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: { familyId: true },
    });
    const families = [...new Set(live.map((s) => s.familyId))];
    for (const fam of families.slice(max)) await this.revokeFamily(fam, 'session_cap');
  }

  /** POST /auth/refresh with rotation and reuse detection. */
  async rotate(rawToken: string | undefined) {
    if (!rawToken) throw new ApiError('SESSION_EXPIRED');
    const hash = hashRefreshToken(rawToken);
    const row = await this.prisma.db.authSession.findUnique({ where: { refreshTokenHash: hash } });
    if (!row) throw new ApiError('SESSION_EXPIRED');

    if (row.revokedAt) {
      if (row.revokedReason === 'rotated' && Date.now() - row.revokedAt.getTime() <= 10_000) {
        throw new ApiError('REFRESH_RACE'); // parallel tabs: retry picks up the new cookie
      }
      if (row.revokedReason === 'rotated') {
        await this.revokeFamily(row.familyId, 'reuse_detected');
        // Security notification (FR-AUTH-010) is sent by the notifications module when it lands.
      }
      throw new ApiError('SESSION_EXPIRED');
    }
    if (row.expiresAt.getTime() < Date.now()) throw new ApiError('SESSION_EXPIRED');

    const user = await this.prisma.db.user.findUnique({ where: { id: row.userId }, select: { id: true, status: true } });
    if (!user) throw new ApiError('SESSION_EXPIRED');
    if (user.status === 'suspended' || user.status === 'closed') {
      await this.revokeAll(user.id, `status_${user.status}`);
      throw new ApiError(user.status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_CLOSED');
    }

    const next = newRefreshToken();
    const expiresAt = new Date(Date.now() + (await this.ttlSeconds(row.keepSignedIn)) * 1000);
    const created = await this.prisma.db.$transaction(async (t) => {
      const revoked = await t.authSession.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'rotated', updatedAt: new Date() },
      });
      if (revoked.count !== 1) throw new ApiError('REFRESH_RACE');
      return t.authSession.create({
        data: {
          userId: row.userId,
          refreshTokenHash: hashRefreshToken(next),
          familyId: row.familyId,
          keepSignedIn: row.keepSignedIn,
          deviceLabel: row.deviceLabel,
          userAgent: row.userAgent,
          ipAddress: row.ipAddress,
          city: row.city,
          lastActiveAt: new Date(),
          expiresAt,
          createdAt: row.createdAt,
        },
      });
    });
    return { session: created, refreshToken: next, accessToken: this.signAccess(row.userId, created.id), expiresIn: this.accessTtl() };
  }

  async findByRefresh(raw: string | undefined) {
    if (!raw) return null;
    return this.prisma.db.authSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(raw) } });
  }

  async get(sessionId: string) {
    return this.prisma.db.authSession.findUnique({ where: { id: sessionId } });
  }

  /** Revokes every row of a family and deny-lists their session IDs for 15 minutes. */
  async revokeFamily(familyId: string, reason: string) {
    const rows = await this.prisma.db.authSession.findMany({ where: { familyId }, select: { id: true } });
    await this.prisma.db.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() },
    });
    await this.denyList(rows.map((r) => r.id));
    return rows.length;
  }

  async revokeAll(userId: string, reason: string, exceptFamilyId?: string) {
    const fams = await this.prisma.db.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    for (const f of fams) await this.revokeFamily(f.familyId, reason);
    return fams.length;
  }

  private async denyList(ids: string[]) {
    if (!ids.length) return;
    const m = this.redis.client.multi();
    for (const id of ids) m.set(`revoked_sid:${id}`, '1', 'EX', REVOKED_SID_TTL);
    await m.exec().catch(() => undefined);
  }

  async isDenied(sid: string) {
    try {
      return (await this.redis.client.exists(`revoked_sid:${sid}`)) === 1;
    } catch {
      const s = await this.get(sid);
      return !s || (!!s.revokedAt && s.revokedReason !== 'rotated');
    }
  }

  async touch(sessionId: string) {
    const key = `session:touch:${sessionId}`;
    if (await this.redis.client.set(key, '1', 'EX', 60, 'NX')) {
      await this.prisma.db.authSession.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
    }
  }

  // ----- devices -----

  async isTrusted(userId: string, deviceId: string) {
    const row = await this.prisma.db.trustedDevice.findUnique({
      where: { userId_deviceHash: { userId, deviceHash: hashDeviceId(deviceId) } },
    });
    return !!row && row.trustedUntil.getTime() > Date.now();
  }

  async knownDevice(userId: string, deviceId: string) {
    const row = await this.prisma.db.trustedDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash: hashDeviceId(deviceId) } } });
    return !!row;
  }

  /** `trust` = true: trusted for trusted_device_days. false: recorded but not trusted. */
  async recordDevice(userId: string, ctx: RequestContext, trust: boolean) {
    const days = await this.settings.number('trusted_device_days', 180);
    const deviceHash = hashDeviceId(ctx.deviceId);
    const now = new Date();
    const until = trust ? new Date(now.getTime() + days * 86400_000) : now;
    const existing = await this.prisma.db.trustedDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash } } });
    if (existing) {
      await this.prisma.db.trustedDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, lastIp: ctx.ip, updatedAt: now, trustedUntil: trust ? until : existing.trustedUntil },
      });
    } else {
      await this.prisma.db.trustedDevice.create({ data: { userId, deviceHash, trustedUntil: until, lastIp: ctx.ip } });
    }
  }

  async forgetOtherDevices(userId: string, ctx: RequestContext) {
    await this.prisma.db.trustedDevice.deleteMany({ where: { userId, deviceHash: { not: hashDeviceId(ctx.deviceId) } } });
  }
}
