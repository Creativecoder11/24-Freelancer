import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { SettingsService } from '../../settings/settings.service';
import { UploadsService } from '../../uploads/uploads.service';
import { LedgerService } from '../../ledger/ledger.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { bool, iso, needEnum, needReason, needText, paged, paging, type Q } from '../core/helpers';

const KYC_CODES = ['document_unreadable', 'name_mismatch', 'document_expired', 'selfie_mismatch', 'other'] as const;

function nameScore(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const x = new Set(norm(a));
  const y = norm(b);
  if (!x.size || !y.length) return null;
  const hit = y.filter((w) => x.has(w)).length;
  return (hit / Math.max(x.size, y.length)).toFixed(2);
}

/** KYC review and employer verification (Doc 06 §6.4; Doc 09 SCR-ADM-05/06, §8). */
@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly uploads: UploadsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const status = (q.status ?? 'pending') as Prisma.EnumKycStatusFilter['equals'];
    const where: Prisma.KycVerificationWhereInput = { status };
    if (bool(q.overdue)) Object.assign(where, { status: 'pending', reviewDueAt: { lt: new Date() } });
    const full = ctx.has('kyc.read');
    const [rows, total, counts] = await Promise.all([
      this.db.kycVerification.findMany({ where, orderBy: status === 'pending' ? { reviewDueAt: 'asc' } : { reviewedAt: 'desc' }, skip: p.skip, take: p.take, include: { user: { select: { publicId: true } } } }),
      this.db.kycVerification.count({ where }),
      this.db.kycVerification.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const dupHashes = rows.length
      ? await this.db.kycVerification.groupBy({ by: ['documentNumberHash'], where: { documentNumberHash: { in: rows.map((r) => r.documentNumberHash) } }, _count: { userId: true } })
      : [];
    const dupSet = new Set<string>();
    for (const g of dupHashes) {
      if (g._count.userId < 2) continue;
      const users = await this.db.kycVerification.findMany({ where: { documentNumberHash: g.documentNumberHash }, distinct: ['userId'], select: { userId: true } });
      if (users.length > 1) dupSet.add(Buffer.from(g.documentNumberHash).toString('hex'));
    }
    const c = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
    return paged(
      rows.map((k) => ({
        id: k.id,
        user_public_id: k.user.publicId,
        name_on_document: full ? k.nameOnDocument : null,
        document_type: k.documentType,
        document_last4: full ? k.documentLast4 : null,
        status: k.status,
        submitted_at: iso(k.submittedAt),
        review_due_at: iso(k.reviewDueAt),
        reviewed_at: iso(k.reviewedAt),
        duplicate_warning: dupSet.has(Buffer.from(k.documentNumberHash).toString('hex')),
      })),
      total,
      p,
      { counts: { pending: c('pending'), verified: c('verified'), rejected: c('rejected') } },
    );
  }

  async detail(ctx: AdminCtx, id: string) {
    const k = await this.db.kycVerification.findUnique({ where: { id }, include: { user: { select: { id: true, publicId: true, fullName: true, countryCode: true } }, reviewedByAdmin: { select: { fullName: true } } } });
    if (!k) throw new ApiError('NOT_FOUND');
    const dups = await this.db.kycVerification.findMany({ where: { documentNumberHash: k.documentNumberHash, userId: { not: k.userId } }, distinct: ['userId'], include: { user: { select: { publicId: true } } } });
    const purged = !!k.purgedAt;
    const url = (u: string | null) => (u && !purged ? this.uploads.signedUrl(u, 'full') : null);
    const recent = await this.db.auditLog.findFirst({ where: { action: 'kyc.view_image', entityId: k.id, actorAdminId: { not: ctx.id }, createdAt: { gt: new Date(Date.now() - 5 * 60_000) } }, include: { actorAdmin: { select: { fullName: true } } } });
    if (!purged) await this.audit.record(ctx, { action: 'kyc.view_image', entityType: 'kyc_verification', entityId: k.id, entityRef: k.user.publicId });
    return {
      id: k.id,
      user: { public_id: k.user.publicId, full_name: k.user.fullName, country_code: k.user.countryCode },
      name_on_document: k.nameOnDocument,
      name_match_score: nameScore(k.nameOnDocument, k.user.fullName),
      document_type: k.documentType,
      document_last4: k.documentLast4,
      front_url: url(k.frontUploadId),
      back_url: url(k.backUploadId),
      selfie_url: url(k.selfieUploadId),
      urls_expire_at: new Date(Date.now() + 300_000).toISOString(),
      status: k.status,
      rejection_reason_code: k.rejectionReasonCode,
      rejection_reason: k.rejectionReason,
      duplicate_accounts: dups.map((d) => d.user.publicId),
      submitted_at: iso(k.submittedAt),
      review_due_at: iso(k.reviewDueAt),
      reviewed_at: iso(k.reviewedAt),
      reviewed_by: k.reviewedByAdmin?.fullName ?? null,
      purged,
      also_viewing: recent?.actorAdmin?.fullName ?? null,
    };
  }

  /** BR-073: commissions waiting on this user's verification are credited. */
  private async creditPending(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.referralCommission.findMany({ where: { status: 'pending', OR: [{ referrerUserId: userId }, { referredUserId: userId }] } });
    for (const c of rows) {
      const exp = await this.ledger.systemAccount('referral_expense', tx);
      const acc = await this.ledger.userAccount(c.referrerUserId, 'worker_earnings', tx);
      const t = await this.ledger.post({ type: 'referral_commission', idempotencyKey: `referral:${c.id}:credit`, description: { source: c.sourceType }, refs: { referralCommissionId: c.id }, lines: [ { accountId: exp.id, amount: new Decimal(c.amount.toString()).neg().toFixed(6) }, { accountId: acc.id, amount: new Decimal(c.amount.toString()).toFixed(6) } ] }, tx);
      await tx.referralCommission.update({ where: { id: c.id }, data: { status: 'credited', creditedAt: new Date(), ledgerTxId: t.id } });
    }
    return rows.length;
  }

  async approve(ctx: AdminCtx, id: string) {
    const years = await this.settings.number('kyc_retention_years', 5);
    const out = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM kyc_verifications WHERE id = ${id}::uuid FOR UPDATE`;
      const k = await tx.kycVerification.findUnique({ where: { id }, include: { user: { select: { publicId: true } } } });
      if (!k) throw new ApiError('NOT_FOUND');
      if (k.status !== 'pending') throw new ApiError('ALREADY_DECIDED', 'This identity check was already decided.');
      const now = new Date();
      await tx.kycVerification.update({ where: { id }, data: { status: 'verified', verifiedAt: now, reviewedAt: now, reviewedByAdminId: ctx.id, retainUntil: new Date(now.getTime() + years * 365 * 86_400_000) } });
      await tx.user.update({ where: { id: k.userId }, data: { kycStatus: 'verified', kycVerifiedAt: now } });
      const credited = await this.creditPending(tx, k.userId);
      await this.audit.record(ctx, { action: 'kyc.approve', entityType: 'kyc_verification', entityId: id, entityRef: k.user.publicId, before: { status: 'pending' }, after: { status: 'verified', commissions_credited: credited } }, tx);
      return { k, now };
    });
    await this.notify.user(out.k.userId, { type: 'kyc_verified', audience: 'worker', title: 'Account verified', body: "You can now withdraw to any method you've added.", mandatory: true, linkPath: '/worker/wallet' });
    return { id, status: 'verified', verified_at: out.now.toISOString() };
  }

  async reject(ctx: AdminCtx, id: string, b: Record<string, unknown>, revoke = false) {
    const code = needEnum(b.reason_code, KYC_CODES, 'reason_code');
    const reason = needText(b.reason, 300, 'reason', 'Enter a reason. The user sees it.');
    const out = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM kyc_verifications WHERE id = ${id}::uuid FOR UPDATE`;
      const k = await tx.kycVerification.findUnique({ where: { id }, include: { user: { select: { publicId: true } } } });
      if (!k) throw new ApiError('NOT_FOUND');
      if (revoke ? k.status !== 'verified' : k.status !== 'pending') throw new ApiError(revoke ? 'INVALID_STATE' : 'ALREADY_DECIDED', revoke ? 'Only verified checks can be revoked.' : 'This identity check was already decided.');
      const now = new Date();
      await tx.kycVerification.update({ where: { id }, data: { status: 'rejected', verifiedAt: null, reviewedAt: now, reviewedByAdminId: ctx.id, rejectionReasonCode: code, rejectionReason: reason } });
      await tx.user.update({ where: { id: k.userId }, data: { kycStatus: 'rejected', ...(revoke ? { kycVerifiedAt: null } : {}) } });
      let held = 0;
      if (revoke) {
        const far = new Date(Date.now() + 100 * 365 * 86_400_000);
        const r = await tx.withdrawal.updateMany({ where: { userId: k.userId, status: 'requested' }, data: { holdUntil: far } });
        held = r.count;
      }
      await this.audit.record(ctx, { action: revoke ? 'kyc.revoke' : 'kyc.reject', entityType: 'kyc_verification', entityId: id, entityRef: k.user.publicId, reason, before: { status: k.status }, after: { status: 'rejected', reason_code: code, withdrawals_held: held } }, tx);
      return { k, now };
    });
    await this.notify.user(out.k.userId, { type: 'kyc_rejected', audience: 'worker', title: revoke ? 'Your verification was revoked' : "We couldn't verify your identity", body: reason, mandatory: true, linkPath: '/worker/settings' });
    return revoke ? { id, status: 'rejected', revoked_at: out.now.toISOString() } : { id, status: 'rejected', rejection_reason: reason };
  }

  // ------------------------------------------------------------------ employers

  async employers(q: Q) {
    const p = paging(q);
    const status = (q.status ?? 'pending') as Prisma.EnumEmployerVerificationStatusFilter['equals'];
    const where: Prisma.EmployerProfileWhereInput = { verificationStatus: status };
    const [rows, total, counts] = await Promise.all([
      this.db.employerProfile.findMany({ where, orderBy: { verificationSubmittedAt: 'asc' }, skip: p.skip, take: p.take, include: { user: { select: { publicId: true, createdAt: true, status: true } } } }),
      this.db.employerProfile.count({ where }),
      this.db.employerProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    ]);
    const ids = rows.map((r) => r.userId);
    const deps = ids.length ? await this.db.deposit.groupBy({ by: ['employerUserId'], where: { employerUserId: { in: ids }, status: 'completed' }, _count: { _all: true } }) : [];
    const c = (s: string) => counts.find((x) => x.verificationStatus === s)?._count._all ?? 0;
    return paged(
      rows.map((e) => ({
        public_id: e.user.publicId,
        business_name: e.businessName,
        website_url: e.websiteUrl,
        billing_email: e.billingEmail,
        industry: e.industry,
        about: e.about,
        verification_status: e.verificationStatus,
        verification_submitted_at: iso(e.verificationSubmittedAt),
        employer_verified_at: iso(e.employerVerifiedAt),
        verification_note: e.verificationNote,
        member_since: iso(e.user.createdAt),
        account_status: e.user.status,
        jobs_posted: e.jobsPostedCount,
        deposits_completed: deps.find((d) => d.employerUserId === e.userId)?._count._all ?? 0,
      })),
      total,
      p,
      { counts: { pending: c('pending'), verified: c('verified'), rejected: c('rejected') } },
    );
  }

  private async employer(publicId: string) {
    const u = await this.db.user.findUnique({ where: { publicId }, include: { employerProfile: true } });
    if (!u?.employerProfile) throw new ApiError('NOT_FOUND', `We can't find employer ${publicId}.`);
    return { u, e: u.employerProfile };
  }

  async verify(ctx: AdminCtx, publicId: string) {
    const { u, e } = await this.employer(publicId);
    if (e.verificationStatus !== 'pending') throw new ApiError('ALREADY_DECIDED', 'This employer was already decided.');
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.employerProfile.update({ where: { userId: u.id }, data: { verificationStatus: 'verified', employerVerifiedAt: now, verificationNote: null } });
      await this.audit.record(ctx, { action: 'employer.verify', entityType: 'employer_profile', entityId: u.id, entityRef: publicId, before: { verification_status: e.verificationStatus }, after: { verification_status: 'verified', employer_verified_at: now } }, tx);
    });
    await this.notify.user(u.id, { type: 'employer_verified', audience: 'employer', title: 'You are a verified employer', body: 'Workers now see the "Verified employer" badge on your jobs.' });
    return { public_id: publicId, verification_status: 'verified', employer_verified_at: now.toISOString() };
  }

  async rejectEmployer(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason, 500);
    const { u, e } = await this.employer(publicId);
    if (e.verificationStatus !== 'pending') throw new ApiError('ALREADY_DECIDED', 'This employer was already decided.');
    await this.db.$transaction(async (tx) => {
      await tx.employerProfile.update({ where: { userId: u.id }, data: { verificationStatus: 'rejected', verificationNote: reason } });
      await this.audit.record(ctx, { action: 'employer.reject_verification', entityType: 'employer_profile', entityId: u.id, entityRef: publicId, reason, before: { verification_status: e.verificationStatus }, after: { verification_status: 'rejected' } }, tx);
    });
    await this.notify.user(u.id, { type: 'employer_verification_rejected', audience: 'employer', title: "We couldn't verify your business", body: reason, linkPath: '/employer/settings' });
    return { public_id: publicId, verification_status: 'rejected', verification_note: reason };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminKycController {
  constructor(private readonly svc: AdminKycService) {}

  @Get('kyc')
  @Perms('kyc.read_status', 'kyc.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('kyc/:id')
  @Perms('kyc.read')
  detail(@Admin() ctx: AdminCtx, @Param('id') id: string) {
    return this.svc.detail(ctx, id);
  }

  @Post('kyc/:id/approve')
  @HttpCode(200)
  @Perms('kyc.decide')
  approve(@Admin() ctx: AdminCtx, @Param('id') id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post('kyc/:id/reject')
  @HttpCode(200)
  @Perms('kyc.decide')
  reject(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reject(ctx, id, b ?? {});
  }

  @Post('kyc/:id/revoke')
  @HttpCode(200)
  @Perms('kyc.decide')
  @Reauth()
  revoke(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reject(ctx, id, b ?? {}, true);
  }

  @Get('employers/verification')
  @Perms('employers.verify')
  employers(@Query() q: Q) {
    return this.svc.employers(q);
  }

  @Post('employers/:publicId/verify')
  @HttpCode(200)
  @Perms('employers.verify')
  verify(@Admin() ctx: AdminCtx, @Param('publicId') id: string) {
    return this.svc.verify(ctx, id);
  }

  @Post('employers/:publicId/reject-verification')
  @HttpCode(200)
  @Perms('employers.verify')
  rejectEmployer(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.rejectEmployer(ctx, id, b ?? {});
  }
}

void maskName;
