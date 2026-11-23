import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@24f/db';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { UploadsService } from '../../uploads/uploads.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { iso, optText, paged, paging, type Q } from '../core/helpers';

/** Sub-folders inside a user's media folder, in display order. */
const FOLDERS = [
  { key: 'kyc', label: 'KYC documents', purposes: ['kyc_document', 'kyc_selfie'] },
  { key: 'proofs', label: 'Task proofs', purposes: ['proof_screenshot', 'proof_file'] },
  { key: 'avatar', label: 'Profile photo', purposes: ['avatar'] },
  { key: 'logo', label: 'Business logo', purposes: ['employer_logo'] },
  { key: 'job_images', label: 'Job images', purposes: ['job_thumbnail'] },
] as const;
const KYC_PURPOSES = ['kyc_document', 'kyc_selfie'] as const;
const isKyc = (p: string) => (KYC_PURPOSES as readonly string[]).includes(p);
const folderOf = (purpose: string) => FOLDERS.find((f) => (f.purposes as readonly string[]).includes(purpose))?.key ?? 'other';

/** Upload-date filter: uploaded in the last N days, or older than 30 days. */
export const RANGES = ['7d', '15d', '30d', 'older_30d'] as const;
type Range = (typeof RANGES)[number];
const DAY = 86_400_000;
function rangeWhere(range: string | undefined): Prisma.DateTimeFilter | undefined {
  if (!range) return undefined;
  if (!(RANGES as readonly string[]).includes(range)) throw new ApiError('VALIDATION_FAILED', undefined, { range: ['Choose 7, 15 or 30 days, or older than 30 days.'] });
  const r = range as Range;
  if (r === 'older_30d') return { lt: new Date(Date.now() - 30 * DAY) };
  return { gte: new Date(Date.now() - Number(r.replace('d', '')) * DAY) };
}

/** One delete call handles at most this many files; the response says how many still match. */
const DELETE_BATCH = 2000;

/**
 * Admin media library: one folder per user holding everything they uploaded, split into
 * sub-folders (KYC, proofs, profile photo, logo, job images). KYC files need `kyc.read` and every
 * opening of a folder with KYC files is audited, like KYC review.
 *
 * Delete removes the file (and its thumbnail) from storage and marks the upload deleted. Files a
 * live process still needs are skipped: KYC of a pending check, proofs of a submission in review
 * or needs-fix, and evidence of an open dispute.
 */
