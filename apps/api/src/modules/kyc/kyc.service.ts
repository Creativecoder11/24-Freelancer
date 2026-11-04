import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { formatMoney, initials, type CloseBlocker, type CloseBlockerRow, type KycDocumentType, type KycState, type KycStatus, type UploadPurpose } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { invalidateUserStatus } from '../auth/jwt-auth.guard';
import { UploadsService } from '../uploads/uploads.service';
import { blindIndex, encryptPii } from '../payout-methods/pii.crypto';
import { notifyDirect } from '../payout-methods/direct-notify';

const D = (v: { toString(): string } | null | undefined) => new Decimal((v ?? 0).toString());

/** KYC (Doc 06 §5.3, G-06) plus the account endpoints owned by Settings: avatar, close, employer logo. */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly uploads: UploadsService,
  ) {}

  // ----- KYC -----

  async get(userId: string): Promise<KycState & { attempts_used: number; max_attempts: number }> {
    const [u, latest, attempts, max] = await Promise.all([
      this.prisma.db.user.findUnique({ where: { id: userId }, select: { kycStatus: true, kycVerifiedAt: true } }),
      this.prisma.db.kycVerification.findFirst({ where: { userId }, orderBy: { submittedAt: 'desc' } }),
      this.prisma.db.kycVerification.count({ where: { userId } }),
      this.settings.number('kyc_max_attempts', 3),
    ]);
    if (!u) throw new ApiError('UNAUTHENTICATED');
    const status = u.kycStatus as KycStatus;
    return {
      status,
      document_type: (latest?.documentType as KycDocumentType) ?? null,
      document_last4: latest?.documentLast4 ?? null,
      submitted_at: latest?.submittedAt.toISOString() ?? null,
      review_due_at: latest?.reviewDueAt.toISOString() ?? null,
      verified_at: (u.kycVerifiedAt ?? latest?.verifiedAt)?.toISOString() ?? null,
      rejection_reason: status === 'rejected' ? (latest?.rejectionReason ?? null) : null,
      can_submit: (status === 'not_submitted' || status === 'rejected') && attempts < max,
      attempts_used: attempts,
      max_attempts: max,
    };
  }

  async submit(
    userId: string,
    dto: { document_type: KycDocumentType; name_on_document: string; document_number: string; date_of_birth: string; front_upload_id: string; back_upload_id?: string | null; selfie_upload_id: string },
  ) {
    const max = await this.settings.number('kyc_max_attempts', 3);
    const sla = await this.settings.number('kyc_review_sla_hours', 24);
    const hash = blindIndex(`${dto.document_type}:${dto.document_number}`, 'kyc_document');
    const res = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true } });
      if (u.kycStatus === 'pending') throw new ApiError('KYC_ALREADY_SUBMITTED');
      if (u.kycStatus === 'verified') throw new ApiError('KYC_ALREADY_SUBMITTED', 'Your identity is already verified.');
      const attempts = await tx.kycVerification.count({ where: { userId } });
      if (attempts >= max) throw new ApiError('KYC_ATTEMPTS_EXCEEDED', undefined, undefined, { max_attempts: max });
      const inUse = await tx.kycVerification.findFirst({ where: { documentNumberHash: hash, userId: { not: userId }, status: { in: ['verified', 'pending'] } }, select: { id: true } });
      if (inUse) throw new ApiError('KYC_DOCUMENT_IN_USE', undefined, { document_number: ['This document is already used by another account.'] });
      const doc: UploadPurpose[] = ['kyc_document'];
      await this.uploads.requireReady(tx, userId, dto.front_upload_id, doc, 'front_upload_id');
      if (dto.back_upload_id) await this.uploads.requireReady(tx, userId, dto.back_upload_id, doc, 'back_upload_id');
      await this.uploads.requireReady(tx, userId, dto.selfie_upload_id, ['kyc_selfie'], 'selfie_upload_id');
      const now = new Date();
      const row = await tx.kycVerification.create({
        data: {
          userId,
          documentType: dto.document_type,
          status: 'pending',
          frontUploadId: dto.front_upload_id,
          backUploadId: dto.document_type === 'passport' ? null : (dto.back_upload_id ?? null),
          selfieUploadId: dto.selfie_upload_id,
          documentNumberEnc: encryptPii(dto.document_number),
          documentNumberHash: hash,
          documentLast4: dto.document_number.slice(-4),
          nameOnDocument: dto.name_on_document.trim().slice(0, 80),
          dateOfBirthEnc: encryptPii(dto.date_of_birth),
          submittedAt: now,
          reviewDueAt: new Date(now.getTime() + sla * 3_600_000),
        },
      });
      await this.uploads.markClaimed(tx, [dto.front_upload_id, dto.back_upload_id, dto.selfie_upload_id].filter((x): x is string => !!x));
      await tx.user.update({ where: { id: userId }, data: { kycStatus: 'pending', updatedAt: now } });
      return row;
    });
    return { status: 'pending' as const, document_type: dto.document_type, submitted_at: res.submittedAt.toISOString(), review_due_at: res.reviewDueAt.toISOString() };
  }

  // ----- Avatar (POST /me/avatar) -----

  async setAvatar(userId: string, uploadId: string | null) {
    const res = await this.prisma.db.$transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarUploadId: true, fullName: true } });
      if (uploadId) {
        await this.uploads.requireReady(tx, userId, uploadId, ['avatar'], 'upload_id');
        await this.uploads.markClaimed(tx, [uploadId]);
      }
      if (u.avatarUploadId && u.avatarUploadId !== uploadId) {
        await tx.upload.update({ where: { id: u.avatarUploadId }, data: { deleteAfter: new Date(Date.now() + 24 * 3_600_000) } });
      }
      await tx.user.update({ where: { id: userId }, data: { avatarUploadId: uploadId, updatedAt: new Date() } });
      return u;
    });
    return { avatar_url: uploadId ? this.uploads.signedUrl(uploadId, 'full') : null, initials: initials(res.fullName) };
  }

  // ----- Employer logo (POST /employer/profile/logo) -----

  async logo(userId: string) {
    const p = await this.prisma.db.employerProfile.findUnique({ where: { userId }, select: { logoUploadId: true } });
    return { logo_url: p?.logoUploadId ? this.uploads.signedUrl(p.logoUploadId, 'full') : null };
  }

  async setLogo(userId: string, uploadId: string | null) {
    await this.prisma.db.$transaction(async (tx) => {
      const p = await tx.employerProfile.findUnique({ where: { userId }, select: { logoUploadId: true } });
      if (!p) throw new ApiError('NOT_FOUND', 'Switch to employer mode first.');
      if (uploadId) {
        await this.uploads.requireReady(tx, userId, uploadId, ['employer_logo'], 'upload_id');
        await this.uploads.markClaimed(tx, [uploadId]);
      }
      if (p.logoUploadId && p.logoUploadId !== uploadId) await tx.upload.update({ where: { id: p.logoUploadId }, data: { deleteAfter: new Date(Date.now() + 24 * 3_600_000) } });
      await tx.employerProfile.update({ where: { userId }, data: { logoUploadId: uploadId, updatedAt: new Date() } });
    });
    return { logo_url: uploadId ? this.uploads.signedUrl(uploadId, 'full') : null };
  }

  // ----- Close account (POST /me/close) -----

  async blockers(userId: string): Promise<CloseBlockerRow[]> {
    const db = this.prisma.db;
    const [wallets, inFlight, reservations, submissions, jobs] = await Promise.all([
      db.walletAccount.findMany({ where: { ownerUserId: userId }, select: { kind: true, balanceCached: true } }),
      db.withdrawal.count({ where: { userId, status: { in: ['requested', 'processing'] } } }),
      db.slotReservation.count({ where: { workerUserId: userId, status: 'active' } }),
      db.submission.count({ where: { OR: [{ workerUserId: userId }, { employerUserId: userId }], AND: [{ OR: [{ status: { in: ['in_review', 'needs_fix'] } }, { disputeOpen: true }] }] } }),
      db.job.count({ where: { employerUserId: userId, status: { in: ['running', 'paused'] } } }),
    ]);
    const bal = (k: string) => D(wallets.find((w) => w.kind === k)?.balanceCached);
    const out: CloseBlockerRow[] = [];
    const add = (code: CloseBlocker, message: string, action_path: string) => out.push({ code, message, action_path });
    if (bal('worker_earnings').gte(0.01)) add('worker_balance', `You still have ${formatMoney(bal('worker_earnings').toFixed(2))} available.`, '/worker/wallet/withdraw');
    if (inFlight) add('withdrawals_in_flight', `${inFlight} withdrawal${inFlight === 1 ? ' is' : 's are'} still on the way.`, '/worker/wallet/withdrawals?tab=processing');
    if (reservations) add('active_reservations', `You have ${reservations} job${reservations === 1 ? '' : 's'} in progress.`, '/worker/tasks');
    if (submissions) add('open_submissions', `${submissions} submission${submissions === 1 ? ' is' : 's are'} still in review, needs a fix or is disputed.`, '/worker/tasks');
    if (jobs) add('open_jobs', `You have ${jobs} running or paused job${jobs === 1 ? '' : 's'}. Close them first.`, '/employer/jobs');
    if (bal('employer_available').gte(0.01)) add('employer_balance', `Your deposit still holds ${formatMoney(bal('employer_available').toFixed(2))}.`, '/employer/wallet');
    if (bal('employer_reserved').gte(0.01)) add('employer_reserved', `${formatMoney(bal('employer_reserved').toFixed(2))} is reserved for jobs.`, '/employer/jobs');
    return out;
  }

  async close(userId: string, dto: { dry_run: boolean; password?: string; confirm_text?: string; reason?: string }) {
    const blockers = await this.blockers(userId);
    if (dto.dry_run) return { can_close: blockers.length === 0, blockers };
    await this.passwords.verifyForSensitiveAction(userId, dto.password, 'close_account', 'password');
    if (blockers.length) throw new ApiError('CLOSE_BLOCKED', `You can’t close this account yet: ${blockers[0]!.message}`, undefined, { blockers });
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'closed', closedAt: now, updatedAt: now } });
      await tx.payoutMethod.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now, isDefault: false } });
      await notifyDirect(tx, { userId, type: 'account_closed', category: 'system', title: 'Your account is closed', body: dto.reason ? `Reason you gave: ${dto.reason.slice(0, 200)}` : 'We’re sorry to see you go.', mandatory: true });
    });
    await this.sessions.revokeAll(userId, 'account_closed');
    await invalidateUserStatus(this.redis, userId);
    return { status: 'closed' as const, closed_at: now.toISOString() };
  }
}
