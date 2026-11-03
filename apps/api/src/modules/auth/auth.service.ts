import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma, type User } from '@prisma/client';
import {
  maskIdentifier,
  normaliseIdentifier,
  type AuthenticatedResponse,
  type LoginResponse,
  type OtpChallengeResponse,
  type PasswordResetTokenResponse,
  type RegisterBody,
} from '@24f/shared';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionService, type RequestContext } from './session.service';
import { EMPLOYER_WALLETS, ProfilesService, sessionUser, WORKER_WALLETS } from './profiles.service';
import { invalidateUserStatus } from './jwt-auth.guard';

/** Result the controller turns into a response plus cookies. */
export interface SignedIn {
  body: AuthenticatedResponse;
  refreshToken: string;
  keepSignedIn: boolean;
  expiresAt: Date;
}

const RESET_AUD = '24f-reset';
const IDENTIFIER_TAKEN_MSG = 'This is already registered. Sign in instead, or reset your password.';

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly profiles: ProfilesService,
  ) {}

  // ----- helpers -----

  private normalise(raw: string, field = 'identifier') {
    const id = normaliseIdentifier(raw);
    if (!id) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: ['Enter a valid email, or a mobile number like 01XXXXXXXXX.'] });
    return id;
  }

  private findByIdentifier(id: ReturnType<typeof normaliseIdentifier> & object) {
    return this.prisma.db.user.findFirst({ where: id.kind === 'email' ? { email: id.email } : { phoneE164: id.phone } });
  }

  /** RATE_LIMIT_AUTH_PER_15_MINUTES per IP + identifier (Doc 04 §3.12). */
  private async rateLimit(scope: string, ctx: RequestContext, identifier: string) {
    const env = getEnv();
    if (!env.RATE_LIMIT_ENABLED) return;
    const { count, ttl } = await this.redis.hit(`rl:${scope}:${ctx.ip ?? '-'}:${identifier}`, 15 * 60);
    if (count > env.RATE_LIMIT_AUTH_PER_15_MINUTES) {
      throw new ApiError('RATE_LIMITED', 'Too many requests. Try again in a few minutes.', undefined, { retry_after_seconds: ttl });
    }
  }

  private async signIn(user: User, keepSignedIn: boolean, ctx: RequestContext): Promise<SignedIn> {
    const s = await this.sessions.create(user.id, keepSignedIn, ctx);
    const fresh = await this.prisma.db.user.findUniqueOrThrow({ where: { id: user.id } });
    return {
      body: { result: 'authenticated', access_token: s.accessToken, expires_in: s.expiresIn, user: sessionUser(fresh) },
      refreshToken: s.refreshToken,
      keepSignedIn,
      expiresAt: s.session.expiresAt,
    };
  }

  private async currentTermsVersion() {
    const p = await this.prisma.db.legalPage.findFirst({ where: { slug: 'terms', isCurrent: true }, select: { version: true } });
    return p?.version ?? '2026-01-01';
  }

  private async generateReferralCode(fullName: string) {
    const base = (fullName.split(/\s+/)[0] ?? '')
      .normalize('NFD')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 8);
    const stem = base.length >= 2 ? base : 'FL';
    for (let i = 0; i < 8; i++) {
      const code = `${stem}${randomInt(10, 100)}`.slice(0, 12);
      if (code.length >= 4 && !(await this.prisma.db.user.findFirst({ where: { referralCode: code }, select: { id: true } }))) return code;
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  }

  // ----- register -----

  async register(dto: RegisterBody, cookieRef: string | undefined, ctx: RequestContext): Promise<OtpChallengeResponse> {
    if (!getEnv().FEATURE_SIGNUPS) throw new ApiError('FEATURE_DISABLED');
    const id = this.normalise(dto.identifier);
    await this.rateLimit('register', ctx, id.value);
    if (await this.findByIdentifier(id)) throw new ApiError('IDENTIFIER_TAKEN', undefined, { identifier: [IDENTIFIER_TAKEN_MSG] });

    // BR-076: the code typed at sign-up wins over the fl_ref cookie.
    const cookieCode = cookieRef && /^[A-Za-z0-9]{4,12}$/.test(cookieRef) ? cookieRef.toUpperCase() : null;
    const refCode = dto.referral_code ?? cookieCode;
    const via = dto.referral_code ? 'code' : 'link'; // referrals.attributed_via: typed code vs /r/ link cookie
    const referralEnabled = await this.settings.get<boolean>('referral_enabled', true);
    const referrer =
      refCode && String(referralEnabled) !== 'false'
        ? await this.prisma.db.user.findFirst({ where: { referralCode: refCode }, select: { id: true, email: true, phoneE164: true, status: true } })
        : null;
    if (referrer && ((id.email && referrer.email?.toLowerCase() === id.email) || (id.phone && referrer.phoneE164 === id.phone))) {
      throw new ApiError('VALIDATION_FAILED', undefined, { referral_code: ["You can't use your own referral code."] });
    }

    const hash = await this.passwords.hash(dto.password);
    const termsVersion = await this.currentTermsVersion();
    const referralCode = await this.generateReferralCode(dto.full_name);

    let user: User | null = null;
    for (let attempt = 0; attempt < 6 && !user; attempt++) {
      const publicId = String(randomInt(100000, 1000000));
      try {
        user = await this.prisma.db.$transaction(async (t) => {
          const now = new Date();
          const u = await t.user.create({
            data: {
              publicId,
              fullName: dto.full_name,
              email: id.email,
              phoneE164: id.phone,
              passwordHash: hash,
              passwordChangedAt: now,
              countryCode: dto.country_code,
              signupRole: dto.signup_role,
              activeMode: dto.signup_role,
              defaultMode: dto.signup_role,
              termsAcceptedAt: now,
              termsVersion,
              signupIp: ctx.ip,
              referralCode,
            },
          });
          await t.passwordHistory.create({ data: { userId: u.id, passwordHash: hash } });
          await this.profiles.ensureWallets(u.id, [...WORKER_WALLETS, ...EMPLOYER_WALLETS], t);
          if (dto.signup_role === 'worker') await this.profiles.ensureWorkerProfile(u.id, t);
          else await this.profiles.ensureEmployerProfile(u.id, t);
          if (referrer && referrer.status !== 'closed') {
            await t.referral.create({ data: { referrerUserId: referrer.id, referredUserId: u.id, codeUsed: refCode!, attributedVia: via } });
          }
          return u;
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String((e.meta as { target?: unknown })?.target ?? '');
          if (/email|phone/.test(target)) throw new ApiError('IDENTIFIER_TAKEN', undefined, { identifier: [IDENTIFIER_TAKEN_MSG] });
          continue; // public_id or referral_code collision: retry
        }
        throw e;
      }
    }
    if (!user) throw new ApiError('INTERNAL_ERROR');

    const challenge = await this.otp.issue({ userId: user.id, purpose: 'signup', destination: id.value, ip: ctx.ip, meta: { keep_signed_in: true } });
    return OtpService.toResponse(challenge);
  }

  // ----- password login -----

  async login(dto: { identifier: string; password: string; keep_signed_in: boolean }, ctx: RequestContext): Promise<{ otp?: LoginResponse; signedIn?: SignedIn }> {
    const id = this.normalise(dto.identifier);
    await this.rateLimit('login', ctx, id.value);
    const user = await this.findByIdentifier(id);
    if (!user) {
      await this.passwords.burn(dto.password);
      throw new ApiError('INVALID_CREDENTIALS');
    }
    const [maxFails, lockMinutes] = await Promise.all([
      this.settings.number('login_max_failed_attempts', 5),
      this.settings.number('login_lock_minutes', 15),
    ]);
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.passwords.burn(dto.password);
      throw this.locked(user.lockedUntil);
    }
    if (user.lockedUntil && user.failedLoginCount >= maxFails) {
      await this.prisma.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      user.failedLoginCount = 0;
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      const fails = user.failedLoginCount + 1;
      const lockedUntil = fails >= maxFails ? new Date(Date.now() + lockMinutes * 60_000) : null;
      await this.prisma.db.user.update({ where: { id: user.id }, data: { failedLoginCount: fails, lockedUntil } });
      throw new ApiError('INVALID_CREDENTIALS');
    }
    if (user.status === 'closed') throw new ApiError('INVALID_CREDENTIALS');
    if (user.status === 'suspended') throw new ApiError('ACCOUNT_SUSPENDED', 'Your account is suspended. Contact support to appeal.');

    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      const h = await this.passwords.hash(dto.password);
      await this.prisma.db.user.update({ where: { id: user.id }, data: { passwordHash: h } });
    }

    // Unverified contact: send the sign-up code again (FR-AUTH-002).
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
      const c = await this.otp.issue({ userId: user.id, purpose: 'signup', destination: id.value, ip: ctx.ip, meta: { keep_signed_in: dto.keep_signed_in } });
      await this.prisma.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
      return { otp: { result: 'otp_required', ...OtpService.toResponse(c) } };
    }

    // Two-step on a new device (Doc 04 §3.9): no session until the code is verified.
    if (user.twoStepEnabled && !(await this.sessions.isTrusted(user.id, ctx.deviceId))) {
      const destination = user.phoneVerifiedAt && user.phoneE164 ? user.phoneE164 : user.email!;
      const c = await this.otp.issue({ userId: user.id, purpose: 'new_device', destination, ip: ctx.ip, meta: { keep_signed_in: dto.keep_signed_in } });
      await this.prisma.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
      return { otp: { result: 'otp_required', ...OtpService.toResponse(c) } };
    }

    const known = await this.sessions.knownDevice(user.id, ctx.deviceId);
    await this.sessions.recordDevice(user.id, ctx, false);
    if (!known) this.log.log(`new_device_sign_in for user ${user.publicId} (${ctx.userAgent ?? 'unknown agent'})`);
    return { signedIn: await this.signIn(user, dto.keep_signed_in, ctx) };
  }

  private locked(until: Date) {
    const secs = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    return new ApiError('TOO_MANY_ATTEMPTS', undefined, undefined, { retry_after_seconds: secs, locked_until: until.toISOString() });
  }

  // ----- one-time-code login and forgot password (no enumeration) -----

  async loginOtp(dto: { identifier: string; keep_signed_in: boolean }, ctx: RequestContext): Promise<OtpChallengeResponse> {
    const id = this.normalise(dto.identifier);
    await this.rateLimit('login_otp', ctx, id.value);
    const user = await this.findByIdentifier(id);
    const verified = user && (id.kind === 'email' ? !!user.emailVerifiedAt : !!user.phoneVerifiedAt);
    if (!user || !verified || (user.status !== 'active' && user.status !== 'restricted')) {
      const fake = await this.otp.issueFake('login', id.value, ctx.ip);
      return this.withoutChannel(fake);
    }
    const c = await this.otp.issue({ userId: user.id, purpose: 'login', destination: id.value, ip: ctx.ip, meta: { keep_signed_in: dto.keep_signed_in } });
    return this.withoutChannel(OtpService.toResponse(c));
  }

  async forgot(dto: { identifier: string }, ctx: RequestContext): Promise<OtpChallengeResponse> {
    const id = this.normalise(dto.identifier);
    await this.rateLimit('forgot', ctx, id.value);
    const user = await this.findByIdentifier(id);
    if (!user || (user.status !== 'active' && user.status !== 'restricted')) {
      await this.passwords.burn('timing');
      return this.withoutChannel(await this.otp.issueFake('password_reset', id.value, ctx.ip));
    }
    const c = await this.otp.issue({ userId: user.id, purpose: 'password_reset', destination: id.value, ip: ctx.ip });
    return this.withoutChannel(OtpService.toResponse(c));
  }

  /** Doc 06 omits `channel` on the enumeration-safe responses. */
  private withoutChannel(r: OtpChallengeResponse): OtpChallengeResponse {
    const { channel: _channel, ...rest } = r;
    return rest;
  }

  // ----- verify and resend -----

  async verify(
    dto: { challenge_id: string; code: string; keep_signed_in?: boolean },
    ctx: RequestContext,
  ): Promise<{ signedIn?: SignedIn; reset?: PasswordResetTokenResponse }> {
    const env = getEnv();
    if (env.RATE_LIMIT_ENABLED) {
      const { count, ttl } = await this.redis.hit(`rl:otp_verify:${ctx.ip ?? '-'}`, 15 * 60);
      if (count > env.RATE_LIMIT_OTP_VERIFY_PER_15_MINUTES) throw new ApiError('RATE_LIMITED', undefined, undefined, { retry_after_seconds: ttl });
    }
    const c = await this.otp.verify(dto.challenge_id, dto.code);
    const meta = await this.otp.getMeta(c.id);
    const keep = dto.keep_signed_in ?? meta.keep_signed_in ?? true;
    const user = c.userId ? await this.prisma.db.user.findUnique({ where: { id: c.userId } }) : null;
    if (!user) throw new ApiError('OTP_EXPIRED', undefined, undefined, { reason: 'expired' });

    switch (c.purpose) {
      case 'signup': {
        const now = new Date();
        const isPhone = c.destination.startsWith('+');
        const updated = await this.prisma.db.user.update({
          where: { id: user.id },
          data: isPhone ? { phoneVerifiedAt: user.phoneVerifiedAt ?? now, updatedAt: now } : { emailVerifiedAt: user.emailVerifiedAt ?? now, updatedAt: now },
        });
        this.assertCanSignIn(updated);
        await this.sessions.recordDevice(user.id, ctx, true);
        return { signedIn: await this.signIn(updated, keep, ctx) };
      }
      case 'login':
      case 'new_device': {
        this.assertCanSignIn(user);
        const known = await this.sessions.knownDevice(user.id, ctx.deviceId);
        await this.sessions.recordDevice(user.id, ctx, true);
        if (!known || c.purpose === 'new_device') this.log.log(`new_device_sign_in for user ${user.publicId}`);
        return { signedIn: await this.signIn(user, keep, ctx) };
      }
      case 'password_reset': {
        const ttlMin = await this.settings.number('reset_token_ttl_minutes', 15);
        const pca = user.passwordChangedAt?.getTime() ?? 0;
        const token = this.sessions.signPurpose(RESET_AUD, user.id, { pca, dst: c.destination }, ttlMin * 60);
        return {
          reset: {
            reset_token: token,
            reset_token_expires_at: new Date(Date.now() + ttlMin * 60_000).toISOString(),
            identifier_masked: maskIdentifier(c.destination),
          },
        };
      }
      default:
        // first_withdrawal and contact_change are completed by the wallet and settings modules.
        throw new ApiError('INVALID_STATE', 'This code must be confirmed from the page that requested it.');
    }
  }

  private assertCanSignIn(u: User) {
    if (u.status === 'suspended') throw new ApiError('ACCOUNT_SUSPENDED');
    if (u.status === 'closed') throw new ApiError('ACCOUNT_CLOSED');
  }

  resend(challengeId: string, ctx: RequestContext) {
    return this.otp.resend(challengeId, ctx.ip);
  }

  // ----- password reset -----

  async reset(dto: { reset_token: string; new_password: string }, ctx: RequestContext): Promise<SignedIn> {
    const claims = this.sessions.verifyPurpose<{ pca: number }>(RESET_AUD, dto.reset_token);
    if (!claims) throw new ApiError('RESET_TOKEN_EXPIRED');
    const user = await this.prisma.db.user.findUnique({ where: { id: claims.sub } });
    if (!user || (user.passwordChangedAt?.getTime() ?? 0) !== claims.pca) throw new ApiError('RESET_TOKEN_EXPIRED');
    if (user.status === 'suspended' || user.status === 'closed') throw new ApiError('RESET_TOKEN_EXPIRED');
    this.passwords.assertPolicy(dto.new_password, 'new_password');
    await this.passwords.assertNotReused(user.id, dto.new_password, 'new_password');
    const hash = await this.passwords.hash(dto.new_password);
    await this.passwords.setPassword(user.id, hash);
    // BR-082: every other session ends now; trust stays only for this device.
    await this.sessions.revokeAll(user.id, 'password_reset');
    await this.sessions.forgetOtherDevices(user.id, ctx);
    await this.sessions.recordDevice(user.id, ctx, true);
    await invalidateUserStatus(this.redis, user.id);
    const fresh = await this.prisma.db.user.findUniqueOrThrow({ where: { id: user.id } });
    return this.signIn(fresh, true, ctx);
  }

  // ----- refresh and logout -----

  async refresh(rawToken: string | undefined) {
    const r = await this.sessions.rotate(rawToken);
    return r;
  }

  async logout(rawToken: string | undefined, bearerSid: string | null) {
    const row = (await this.sessions.findByRefresh(rawToken)) ?? (bearerSid ? await this.sessions.get(bearerSid) : null);
    if (row) await this.sessions.revokeFamily(row.familyId, 'logout');
  }
}
