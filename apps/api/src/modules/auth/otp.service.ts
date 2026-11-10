import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { maskIdentifier, type OtpChallengeResponse, type OtpChannel, type OtpPurpose } from '@24f/shared';
import type { OtpChallenge } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SettingsService } from '../settings/settings.service';
import { ApiError } from '../../common/api-error';
import { hashOtp, newOtpCode, safeEqualHex } from './auth.crypto';
import { OtpDeliveryAdapter } from './otp-delivery';

export interface ChallengeMeta {
  keep_signed_in?: boolean;
  next?: string | null;
}

interface FakeChallenge {
  purpose: OtpPurpose;
  destination: string;
  attempts: number;
  expires_at: string;
  resend_available_at: string;
}

const TOO_MANY_CODES = "You've requested too many codes. Try again in an hour.";

export const channelFor = (destination: string): OtpChannel => (destination.includes('@') ? 'email' : 'email');

/** OTP challenges (Doc 04 §3.6): 6 digits, HMAC-stored, TTL, resend cooldown, attempt cap. */
@Injectable()
export class OtpService {
  private readonly log = new Logger('Otp');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly delivery: OtpDeliveryAdapter,
  ) {}

  private async limits() {
    const [ttl, resend, attempts, perHour, perDay, perIp] = await Promise.all([
      this.settings.number('otp_ttl_minutes', 10),
      this.settings.number('otp_resend_seconds', 60),
      this.settings.number('otp_max_attempts', 5),
      this.settings.number('otp_max_sends_per_hour', 5),
      this.settings.number('otp_max_sends_per_day', 10),
      this.settings.number('otp_max_sends_per_ip_per_day', 20),
    ]);
    return { ttl, resend, attempts, perHour, perDay, perIp };
  }

  /** Redis windows per destination and per IP; RATE_LIMITED when over. */
  private async assertSendLimits(destination: string, ip: string | null) {
    const l = await this.limits();
    const hour = await this.redis.hit(`otp:sends:h:${destination}`, 3600);
    const day = await this.redis.hit(`otp:sends:d:${destination}`, 86400);
    const byIp = ip ? await this.redis.hit(`otp:sends:ip:${ip}`, 86400) : { count: 0, ttl: 0 };
    if (hour.count > l.perHour || day.count > l.perDay || byIp.count > l.perIp) {
      throw new ApiError('RATE_LIMITED', TOO_MANY_CODES, undefined, { retry_after_seconds: Math.max(hour.ttl, 60) });
    }
  }

  static toResponse(c: Pick<OtpChallenge, 'id' | 'purpose' | 'channel' | 'destination' | 'expiresAt' | 'resendAvailableAt'>): OtpChallengeResponse {
    return {
      challenge_id: c.id,
      purpose: c.purpose as OtpPurpose,
      channel: c.channel as OtpChannel,
      destination_masked: maskIdentifier(c.destination),
      expires_at: c.expiresAt.toISOString(),
      resend_available_at: c.resendAvailableAt.toISOString(),
    };
  }

  /** Issues and delivers a code. A new code voids open codes for the same destination and purpose. */
  async issue(input: { userId: string; purpose: OtpPurpose; destination: string; ip: string | null; meta?: ChallengeMeta }) {
    await this.assertSendLimits(input.destination, input.ip);
    const l = await this.limits();
    const now = Date.now();
    const code = newOtpCode();
    await this.prisma.db.otpChallenge.updateMany({
      where: { destination: input.destination, purpose: input.purpose, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: new Date(), updatedAt: new Date() },
    });
    const challenge = await this.prisma.db.otpChallenge.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        purpose: input.purpose,
        channel: channelFor(input.destination),
        destination: input.destination,
        codeHash: hashOtp(code, `${input.destination}:${input.purpose}`),
        maxAttempts: l.attempts,
        expiresAt: new Date(now + l.ttl * 60_000),
        resendAvailableAt: new Date(now + l.resend * 1000),
        requestIp: input.ip,
      },
    });
    if (input.meta) await this.setMeta(challenge.id, input.meta, l.ttl * 60 + 300);
    await this.deliver(challenge, code, l.ttl);
    return challenge;
  }

  /**
   * Unknown identifier on login/forgot (FR-AUTH-005, FR-AUTH-007): same response shape, no row,
   * nothing sent. Verify fails like a wrong code.
   */
  async issueFake(purpose: OtpPurpose, destination: string, ip: string | null): Promise<OtpChallengeResponse> {
    await this.assertSendLimits(destination, ip);
    const l = await this.limits();
    const now = Date.now();
    const id = randomUUID();
    const fake: FakeChallenge = {
      purpose,
      destination,
      attempts: 0,
      expires_at: new Date(now + l.ttl * 60_000).toISOString(),
      resend_available_at: new Date(now + l.resend * 1000).toISOString(),
    };
    await this.redis.client.set(`otp:fake:${id}`, JSON.stringify(fake), 'EX', l.ttl * 60 + 300);
    return {
      challenge_id: id,
      purpose,
      channel: channelFor(destination),
      destination_masked: maskIdentifier(destination),
      expires_at: fake.expires_at,
      resend_available_at: fake.resend_available_at,
    };
  }

  private async deliver(c: OtpChallenge, code: string, ttlMinutes: number) {
    try {
      await this.delivery.send({ channel: c.channel as OtpChannel, destination: c.destination, purpose: c.purpose as OtpPurpose, code, expiresMinutes: ttlMinutes });
    } catch (e) {
      this.log.error(`delivery failed: ${(e as Error).message}`);
      throw new ApiError('OTP_DELIVERY_FAILED');
    }
  }

  async setMeta(id: string, meta: ChallengeMeta, ttlSeconds = 900) {
    await this.redis.client.set(`otp:meta:${id}`, JSON.stringify(meta), 'EX', ttlSeconds);
  }
  async getMeta(id: string): Promise<ChallengeMeta> {
    const raw = await this.redis.client.get(`otp:meta:${id}`);
    return raw ? (JSON.parse(raw) as ChallengeMeta) : {};
  }

  /** Checks a code. Throws OTP_INVALID (tries left) / OTP_EXPIRED (expired | locked | used). */
  async verify(challengeId: string, code: string): Promise<OtpChallenge> {
    const c = await this.prisma.db.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!c) return this.verifyFake(challengeId);
    if (c.consumedAt || c.invalidatedAt) {
      const locked = c.invalidatedAt && c.attempts >= c.maxAttempts;
      throw this.expired(locked ? 'locked' : 'used');
    }
    if (c.expiresAt.getTime() < Date.now()) throw this.expired('expired');

    const ok = safeEqualHex(c.codeHash, hashOtp(code, `${c.destination}:${c.purpose}`));
    if (!ok) {
      const attempts = c.attempts + 1;
      const locked = attempts >= c.maxAttempts;
      await this.prisma.db.otpChallenge.update({
        where: { id: c.id },
        data: { attempts, invalidatedAt: locked ? new Date() : null, updatedAt: new Date() },
      });
      if (locked) throw this.expired('locked');
      throw this.invalid(c.maxAttempts - attempts);
    }
    const consumed = await this.prisma.db.otpChallenge.updateMany({
      where: { id: c.id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: new Date(), updatedAt: new Date() },
    });
    if (consumed.count !== 1) throw this.expired('used');
    return c;
  }

  private async verifyFake(id: string): Promise<never> {
    const key = `otp:fake:${id}`;
    const raw = await this.redis.client.get(key);
    if (!raw) throw this.expired('expired');
    const f = JSON.parse(raw) as FakeChallenge;
    if (new Date(f.expires_at).getTime() < Date.now()) throw this.expired('expired');
    const max = await this.settings.number('otp_max_attempts', 5);
    f.attempts += 1;
    await this.redis.client.set(key, JSON.stringify(f), 'KEEPTTL');
    if (f.attempts >= max) throw this.expired('locked');
    throw this.invalid(max - f.attempts);
  }

  /** POST /auth/otp/resend: re-issues under the same challenge id. */
  async resend(challengeId: string, ip: string | null): Promise<OtpChallengeResponse> {
    const l = await this.limits();
    const now = Date.now();
    const c = await this.prisma.db.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!c) {
      const key = `otp:fake:${challengeId}`;
      const raw = await this.redis.client.get(key);
      if (!raw) throw this.expired('expired');
      const f = JSON.parse(raw) as FakeChallenge;
      this.assertCooldown(new Date(f.resend_available_at));
      await this.assertSendLimits(f.destination, ip);
      f.attempts = 0;
      f.expires_at = new Date(now + l.ttl * 60_000).toISOString();
      f.resend_available_at = new Date(now + l.resend * 1000).toISOString();
      await this.redis.client.set(key, JSON.stringify(f), 'EX', l.ttl * 60 + 300);
      return {
        challenge_id: challengeId,
        purpose: f.purpose,
        channel: channelFor(f.destination),
        destination_masked: maskIdentifier(f.destination),
        expires_at: f.expires_at,
        resend_available_at: f.resend_available_at,
      };
    }
    if (c.consumedAt) throw this.expired('used');
    this.assertCooldown(c.resendAvailableAt);
    await this.assertSendLimits(c.destination, ip);
    const code = newOtpCode();
    const updated = await this.prisma.db.otpChallenge.update({
      where: { id: c.id },
      data: {
        codeHash: hashOtp(code, `${c.destination}:${c.purpose}`),
        attempts: 0,
        sendCount: { increment: 1 },
        invalidatedAt: null,
        expiresAt: new Date(now + l.ttl * 60_000),
        resendAvailableAt: new Date(now + l.resend * 1000),
        updatedAt: new Date(),
      },
    });
    await this.deliver(updated, code, l.ttl);
    return OtpService.toResponse(updated);
  }

  private assertCooldown(at: Date) {
    const wait = Math.ceil((at.getTime() - Date.now()) / 1000);
    if (wait > 0) throw new ApiError('OTP_RESEND_TOO_SOON', undefined, undefined, { retry_after_seconds: wait });
  }

  private invalid(left: number) {
    return new ApiError('OTP_INVALID', `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, undefined, { tries_left: left });
  }
  private expired(reason: 'expired' | 'locked' | 'used') {
    const msg =
      reason === 'locked'
        ? 'Too many wrong codes. Request a new code.'
        : 'This code has expired. Request a new one.';
    return new ApiError('OTP_EXPIRED', msg, undefined, { reason });
  }
}
