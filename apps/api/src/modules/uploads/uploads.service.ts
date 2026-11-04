import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Prisma, type PrismaClient } from '@24f/db';
import {
  UPLOAD_RULES,
  uploadTooLargeMessage,
  uploadTypeMessage,
  type PresignResponse,
  type UploadPurpose,
  type UploadRecord,
  type UploadStatus,
} from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { getEnv } from '../../config/env';
import { LocalStorage } from './storage';
import { processImage, sniff, sniffMatches } from './image-processing';

type Tx = Prisma.TransactionClient | PrismaClient;
type UploadRow = Prisma.UploadGetPayload<object>;

const KYC: ReadonlySet<string> = new Set(['kyc_document', 'kyc_selfie']);
const UNCLAIMED_TTL_MS = 24 * 3600_000;

/**
 * Upload pipeline (Doc 04 §6.5, Doc 06 §5.4): presign → direct PUT → complete → process.
 * Processing runs in-process right after `complete` (the BullMQ `uploads.process` queue can
 * take it over without changing the API): magic bytes, re-encode without metadata,
 * thumbnail, SHA-256 and pHash. The client polls `GET /uploads/{id}`.
 */
@Injectable()
export class UploadsService {
  private readonly log = new Logger('Uploads');
  readonly storage = new LocalStorage();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private bucketFor(purpose: UploadPurpose) {
    const env = getEnv();
    if (KYC.has(purpose)) return env.S3_BUCKET_KYC;
    if (purpose === 'avatar' || purpose === 'employer_logo' || purpose === 'cms_image') return env.S3_BUCKET_PUBLIC;
    return env.S3_BUCKET_PROOFS;
  }

  private keyOf(u: UploadRow): string {
    if (u.storageKey) return u.storageKey;
    if (u.storageKeyEnc) return this.storage.decryptKey(u.storageKeyEnc);
    throw new Error(`upload ${u.id} has no storage key`);
  }

  private apiBase() {
    return `${getEnv().API_PUBLIC_URL.replace(/\/$/, '')}/api/v1`;
  }

  /** Short-lived signed GET URL (Doc 11 §6.7, 300 s). */
  signedUrl(id: string, variant: 'full' | 'thumb') {
    const exp = Math.floor(Date.now() / 1000) + getEnv().UPLOAD_PRESIGN_GET_TTL_SECONDS;
    return `${this.apiBase()}/uploads/${id}/file?v=${variant}&exp=${exp}&sig=${this.storage.sign('GET', id, variant, exp)}`;
  }

  // ---------------------------------------------------------------------------
  // Presign, PUT, complete
  // ---------------------------------------------------------------------------

