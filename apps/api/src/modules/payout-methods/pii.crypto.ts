import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { decodeSecret } from '../../config/env.schema';
import { getEnv } from '../../config/env';

/**
 * PII field encryption (Doc 08 §12.3, Doc 11 §6). AES-256-GCM with the local master key
 * (`PII_KMS_PROVIDER=local`); blob = iv(12) | tag(16) | ciphertext. `keyId` is stored per row so
 * a KMS data key can replace the local key later. Blind index = HMAC-SHA256 with
 * `PII_BLIND_INDEX_KEY` over the normalised value (duplicate detection without decrypting).
 */
function masterKey(): Buffer {
  const env = getEnv();
  const raw = env.PII_LOCAL_MASTER_KEY;
  if (raw) return decodeSecret(raw).subarray(0, 32);
  // Local fallback (env validation requires the key outside local/test).
  return createHmac('sha256', decodeSecret(env.PII_BLIND_INDEX_KEY)).update('pii-local-master-v1').digest();
}

export function piiKeyId(): string {
  return `local:v${getEnv().PII_KEY_VERSION}`;
}

/** Prisma `Bytes` needs a plain ArrayBuffer-backed Uint8Array. */
export function toBytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
}

export function encryptPii(plain: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return toBytes(Buffer.concat([iv, c.getAuthTag(), ct]));
}

/** Returns null for rows that can't be decrypted (e.g. fixture placeholders). */
export function decryptPii(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length < 29) return null;
  try {
    const b = Buffer.from(blob);
    const d = createDecipheriv('aes-256-gcm', masterKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function blindIndex(normalised: string, purpose: string): Uint8Array<ArrayBuffer> {
  return toBytes(createHmac('sha256', decodeSecret(getEnv().PII_BLIND_INDEX_KEY)).update(`${purpose}:${normalised}`).digest());
}
