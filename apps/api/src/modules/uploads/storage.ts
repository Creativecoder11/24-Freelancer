import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { decodeSecret } from '../../config/env.schema';
import { getEnv } from '../../config/env';

/**
 * Local-disk storage driver (Doc 11 §6, STORAGE_DRIVER=local). Objects live at
 * `<STORAGE_LOCAL_DIR>/<bucket>/<key>`. Presigned URLs are HMAC-signed API routes
 * (`PUT /uploads/{id}/content`, `GET /uploads/{id}/file`) that mimic S3 presigning:
 * method + id + variant + expiry are signed with STORAGE_SIGNING_SECRET.
 */
export class LocalStorage {
  private readonly root: string;
  private readonly secret: Buffer;

  constructor() {
    const env = getEnv();
    this.root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
    this.secret = decodeSecret(env.STORAGE_SIGNING_SECRET);
  }

  private file(bucket: string, key: string) {
    const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.root, bucket, safe);
  }

  async putStream(bucket: string, key: string, body: Readable, maxBytes: number): Promise<number> {
    const target = this.file(bucket, key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.part-${randomBytes(4).toString('hex')}`;
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp);
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          body.unpipe(out);
          out.destroy();
          reject(Object.assign(new Error('too_large'), { code: 'TOO_LARGE' }));
        }
      });
      body.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      body.pipe(out);
    }).catch(async (e) => {
      await rm(tmp, { force: true });
      throw e;
    });
    await rename(tmp, target);
    return size;
  }

  async put(bucket: string, key: string, data: Buffer) {
    const target = this.file(bucket, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    return readFile(this.file(bucket, key));
  }

  async head(bucket: string, key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.file(bucket, key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async delete(bucket: string, key: string) {
    await rm(this.file(bucket, key), { force: true });
  }

  // ----- Signed URLs -----

  sign(method: 'PUT' | 'GET', id: string, variant: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${method}\n${id}\n${variant}\n${expiresAt}`).digest('base64url');
  }

  verify(method: 'PUT' | 'GET', id: string, variant: string, expiresAt: number, sig: string): boolean {
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now() || !sig) return false;
    const want = Buffer.from(this.sign(method, id, variant, expiresAt));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  // ----- KYC key envelope (uploads_key_ck: KYC rows keep only an encrypted key) -----

  private kek(): Buffer {
    const raw = getEnv().PII_LOCAL_MASTER_KEY;
    return raw ? decodeSecret(raw).subarray(0, 32) : this.secret.subarray(0, 32);
  }

  encryptKey(key: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.kek(), iv);
    const ct = Buffer.concat([c.update(key, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  decryptKey(blob: Uint8Array): string {
    const b = Buffer.from(blob);
    const d = createDecipheriv('aes-256-gcm', this.kek(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }
}