  async presign(userId: string, input: { purpose: string; filename: string; content_type: string; size_bytes: number }): Promise<PresignResponse> {
    const env = getEnv();
    if (env.RATE_LIMIT_ENABLED) {
      const { count, ttl } = await this.redis.hit(`rl:upload_presign:${userId}`, 3600).catch(() => ({ count: 0, ttl: 0 }));
      if (count > env.RATE_LIMIT_UPLOAD_PRESIGN_PER_HOUR) throw new ApiError('RATE_LIMITED', undefined, undefined, { retry_after: ttl });
    }
    const purpose = input.purpose as UploadPurpose;
    const rule = UPLOAD_RULES[purpose];
    const mime = input.content_type.toLowerCase().split(';')[0]!.trim();
    if (!rule.mimeTypes.includes(mime)) {
      throw new ApiError('UPLOAD_TYPE_NOT_ALLOWED', uploadTypeMessage(purpose), { content_type: [uploadTypeMessage(purpose)] }, { allowed_types: rule.mimeTypes });
    }
    if (input.size_bytes > rule.maxBytes) {
      throw new ApiError('UPLOAD_TOO_LARGE', uploadTooLargeMessage(purpose), { size_bytes: [uploadTooLargeMessage(purpose)] }, { max_bytes: rule.maxBytes });
    }
    const bucket = this.bucketFor(purpose);
    const id = (await this.prisma.db.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
    const key = `tmp/${id}`;
    await this.prisma.db.upload.create({
      data: {
        id,
        ownerUserId: userId,
        purpose,
        status: 'pending',
        storageBucket: bucket,
        storageKey: KYC.has(purpose) ? null : key,
        storageKeyEnc: KYC.has(purpose) ? new Uint8Array(this.storage.encryptKey(key)) : null,
        originalFilename: input.filename.slice(0, 255),
        mimeType: mime,
        sizeBytes: input.size_bytes,
        deleteAfter: new Date(Date.now() + UNCLAIMED_TTL_MS),
      },
    });
    const ttl = env.UPLOAD_PRESIGN_PUT_TTL_SECONDS;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return {
      upload_id: id,
      url: `${this.apiBase()}/uploads/${id}/content?exp=${exp}&sig=${this.storage.sign('PUT', id, 'content', exp)}`,
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Length': String(input.size_bytes) },
      expires_at: new Date(exp * 1000).toISOString(),
      status: 'pending',
    };
  }

  /** The presigned PUT target. Signed URL only; the size and type were fixed at presign. */
  async receive(id: string, exp: number, sig: string, contentType: string | undefined, body: Readable) {
    if (!this.storage.verify('PUT', id, 'content', exp, sig)) throw new ApiError('FORBIDDEN', 'This upload link has expired. Try again.');
    const u = await this.prisma.db.upload.findUnique({ where: { id } });
    if (!u || u.status !== 'pending' || u.completedAt) throw new ApiError('INVALID_STATE');
    const mime = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
    if (mime !== u.mimeType) throw new ApiError('UPLOAD_TYPE_NOT_ALLOWED', uploadTypeMessage(u.purpose as UploadPurpose));
    try {
      await this.storage.putStream(u.storageBucket, this.keyOf(u), body, u.sizeBytes);
    } catch (e) {
      if ((e as { code?: string }).code === 'TOO_LARGE') throw new ApiError('UPLOAD_TOO_LARGE', uploadTooLargeMessage(u.purpose as UploadPurpose));
      throw e;
    }
  }

  async complete(userId: string, id: string): Promise<UploadRecord> {
    const u = await this.owned(userId, id);
    if (u.status === 'uploaded' || (u.status === 'pending' && u.completedAt)) return this.record(u);
    if (u.status !== 'pending') throw new ApiError('INVALID_STATE');
    const head = await this.storage.head(u.storageBucket, this.keyOf(u));
    if (!head) throw new ApiError('UPLOAD_NOT_READY', undefined, undefined, { upload_id: id });
    if (head.size > UPLOAD_RULES[u.purpose as UploadPurpose].maxBytes) {
      await this.quarantine(u, 'too_large');
      throw new ApiError('UPLOAD_TOO_LARGE', uploadTooLargeMessage(u.purpose as UploadPurpose));
    }
    const done = await this.prisma.db.upload.update({ where: { id }, data: { completedAt: new Date(), sizeBytes: head.size } });
    // UP-8: idempotent background processing.
    setImmediate(() => void this.process(id).catch((e) => this.log.error(`process ${id}: ${e instanceof Error ? e.stack : String(e)}`)));
    return this.record(done);
  }

  /** UP-3 / UP-4. */
  async process(id: string) {
    const u = await this.prisma.db.upload.findUnique({ where: { id } });
    if (!u || u.status !== 'pending' || !u.completedAt) return;
    const purpose = u.purpose as UploadPurpose;
    const rule = UPLOAD_RULES[purpose];
    const key = this.keyOf(u);
    const raw = await this.storage.get(u.storageBucket, key);
    const sniffed = sniff(raw);
    if (!sniffMatches(u.mimeType, sniffed)) return this.quarantine(u, 'type_mismatch');

    const finalKey = key.replace(/^tmp\//, `${purpose}/`);
    if (rule.image && (u.mimeType === 'image/png' || u.mimeType === 'image/jpeg' || u.mimeType === 'image/webp')) {
      let img;
      try {
        img = await processImage(raw, u.mimeType);
      } catch {
        return this.quarantine(u, 'decode_failed');
      }
      if (img.data.length > rule.maxBytes) return this.quarantine(u, 'too_large');
      await this.storage.put(u.storageBucket, finalKey, img.data);
      await this.storage.put(u.storageBucket, `${finalKey}.thumb.webp`, img.thumb);
      await this.storage.delete(u.storageBucket, key);
      await this.prisma.db.upload.update({
        where: { id },
        data: {
          status: 'uploaded',
          ...(KYC.has(purpose) ? { storageKeyEnc: new Uint8Array(this.storage.encryptKey(finalKey)) } : { storageKey: finalKey }),
          sizeBytes: img.data.length,
          sha256: new Uint8Array(img.sha256),
          phash: img.phash,
          widthPx: img.width,
          heightPx: img.height,
        },
      });
      return;
    }
    // UP-5: non-image files skip re-encoding and pHash.
    await this.storage.put(u.storageBucket, finalKey, raw);
    await this.storage.delete(u.storageBucket, key);
    await this.prisma.db.upload.update({
      where: { id },
      data: {
        status: 'uploaded',
        ...(KYC.has(purpose) ? { storageKeyEnc: new Uint8Array(this.storage.encryptKey(finalKey)) } : { storageKey: finalKey }),
        sha256: new Uint8Array(createHash('sha256').update(raw).digest()),
      },
    });
  }

  private async quarantine(u: UploadRow, reason: 'type_mismatch' | 'malware' | 'too_large' | 'decode_failed') {
    await this.storage.delete(u.storageBucket, this.keyOf(u)).catch(() => undefined);
    await this.prisma.db.upload.update({ where: { id: u.id }, data: { status: 'quarantined' } });
    await this.redis.client.set(`upload:reject:${u.id}`, reason, 'EX', 7 * 86400).catch(() => undefined);
    this.log.warn(`upload ${u.id} quarantined: ${reason}`);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async owned(userId: string, id: string) {
    const u = await this.prisma.db.upload.findUnique({ where: { id } });
    if (!u || u.ownerUserId !== userId || u.status === 'deleted') throw new ApiError('NOT_FOUND');
    return u;
  }

  async get(userId: string, id: string): Promise<UploadRecord> {
    return this.record(await this.owned(userId, id));
  }

  async record(u: UploadRow): Promise<UploadRecord> {
    const status = u.status as UploadStatus;
    const isKyc = KYC.has(u.purpose);
    const reason = status === 'quarantined' ? ((await this.redis.client.get(`upload:reject:${u.id}`).catch(() => null)) ?? 'type_mismatch') : null;
    const image = UPLOAD_RULES[u.purpose as UploadPurpose].image;
    // Only sign URLs for objects that really exist (seeded rows can point at missing files; a signed
    // URL to a 404 shows as a broken image and a console error in the app).
    const present = status === 'uploaded' && !isKyc ? !!(await this.storage.head(u.storageBucket, this.keyOf(u)).catch(() => null)) : false;
    return {
      upload_id: u.id,
      purpose: u.purpose as UploadPurpose,
      status,
      filename: u.originalFilename,
      size_bytes: u.sizeBytes,
      mime_type: u.mimeType,
      width_px: u.widthPx,
      height_px: u.heightPx,
      thumbnail_url: present && image ? this.signedUrl(u.id, 'thumb') : null,
      url: present ? this.signedUrl(u.id, 'full') : null,
      rejection_reason: reason,
    };
  }

  /** Records for many ids (draft restore, proof views). Missing ids are skipped. */
  async records(ids: string[]): Promise<Record<string, UploadRecord>> {
    if (!ids.length) return {};
    const rows = await this.prisma.db.upload.findMany({ where: { id: { in: ids } } });
    const out: Record<string, UploadRecord> = {};
    for (const r of rows) out[r.id] = await this.record(r);
    return out;
  }

  /** Signed file download (`GET /uploads/{id}/file`). Office files download as attachments (UP-5). */
  async readSigned(id: string, variant: string, exp: number, sig: string) {
    if (variant !== 'full' && variant !== 'thumb') throw new ApiError('NOT_FOUND');
    if (!this.storage.verify('GET', id, variant, exp, sig)) throw new ApiError('FORBIDDEN');
    const u = await this.prisma.db.upload.findUnique({ where: { id } });
    if (!u || u.status !== 'uploaded' || KYC.has(u.purpose)) throw new ApiError('NOT_FOUND');
    const key = this.keyOf(u);
    const data = await this.storage.get(u.storageBucket, variant === 'thumb' ? `${key}.thumb.webp` : key).catch(() => null);
    if (!data) throw new ApiError('NOT_FOUND');
    const inline = variant === 'thumb' || u.mimeType.startsWith('image/') || u.mimeType === 'application/pdf';
    return {
      data,
      contentType: variant === 'thumb' ? 'image/webp' : u.mimeType,
      disposition: `${inline ? 'inline' : 'attachment'}; filename="${u.originalFilename.replace(/["\r\n]/g, '')}"`,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers for submissions and disputes (UP-6, UP-7)
  // ---------------------------------------------------------------------------

  /** Upload must be `uploaded`, owned by the caller and of an allowed purpose; else UPLOAD_NOT_READY. */
  async requireReady(tx: Tx, userId: string, id: string, purposes: UploadPurpose[], field?: string) {
    const u = await tx.upload.findUnique({ where: { id } });
    if (!u || u.ownerUserId !== userId || !purposes.includes(u.purpose as UploadPurpose) || u.status !== 'uploaded') {
      throw new ApiError('UPLOAD_NOT_READY', undefined, field ? { [field]: ['Your file is still processing. Try again in a moment.'] } : undefined, { upload_id: id });
    }
    return u;
  }

  /** Claimed by a submission or dispute: kept under the proof retention policy, not the 24 h purge. */
  async markClaimed(tx: Tx, ids: string[]) {
    if (ids.length) await tx.upload.updateMany({ where: { id: { in: ids } }, data: { deleteAfter: null } });
  }

  /** Draft discarded (release, expiry): delete its files after 24 h (Doc 04 §6.3). */
  async scheduleDeletion(tx: Tx, ids: string[]) {
    if (ids.length) await tx.upload.updateMany({ where: { id: { in: ids }, deleteAfter: { not: null } }, data: { deleteAfter: new Date(Date.now() + UNCLAIMED_TTL_MS) } });
  }
}
