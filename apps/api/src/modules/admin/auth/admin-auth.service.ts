import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { passwordProblems } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { getEnv } from '../../../config/env';
import { AdminSessionService } from '../core/admin-session.service';
import { AuditService } from '../core/audit.service';
import { adminEnv } from '../core/admin-env';
import { decryptPii, encryptPii, hashAdminToken } from '../core/admin-crypto';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../core/totp';
import { expandPerms, ROLE_LABEL } from '../core/permissions';
import type { AdminCtx } from '../core/admin-context';

const argonOpts = () => {
  const env = getEnv();
  return { type: argon2.argon2id, memoryCost: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM };
};

export const hashAdminPassword = (pw: string) => argon2.hash(pw, argonOpts());

/** Admin sign-in, setup, refresh, re-auth (Doc 06 §6.1, Doc 09 SCR-ADM-01, §22). */
@Injectable()
export class AdminAuthService {
  private dummy: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async verifyPw(hash: string | null, pw: string) {
    if (!hash) {
      this.dummy ??= hashAdminPassword('dummy-admin-password-0!');
      await argon2.verify(await this.dummy, pw).catch(() => false);
      return false;
    }
    return argon2.verify(hash, pw).catch(() => false);
  }

  private async rolesOf(adminId: string) {
    const rows = await this.db.adminUserRole.findMany({ where: { adminUserId: adminId }, include: { adminRole: true } });
    return { roles: rows.map((r) => r.adminRole.code), perms: [...new Set(rows.flatMap((r) => r.adminRole.permissions))] };
  }

  /** Accepts a TOTP code once per time step (Doc 06 §6.1 reauth rule). */
  private async checkTotp(adminId: string, secretEnc: Uint8Array | null, code: string | undefined): Promise<boolean> {
    const secret = decryptPii(secretEnc);
    if (!secret || !code) return false;
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    const fresh = await this.redis.client.set(`admin:totp_used:${adminId}:${step}`, '1', 'EX', 120, 'NX').catch(() => 'OK');
    return !!fresh;
  }

