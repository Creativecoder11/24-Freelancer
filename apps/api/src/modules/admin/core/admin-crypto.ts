import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeSecret } from '../../../config/env.schema';
import { getEnv } from '../../../config/env';
import { adminJwtSecret } from './admin-env';

/** AES-256-GCM envelope `[iv 12][tag 16][ciphertext]` with the local PII master key (Doc 11 §6, KMS later). */
function kek(): Buffer {
  const env = getEnv();
  const raw = env.PII_LOCAL_MASTER_KEY ?? env.STORAGE_SIGNING_SECRET;
  return decodeSecret(raw).subarray(0, 32);
}

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
};

export function encryptPii(plain: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return bytes(Buffer.concat([iv, c.getAuthTag(), ct]));
}

/** Returns null when the blob is not a valid envelope (e.g. fixture placeholders). */
export function decryptPii(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length < 29) return null;
  try {
    const b = Buffer.from(blob);
    const d = createDecipheriv('aes-256-gcm', kek(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Refresh-token storage hash (HMAC-SHA256 with the admin key). */
export function hashAdminToken(raw: string): Uint8Array<ArrayBuffer> {
  return bytes(createHmac('sha256', adminJwtSecret()).update(`rt:${raw}`).digest());
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------- JWT (HS256)

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signJwt(payload: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', adminJwtSecret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt<T extends Record<string, unknown>>(token: string, aud: string): (T & { exp: number }) | 'expired' | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const want = createHmac('sha256', adminJwtSecret()).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number; aud?: string };
    if (p.aud !== aud) return null;
    if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return 'expired';
    return p;
  } catch {
    return null;
  }
}
