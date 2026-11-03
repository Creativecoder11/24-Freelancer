import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { passwordProblems, PASSWORD_MESSAGE } from '@24f/shared';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';

/** argon2id hashing, policy, history and sensitive-action re-entry (Doc 04 §3.5). */
@Injectable()
export class PasswordService {
  private dummy: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private opts() {
    const env = getEnv();
    return { type: argon2.argon2id, memoryCost: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM };
  }

  hash(pw: string) {
    return argon2.hash(pw, this.opts());
  }

  async verify(hash: string | null, pw: string): Promise<boolean> {
    if (!hash) {
      await this.burn(pw);
      return false;
    }
    try {
      return await argon2.verify(hash, pw);
    } catch {
      return false;
    }
  }

  /** Runs a verify against a fixed hash so unknown identifiers take the same time. */
  async burn(pw: string) {
    this.dummy ??= this.hash('dummy-password-for-timing-1!');
    try {
      await argon2.verify(await this.dummy, pw);
    } catch {
      /* ignore */
    }
  }

  needsRehash(hash: string) {
    const o = this.opts();
    return argon2.needsRehash(hash, { memoryCost: o.memoryCost, timeCost: o.timeCost, parallelism: o.parallelism });
  }

  /** BR-080. `field` is the request field that gets the error. */
  assertPolicy(pw: string, field = 'password') {
    if (passwordProblems(pw).length) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [PASSWORD_MESSAGE] });
  }

  /** The new password may not match the current one or the last 3 (Canonical §17). */
  async assertNotReused(userId: string, pw: string, field = 'new_password') {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    const history = await this.prisma.db.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { passwordHash: true },
    });
    const hashes = [user?.passwordHash, ...history.map((h) => h.passwordHash)].filter((h): h is string => !!h);
    for (const h of new Set(hashes)) {
      if (await this.verify(h, pw)) {
        throw new ApiError('PASSWORD_REUSED', undefined, { [field]: ["Choose a password you haven’t used for this account."] });
      }
    }
  }

  /** Saves a new hash, pushes history (keeps 5 rows) and resets the lock counters. */
  async setPassword(userId: string, hash: string) {
    const now = new Date();
    await this.prisma.db.$transaction(async (t) => {
      await t.user.update({
        where: { id: userId },
        data: { passwordHash: hash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now },
      });
      await t.passwordHistory.create({ data: { userId, passwordHash: hash } });
      const old = await t.passwordHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: 5, select: { id: true } });
      if (old.length) await t.passwordHistory.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    });
    return now;
  }

  /**
   * Single entry point for password re-entry (G-V6). Counts failures per user and action in
   * Redis: 5 failures → 15 minutes of TOO_MANY_ATTEMPTS.
   */
  async verifyForSensitiveAction(userId: string, pw: string | undefined, action: string, field = 'password') {
    const key = `pw:fail:${action}:${userId}`;
    const fails = Number((await this.redis.client.get(key)) ?? 0);
    if (fails >= 5) {
      const ttl = await this.redis.client.ttl(key);
      throw new ApiError('TOO_MANY_ATTEMPTS', undefined, undefined, { retry_after_seconds: Math.max(ttl, 1) });
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!pw || !(await this.verify(user?.passwordHash ?? null, pw))) {
      await this.redis.hit(key, 15 * 60);
      throw new ApiError('INVALID_PASSWORD', undefined, { [field]: ["That password isn't right."] });
    }
    await this.redis.client.del(key);
  }
}