  async login(body: { email?: string; password?: string; totp_code?: string }, req: Request, res: Response) {
    const env = adminEnv();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fields: Record<string, string[]> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = ['Enter a valid email.'];
    if (!password || password.length > 128) fields.password = ['Enter your password.'];
    if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', undefined, fields);

    const rlKey = `rl:admin_login:${req.ip}:${email}`;
    // 5 failed attempts per 15 minutes per IP + email (Doc 06 §6.1); successful sign-ins don't count.
    const failures = Number((await this.redis.client.get(rlKey).catch(() => null)) ?? 0);
    if (failures >= env.loginPer15Min) throw new ApiError('TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in 15 minutes.', undefined, { retry_after_seconds: Math.max(1, await this.redis.client.ttl(rlKey).catch(() => 900)) });

    const admin = await this.db.adminUser.findUnique({ where: { email } });
    const fail = async (reason: string) => {
      await this.redis.hit(rlKey, 15 * 60).catch(() => undefined);
      await this.audit.safe(null, { action: 'admin.login_failed', entityType: 'admin_user', entityId: admin?.id ?? null, actorType: 'system', after: { email, ip: req.ip, reason } });
    };
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      await fail('locked');
      throw new ApiError('TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in 15 minutes.');
    }
    const ok = await this.verifyPw(admin?.passwordHash ?? null, password);
    if (!admin || !ok) {
      if (admin) {
        const n = admin.failedLoginCount + 1;
        const lock = n >= 5;
        await this.db.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: lock ? 0 : n, lockedUntil: lock ? new Date(Date.now() + 15 * 60_000) : admin.lockedUntil } });
        if (lock) await this.audit.safe(null, { action: 'admin.locked', entityType: 'admin_user', entityId: admin.id, actorType: 'system', after: { locked_minutes: 15 } });
      }
      await fail('invalid_credentials');
      throw new ApiError('INVALID_CREDENTIALS', "That email or password isn't right.");
    }
    if (admin.status !== 'active') {
      await fail('disabled');
      throw new ApiError('ACCOUNT_SUSPENDED', 'This admin account is disabled. Contact a super admin.');
    }

    // Setup still unfinished → setup token only.
    if (admin.mustChangePassword) {
      await this.db.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: 0 } });
      return { access_token: this.sessions.signSetup(admin.id, 'set_password'), expires_in: 1800, admin: this.adminDto(admin, []), next: 'set_password' as const };
    }
    const enrolled = !!admin.totpEnrolledAt && !!admin.totpSecretEnc;
    if (!enrolled && env.totpRequired) {
      await this.db.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: 0 } });
      return { access_token: this.sessions.signSetup(admin.id, 'enrol_totp'), expires_in: 1800, admin: this.adminDto(admin, []), next: 'enrol_totp' as const };
    }
    if (enrolled) {
      if (!body.totp_code) throw new ApiError('ADMIN_TOTP_REQUIRED');
      if (!(await this.checkTotp(admin.id, admin.totpSecretEnc, body.totp_code))) {
        await fail('totp_invalid');
        throw new ApiError('ADMIN_TOTP_INVALID', "That code isn't right. Check your authenticator app.", { totp_code: ["That code isn't right. Check your authenticator app."] });
      }
    }
    return this.startSession(admin.id, req, res, enrolled);
  }

  private async startSession(adminId: string, req: Request, res: Response, reauth: boolean) {
    const { session, refreshToken } = await this.sessions.create(adminId, req.ip ?? null, req.header('user-agent') ?? null, { reauth });
    const admin = await this.db.adminUser.update({ where: { id: adminId }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    this.sessions.setCookie(res, refreshToken, session.expiresAt);
    const { roles } = await this.rolesOf(adminId);
    await this.audit.safe(null, { action: 'admin.login', entityType: 'admin_user', entityId: adminId, actorType: 'admin', actorAdminId: adminId, after: { ip: req.ip } });
    return { access_token: this.sessions.signAccess(adminId, session.id), expires_in: adminEnv().accessTtlSeconds, admin: this.adminDto(admin, roles), next: null };
  }

  private adminDto(a: { id: string; fullName: string; email: string }, roles: string[]) {
    return { id: a.id, full_name: a.fullName, email: a.email, roles };
  }

  async refresh(req: Request, res: Response) {
    const raw = req.cookies?.[adminEnv().cookieName] as string | undefined;
    try {
      const { session, refreshToken } = await this.sessions.rotate(raw);
      const admin = await this.db.adminUser.findUnique({ where: { id: session.adminUserId } });
      if (!admin || admin.status !== 'active') {
        await this.sessions.revokeFamily(session.familyId, 'disabled');
        throw new ApiError('SESSION_EXPIRED');
      }
      this.sessions.setCookie(res, refreshToken, session.expiresAt);
      return { access_token: this.sessions.signAccess(admin.id, session.id), expires_in: adminEnv().accessTtlSeconds };
    } catch (e) {
      this.sessions.clearCookie(res);
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED' && raw) {
        const s = await this.db.adminSession.findUnique({ where: { refreshTokenHash: hashAdminToken(raw) } }).catch(() => null);
        if (s) await this.audit.safe(null, { action: 'admin.session_expired', entityType: 'admin_session', entityId: s.id, actorType: 'system', after: { reason: s.revokedReason } });
      }
      throw e;
    }
  }

  async logout(req: Request, res: Response, ctx: AdminCtx | null) {
    const raw = req.cookies?.[adminEnv().cookieName] as string | undefined;
    if (raw) {
      const s = await this.db.adminSession.findUnique({ where: { refreshTokenHash: hashAdminToken(raw) } });
      if (s) {
        await this.sessions.revokeFamily(s.familyId, 'logout');
        await this.audit.safe(ctx, { action: 'admin.logout', entityType: 'admin_user', entityId: s.adminUserId, actorType: 'admin', actorAdminId: s.adminUserId });
      }
    }
    this.sessions.clearCookie(res);
    return { signed_out: true };
  }

  /** Set password from a setup token or a one-time invite/reset link (24 h). */
  async setPassword(body: { token?: string; new_password?: string }, setupToken: string | undefined) {
    let adminId: string | null = null;
    let linkKey: string | null = null;
    if (body.token) {
      linkKey = `admin:pwlink:${body.token}`;
      adminId = await this.redis.client.get(linkKey);
      if (!adminId) throw new ApiError('RESET_TOKEN_EXPIRED', 'This link has expired. Ask a super admin to send a new one.');
    } else {
      const p = this.sessions.verifySetup(setupToken);
      adminId = p.sub;
    }
    const pw = String(body.new_password ?? '');
    if (pw.length < 12 || passwordProblems(pw).length) {
      throw new ApiError('VALIDATION_FAILED', undefined, { new_password: ['Use at least 12 characters with upper and lower case letters, a number and a symbol.'] });
    }
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (await this.verifyPw(admin.passwordHash, pw)) throw new ApiError('PASSWORD_REUSED', undefined, { new_password: ["Choose a password you haven't used for this account."] });
    await this.db.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashAdminPassword(pw), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } });
    if (linkKey) await this.redis.client.del(linkKey);
    await this.audit.safe(null, { action: 'admin.password_set', entityType: 'admin_user', entityId: admin.id, actorType: 'admin', actorAdminId: admin.id });
    const enrolled = !!admin.totpEnrolledAt && !!admin.totpSecretEnc;
    const next = !enrolled && adminEnv().totpRequired ? 'enrol_totp' : null;
    return { next, setup_token: next ? this.sessions.signSetup(admin.id, 'enrol_totp') : null };
  }

  async totpEnrol(setupToken: string | undefined) {
    const p = this.sessions.verifySetup(setupToken);
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: p.sub } });
    if (admin.totpEnrolledAt && admin.totpSecretEnc) throw new ApiError('INVALID_STATE', 'Your authenticator is already set up.');
    const secret = newTotpSecret();
    await this.db.adminUser.update({ where: { id: admin.id }, data: { totpSecretEnc: encryptPii(secret), totpEnrolledAt: null } });
    return { otpauth_url: otpauthUrl(secret, admin.email), secret };
  }

  async totpConfirm(setupToken: string | undefined, code: string | undefined, req: Request, res: Response) {
    const p = this.sessions.verifySetup(setupToken);
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: p.sub } });
    if (!(await this.checkTotp(admin.id, admin.totpSecretEnc, code))) {
      throw new ApiError('ADMIN_TOTP_INVALID', "That code isn't right. Check your authenticator app.", { totp_code: ["That code isn't right. Check your authenticator app."] });
    }
    await this.db.adminUser.update({ where: { id: admin.id }, data: { totpEnrolledAt: new Date() } });
    await this.audit.safe(null, { action: 'admin.totp_enrolled', entityType: 'admin_user', entityId: admin.id, actorType: 'admin', actorAdminId: admin.id });
    return this.startSession(admin.id, req, res, true);
  }

  /** Re-auth for sensitive actions (NEW-09-02). With TOTP not enrolled and not required, it is a no-op. */
  async reauth(ctx: AdminCtx, code: string | undefined) {
    const env = adminEnv();
    const admin = await this.db.adminUser.findUniqueOrThrow({ where: { id: ctx.id } });
    const enrolled = !!admin.totpEnrolledAt && !!admin.totpSecretEnc;
    if (enrolled || env.totpRequired) {
      const failKey = `admin:reauth_fail:${ctx.id}`;
      if (!(await this.checkTotp(admin.id, admin.totpSecretEnc, code))) {
        const { count } = await this.redis.hit(failKey, 15 * 60).catch(() => ({ count: 0, ttl: 0 }));
        await this.audit.safe(ctx, { action: 'admin.reauth_failed', entityType: 'admin_session', entityId: ctx.sessionId });
        if (count >= 5) {
          const s = await this.db.adminSession.findUnique({ where: { id: ctx.sessionId } });
          if (s) await this.sessions.revokeFamily(s.familyId, 'reauth_failed');
          throw new ApiError('SESSION_EXPIRED');
        }
        throw new ApiError('ADMIN_TOTP_INVALID', "That code isn't right. Check your authenticator app.", { totp_code: ["That code isn't right. Check your authenticator app."] });
      }
      await this.redis.client.del(failKey).catch(() => undefined);
    }
    const s = await this.db.adminSession.findUniqueOrThrow({ where: { id: ctx.sessionId } });
    const now = new Date();
    await this.db.adminSession.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { reauthAt: now } });
    await this.audit.safe(ctx, { action: 'admin.reauth', entityType: 'admin_session', entityId: ctx.sessionId });
    return {
      access_token: this.sessions.signAccess(ctx.id, ctx.sessionId),
      expires_in: env.accessTtlSeconds,
      reauth_valid_until: new Date(now.getTime() + env.reauthWindowMinutes * 60_000).toISOString(),
    };
  }

  async me(ctx: AdminCtx) {
    const env = adminEnv();
    const s = await this.db.adminSession.findUnique({ where: { id: ctx.sessionId } });
    const idle = await this.sessions.idleMinutesFor(ctx.id);
    return {
      id: ctx.id,
      full_name: ctx.fullName,
      email: ctx.email,
      roles: ctx.roles,
      role_labels: ctx.roles.map((r) => ROLE_LABEL[r] ?? r),
      permissions: expandPerms(ctx.perms),
      totp_enrolled: ctx.totpEnrolled,
      totp_required: env.totpRequired,
      reauth_needed: env.totpRequired || ctx.totpEnrolled,
      session: { idle_minutes: idle, last_active_at: s?.lastActiveAt.toISOString() ?? null, expires_at: s?.expiresAt.toISOString() ?? null },
      app_env: getEnv().APP_ENV,
    };
  }
}
