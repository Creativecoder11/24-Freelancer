import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { decodeSecret } from '../../config/env.schema';
import { getEnv } from '../../config/env';

let keys: { otp: Buffer; refresh: Buffer; access: Buffer; device: Buffer } | null = null;
function k() {
  if (keys) return keys;
  const env = getEnv();
  const refresh = decodeSecret(env.JWT_REFRESH_SECRET);
  keys = {
    otp: decodeSecret(env.OTP_HMAC_SECRET),
    refresh,
    access: decodeSecret(env.JWT_ACCESS_SECRET),
    device: createHmac('sha256', refresh).update('device-hash-v1').digest(),
  };
  return keys;
}

export const accessSecret = () => k().access;

/** OTP code hash (Doc 04 §3.6): hex HMAC-SHA256 with OTP_HMAC_SECRET, bound to the challenge. */
export function hashOtp(code: string, challengeSalt: string): string {
  return createHmac('sha256', k().otp).update(`${challengeSalt}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Opaque 256-bit refresh token (base64url) and its stored HMAC. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
/** Prisma `Bytes` wants a plain ArrayBuffer-backed Uint8Array. */
function bytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
}

export function hashRefreshToken(raw: string): Uint8Array<ArrayBuffer> {
  return bytes(createHmac('sha256', k().refresh).update(raw).digest());
}

export function newDeviceId(): string {
  return randomBytes(16).toString('base64url');
}
export function hashDeviceId(raw: string): Uint8Array<ArrayBuffer> {
  return bytes(createHmac('sha256', k().device).update(raw).digest());
}
