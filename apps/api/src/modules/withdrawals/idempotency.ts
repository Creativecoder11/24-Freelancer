import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { Prisma } from '@24f/db';
import { IDEMPOTENCY_KEY_RE } from '@24f/shared';
import type { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';

const LOCK_MS = 30_000;
const TTL_MS = 24 * 3_600_000;

export function requireIdempotencyKey(v: string | undefined): string {
  if (!v || !IDEMPOTENCY_KEY_RE.test(v)) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
  return v;
}

function hashBody(body: unknown): Uint8Array<ArrayBuffer> {
  // The password is part of the body but never stored: hash it out of the comparison.
  const clean = body && typeof body === 'object' ? { ...(body as Record<string, unknown>), password: undefined, otp_token: undefined } : body;
  const b = createHash('sha256').update(JSON.stringify(clean ?? {})).digest();
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
}

/**
 * `Idempotency-Key` handling (Doc 06 §1.10) on `idempotency_keys`. Same key + same body replays
 * the stored result with `Idempotent-Replayed: true`; a different body is IDEMPOTENCY_CONFLICT;
 * a request still running is IDEMPOTENCY_IN_PROGRESS. Successes are stored; any error releases the
 * key (no money moved), so the form can retry with the same key after fixing the password.
 */
export async function withIdempotency<T>(
  prisma: PrismaService,
  args: { userId: string; key: string; method: string; path: string; body: unknown; res?: Response },
  run: () => Promise<{ status: number; body: T }>,
): Promise<T> {
  const db = prisma.db;
  const requestHash = hashBody(args.body);
  const where = { actorType: 'user' as const, actorId: args.userId, key: args.key };
  const now = new Date();

  const existing = await db.idempotencyKey.findUnique({ where: { actorType_actorId_key: where } });
  if (existing && existing.expiresAt > now) {
    if (existing.path !== args.path || !Buffer.from(existing.requestHash).equals(Buffer.from(requestHash))) throw new ApiError('IDEMPOTENCY_CONFLICT');
    if (existing.status === 'in_progress' && existing.lockedUntil > now) {
      args.res?.setHeader('Retry-After', '1');
      throw new ApiError('IDEMPOTENCY_IN_PROGRESS');
    }
    if (existing.status === 'completed' && existing.responseCode !== null) {
      args.res?.setHeader('Idempotent-Replayed', 'true');
      if (existing.responseCode >= 400) {
        const b = existing.responseBody as { code: string; message: string; fields?: Record<string, string[]>; details?: Record<string, unknown> };
        throw new ApiError(b.code as never, b.message, b.fields, b.details);
      }
      args.res?.status(existing.responseCode);
      return existing.responseBody as T;
    }
  }
  if (existing) await db.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => undefined);
  try {
    await db.idempotencyKey.create({
      data: { ...where, method: args.method, path: args.path, requestHash, status: 'in_progress', lockedUntil: new Date(Date.now() + LOCK_MS), expiresAt: new Date(Date.now() + TTL_MS) },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      args.res?.setHeader('Retry-After', '1');
      throw new ApiError('IDEMPOTENCY_IN_PROGRESS');
    }
    throw e;
  }

  try {
    const r = await run();
    await db.idempotencyKey.update({
      where: { actorType_actorId_key: where },
      data: { status: 'completed', responseCode: r.status, responseBody: r.body as Prisma.InputJsonValue },
    });
    args.res?.status(r.status);
    return r.body;
  } catch (e) {
    // Nothing moved: release the key so a corrected retry (e.g. the right password) runs again.
    await db.idempotencyKey.delete({ where: { actorType_actorId_key: where } }).catch(() => undefined);
    throw e;
  }
}