@Injectable()
export class AdminMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** Users that have at least one stored file (in the date range), newest upload first. */
  async folders(ctx: AdminCtx, q: Q) {
    const p = paging(q, 50);
    const kyc = ctx.has('kyc.read');
    const created = rangeWhere(q.range);
    const term = q.q?.trim();
    const like = term ? '%' + term.replace(/[%_\\]/g, '\\$&') + '%' : '';
    const search = term ? Prisma.sql`AND (u.public_id = ${term} OR u.full_name ILIKE ${like} OR u.email ILIKE ${like})` : Prisma.empty;
    const visible = kyc ? Prisma.empty : Prisma.sql`AND f.purpose NOT IN ('kyc_document', 'kyc_selfie')`;
    const dates = created?.gte ? Prisma.sql`AND f.created_at >= ${created.gte as Date}` : created?.lt ? Prisma.sql`AND f.created_at < ${created.lt as Date}` : Prisma.empty;
    const base = Prisma.sql`FROM uploads f JOIN users u ON u.id = f.owner_user_id
      WHERE f.status = 'uploaded' AND f.deleted_at IS NULL ${visible} ${dates} ${search}`;
    const [rows, [agg]] = await Promise.all([
      this.db.$queryRaw<{ public_id: string; full_name: string | null; email: string | null; files: number; bytes: bigint; last_at: Date; kyc_files: number }[]>`
        SELECT u.public_id, u.full_name, u.email, count(*)::int AS files, sum(f.size_bytes)::bigint AS bytes, max(f.created_at) AS last_at,
          count(*) FILTER (WHERE f.purpose IN ('kyc_document', 'kyc_selfie'))::int AS kyc_files
        ${base} GROUP BY u.id ORDER BY max(f.created_at) DESC LIMIT ${p.take} OFFSET ${p.skip}`,
      this.db.$queryRaw<{ total: number; files: number; bytes: bigint | null }[]>`SELECT count(DISTINCT u.id)::int AS total, count(*)::int AS files, sum(f.size_bytes)::bigint AS bytes ${base}`,
    ]);
    return paged(
      rows.map((r) => ({ public_id: r.public_id, name: r.full_name, email: r.email, files: r.files, size_bytes: Number(r.bytes), kyc_files: r.kyc_files, last_upload_at: iso(r.last_at) })),
      agg?.total ?? 0,
      p,
      { matching: { files: agg?.files ?? 0, size_bytes: Number(agg?.bytes ?? 0) }, can_delete: ctx.has('users.delete') },
    );
  }

  /** One user's folder: their files (in the date range) grouped by sub-folder, with short-lived signed links. */
  async folder(ctx: AdminCtx, publicId: string, q: Q) {
    const user = await this.db.user.findUnique({ where: { publicId }, select: { id: true, publicId: true, fullName: true, email: true, countryCode: true, createdAt: true } });
    if (!user) throw new ApiError('NOT_FOUND');
    const kyc = ctx.has('kyc.read');
    const created = rangeWhere(q.range);
    const files = await this.db.upload.findMany({
      where: { ownerUserId: user.id, status: 'uploaded', deletedAt: null, ...(created ? { createdAt: created } : {}), ...(kyc ? {} : { purpose: { notIn: [...KYC_PURPOSES] } }) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    if (files.some((f) => isKyc(f.purpose))) await this.audit.record(ctx, { action: 'kyc.view_image', entityType: 'user', entityId: user.id, entityRef: user.publicId, after: { source: 'media_library' } });
    const counts: Record<string, number> = {};
    const out = files.map((f) => {
      const sensitive = isKyc(f.purpose);
      const image = f.mimeType.startsWith('image/');
      const folder = folderOf(f.purpose);
      counts[folder] = (counts[folder] ?? 0) + 1;
      return {
        id: f.id,
        folder,
        purpose: f.purpose,
        filename: f.originalFilename,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        width_px: f.widthPx,
        height_px: f.heightPx,
        created_at: iso(f.createdAt),
        sensitive,
        url: sensitive ? this.uploads.kycSignedUrl(f.id) : this.uploads.signedUrl(f.id, 'full'),
        // KYC files have no thumbnail; the full (signed, no-store) file is used for the tile.
        thumb_url: sensitive ? (image ? this.uploads.kycSignedUrl(f.id) : null) : image ? this.uploads.signedUrl(f.id, 'thumb') : null,
      };
    });
    return {
      user: { public_id: user.publicId, name: user.fullName, email: user.email, country_code: user.countryCode, joined_at: iso(user.createdAt) },
      folders: [...FOLDERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] ?? 0 })), ...(counts.other ? [{ key: 'other', label: 'Other', count: counts.other }] : [])].filter(
        (f) => f.count > 0 || (f.key === 'kyc' ? kyc : true),
      ),
      kyc_hidden: !kyc,
      can_delete: ctx.has('users.delete'),
      files: out,
      urls_expire_at: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  /**
   * Deletes media by ids, by user folder, by date range, or a mix (all given filters apply).
   * `dry_run` only counts, for the confirm dialog. At least one filter is required.
   */
  async remove(ctx: AdminCtx, b: { ids?: unknown; user?: unknown; range?: unknown; reason?: unknown; dry_run?: unknown }) {
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
    const userRef = typeof b.user === 'string' && b.user.trim() ? b.user.trim() : null;
    const range = typeof b.range === 'string' && b.range ? b.range : undefined;
    if (!ids.length && !userRef && !range) throw new ApiError('VALIDATION_FAILED', 'Pick files, a folder or a date range to delete.');
    const reason = optText(b.reason, 500, 'reason');
    const dry = b.dry_run === true;

    const user = userRef ? await this.db.user.findUnique({ where: { publicId: userRef }, select: { id: true, publicId: true } }) : null;
    if (userRef && !user) throw new ApiError('NOT_FOUND');
    const created = rangeWhere(range);
    const where: Prisma.UploadWhereInput = {
      status: 'uploaded',
      deletedAt: null,
      ownerUserId: user ? user.id : { not: null },
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(created ? { createdAt: created } : {}),
      // Without KYC access, KYC files are never touched.
      ...(ctx.has('kyc.read') ? {} : { purpose: { notIn: [...KYC_PURPOSES] } }),
    };
    const total = await this.db.upload.count({ where });
    const rows = await this.db.upload.findMany({ where, orderBy: { createdAt: 'asc' }, take: DELETE_BATCH });
    const keep = await this.stillNeeded(rows.map((r) => r.id));
    const doomed = rows.filter((r) => !keep.has(r.id));
    const bytes = doomed.reduce((s, r) => s + r.sizeBytes, 0);
    const summary = { matched: total, deleted: doomed.length, skipped: rows.length - doomed.length, freed_bytes: bytes, remaining: Math.max(0, total - rows.length) };
    if (dry) return { ...summary, dry_run: true };

    for (const u of doomed) {
      await this.uploads.purge(u);
    }
    const gone = doomed.map((u) => u.id);
    if (gone.length) {
      // Clear references that would otherwise show a broken image.
      await Promise.all([
        this.db.user.updateMany({ where: { avatarUploadId: { in: gone } }, data: { avatarUploadId: null } }),
        this.db.employerProfile.updateMany({ where: { logoUploadId: { in: gone } }, data: { logoUploadId: null } }),
        this.db.job.updateMany({ where: { thumbnailUploadId: { in: gone } }, data: { thumbnailUploadId: null } }),
      ]);
    }
    await this.audit.record(ctx, {
      action: 'media.delete',
      entityType: user ? 'user' : 'upload',
      entityId: user?.id,
      entityRef: user?.publicId ?? (ids.length === 1 ? ids[0] : null),
      reason,
      after: { ids: ids.length || undefined, user: user?.publicId, range, ...summary },
    });
    return { ...summary, dry_run: false };
  }

  /** Uploads a live process still depends on: pending KYC, proofs under review, open-dispute evidence. */
  private async stillNeeded(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const [kyc, proofs, disputes] = await Promise.all([
      this.db.kycVerification.findMany({
        where: { status: 'pending', OR: [{ frontUploadId: { in: ids } }, { backUploadId: { in: ids } }, { selfieUploadId: { in: ids } }] },
        select: { frontUploadId: true, backUploadId: true, selfieUploadId: true },
      }),
      this.db.submissionProofItem.findMany({
        where: { uploadId: { in: ids }, attempt: { submission: { status: { in: ['in_review', 'needs_fix'] } } } },
        select: { uploadId: true },
      }),
      this.db.dispute.findMany({
        where: { status: { in: ['open', 'under_review'] }, OR: [{ evidenceUploadId: { in: ids } }, { evidenceUpload2Id: { in: ids } }, { evidenceUpload3Id: { in: ids } }] },
        select: { evidenceUploadId: true, evidenceUpload2Id: true, evidenceUpload3Id: true },
      }),
    ]);
    const out = new Set<string>();
    for (const k of kyc) [k.frontUploadId, k.backUploadId, k.selfieUploadId].forEach((x) => x && out.add(x));
    for (const p of proofs) if (p.uploadId) out.add(p.uploadId);
    for (const d of disputes) [d.evidenceUploadId, d.evidenceUpload2Id, d.evidenceUpload3Id].forEach((x) => x && out.add(x));
    return out;
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminMediaController {
  constructor(private readonly svc: AdminMediaService) {}

  @Get('media')
  @Perms('users.read')
  folders(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.folders(ctx, q);
  }

  @Get('media/:publicId')
  @Perms('users.read')
  folder(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Query() q: Q) {
    return this.svc.folder(ctx, id, q);
  }

  @Post('media/delete')
  @HttpCode(200)
  @Perms('users.delete')
  remove(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.remove(ctx, b);
  }
}
