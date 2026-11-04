import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { EmployerCore, unitCost } from '../../employer/employer-common';
import { ApprovalService } from '../../review/approval.service';
import { UploadsService } from '../../uploads/uploads.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { bool, dec, iso, m3, m6, needEnum, needReason, needText, paged, paging, pd, type Q } from '../core/helpers';

const REJECT_CODES = ['proof_incomplete', 'steps_not_followed', 'wrong_or_copied', 'link_not_accessible', 'other'] as const;
type PaidFrom = 'job_reserve' | 'employer_available' | 'adjustments';

/**
 * Submissions and disputes (Doc 06 §6.6, §6.7; Doc 09 §10, §11). Payment outside the normal
 * review path follows the D-13 order: job reserve, then employer available, then the platform
 * (`adjustments`) with an employer receivable (A-47).
 */
@Injectable()
export class AdminWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: EmployerCore,
    private readonly approval: ApprovalService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** Where a payout for a not-in-review submission comes from (Doc 09 §11.2). */
  async previewSource(sub: { status: string; jobId: string; rewardUsd: Prisma.Decimal; feeUsd: Prisma.Decimal }): Promise<PaidFrom> {
    const job = await this.db.job.findUniqueOrThrow({ where: { id: sub.jobId } });
    const cost = dec(sub.rewardUsd).plus(dec(sub.feeUsd));
    if (sub.status === 'in_review' || sub.status === 'needs_fix') {
      if (dec(job.reserveOutstandingUsd).gte(cost)) return 'job_reserve';
    }
    const { available } = await this.core.balances(job.employerUserId);
    return available.gte(cost) ? 'employer_available' : 'adjustments';
  }

  /** Pays a needs_fix / rejected submission (admin override or dispute win). */
  private async payOutside(tx: Prisma.TransactionClient, ctx: AdminCtx, subId: string, key: string, refs: { disputeId?: string }) {
    await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${subId}::uuid FOR UPDATE`;
    const sub = await tx.submission.findUniqueOrThrow({ where: { id: subId } });
    if (sub.status === 'approved') throw new ApiError('ALREADY_DECIDED');
    const job = await this.core.lockJob(tx, sub.jobId);
    const reward = dec(sub.rewardUsd);
    const cost = reward.plus(dec(sub.feeUsd));
    const earnings = await this.core.ledger.userAccount(sub.workerUserId, 'worker_earnings', tx);
    const profile = await tx.employerProfile.findUnique({ where: { userId: job.employerUserId }, select: { businessName: true } });
    let from: PaidFrom;
    let ltx;
    const desc = { title: job.title, employer: profile?.businessName ?? null, decision_source: 'admin' };
    if (sub.status === 'needs_fix' && dec(job.reserveOutstandingUsd).gte(cost)) {
      from = 'job_reserve';
      const reserved = await this.core.ledger.userAccount(job.employerUserId, 'employer_reserved', tx);
      ltx = await this.core.ledger.post({ type: 'job_spend', idempotencyKey: key, actor: 'admin', adminId: ctx.id, description: desc, refs: { jobId: job.id, submissionId: sub.id, disputeId: refs.disputeId }, lines: [ { accountId: reserved.id, amount: reward.neg().toFixed(6), displayType: 'job_spend' }, { accountId: earnings.id, amount: reward.toFixed(6), displayType: 'task_reward' } ] }, tx);
      await tx.job.update({ where: { id: job.id }, data: { reserveOutstandingUsd: { decrement: pd(reward) }, spentUsd: { increment: pd(reward) } } });
    } else {
      const acc = await this.core.lockAccounts(job.employerUserId, tx);
      if (acc.availableBal.gte(reward)) {
        from = 'employer_available';
        ltx = await this.core.ledger.post({ type: 'task_reward', idempotencyKey: key, actor: 'admin', adminId: ctx.id, description: desc, refs: { jobId: job.id, submissionId: sub.id, disputeId: refs.disputeId }, lines: [ { accountId: acc.available.id, amount: reward.neg().toFixed(6), displayType: 'job_spend' }, { accountId: earnings.id, amount: reward.toFixed(6), displayType: 'task_reward' } ] }, tx);
        await tx.job.update({ where: { id: job.id }, data: { spentUsd: { increment: pd(reward) } } });
      } else {
        from = 'adjustments';
        const adj = await this.core.ledger.systemAccount('adjustments', tx);
        ltx = await this.core.ledger.post({ type: 'task_reward', idempotencyKey: key, actor: 'admin', adminId: ctx.id, description: { ...desc, receivable: true }, refs: { jobId: job.id, submissionId: sub.id, disputeId: refs.disputeId }, lines: [ { accountId: adj.id, amount: reward.neg().toFixed(6) }, { accountId: earnings.id, amount: reward.toFixed(6), displayType: 'task_reward' } ] }, tx);
        await tx.employerProfile.update({ where: { userId: job.employerUserId }, data: { receivableUsd: { increment: pd(reward) } } });
      }
    }
    const now = new Date();
    const leave = sub.status === 'needs_fix' ? { countNeedsFix: { decrement: 1 } } : { countRejected: { decrement: 1 } };
    await tx.job.update({ where: { id: job.id }, data: { ...leave, countApproved: { increment: 1 } } });
    await tx.submission.update({ where: { id: sub.id }, data: { status: 'approved', decidedAt: now, finalAt: now, decisionSource: 'admin', decidedByAdminId: ctx.id, rejectionReasonCode: null, rejectionReasonText: null, fixAllowed: null, resubmitDeadline: null, paidLedgerTxId: ltx.id, disputeOpen: false } });
    await tx.submissionAttempt.updateMany({ where: { submissionId: sub.id, attemptNo: sub.currentAttemptNo }, data: { decision: 'approved', decidedAt: now } });
    await tx.submissionEvent.createMany({ data: [ { reservationId: sub.reservationId, submissionId: sub.id, eventType: 'approved', actorType: 'admin', actorAdminId: ctx.id }, { reservationId: sub.reservationId, submissionId: sub.id, eventType: 'paid_to_balance', actorType: 'admin', actorAdminId: ctx.id, data: { amount: reward.toFixed(6), paid_from: from } } ] });
    return { from, ltx, outcome: { alreadyApproved: false, submissionId: sub.id, ref: sub.publicRef, rewardUsd: reward, feeUsd: dec(sub.feeUsd), ledgerRef: ltx.publicRef ?? null, jobId: job.id, workerUserId: sub.workerUserId } };
  }

  // ------------------------------------------------------------------ submissions

  async list(q: Q) {
    const p = paging(q);
    const where: Prisma.SubmissionWhereInput = {};
    const term = (q.q ?? '').trim().toUpperCase();
    if (term) where.OR = [{ publicRef: term }, { job: { publicId: term } }, { workerUser: { publicId: term } }];
    if (q.ref) where.publicRef = q.ref;
    if (q.status) where.status = q.status as Prisma.EnumSubmissionStatusFilter['equals'];
    if (q.job) where.job = { publicId: q.job };
    if (q.worker) where.workerUser = { publicId: q.worker };
    const esc = bool(q.escalated);
    if (esc) Object.assign(where, { status: 'in_review', escalatedAt: { not: null } });
    const orderBy: Prisma.SubmissionOrderByWithRelationInput = esc ? { escalatedAt: 'asc' } : q.sort === 'submitted_at' ? { lastSubmittedAt: 'asc' } : { lastSubmittedAt: 'desc' };
    const [rows, total, escalated] = await Promise.all([
      this.db.submission.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { job: { select: { publicId: true, title: true } }, workerUser: { select: { publicId: true, fullName: true } }, employerUser: { select: { employerProfile: { select: { businessName: true } } } }, dispute: { select: { publicRef: true, status: true } } } }),
      this.db.submission.count({ where }),
      this.db.submission.count({ where: { status: 'in_review', escalatedAt: { not: null } } }),
    ]);
    return paged(
      rows.map((s) => ({
        ref: s.publicRef,
        job_public_id: s.job.publicId,
        job_title: s.job.title,
        worker_public_id: s.workerUser.publicId,
        worker_name_masked: maskName(s.workerUser.fullName),
        employer_name: s.employerUser.employerProfile?.businessName ?? null,
        status: s.status,
        reward_usd: m3(s.rewardUsd),
        submitted_at: iso(s.lastSubmittedAt),
        review_due_at: iso(s.reviewDueAt),
        escalated_at: iso(s.escalatedAt),
        dispute_open: s.disputeOpen,
        dispute_ref: s.dispute?.publicRef ?? null,
      })),
      total,
      p,
      { counts: { escalated } },
    );
  }

  private async attempts(subId: string, ctx: AdminCtx, ref: string) {
    const atts = await this.db.submissionAttempt.findMany({ where: { submissionId: subId }, orderBy: { attemptNo: 'asc' }, include: { submissionProofItems: { include: { proofRequirement: { select: { title: true } }, upload: { select: { id: true, status: true, deletedAt: true, mimeType: true, originalFilename: true } } } } } });
    let signed = 0;
    const out = atts.map((a) => ({
      attempt_no: a.attemptNo,
      worker_note: a.workerNote,
      change_note: a.changeNote,
      submitted_at: iso(a.submittedAt),
      decision: a.decision,
      rejection_reason_code: a.rejectionReasonCode,
      rejection_reason_text: a.rejectionReasonText,
      auto_check: a.autoCheck,
      proof_items: a.submissionProofItems.map((p) => {
        const usable = p.upload && !p.upload.deletedAt && p.upload.status === 'uploaded';
        if (usable) signed++;
        return {
          proof_type: p.proofType,
          title: p.proofRequirement.title,
          link_url: p.linkUrl,
          link_check_status: p.linkCheckStatus,
          text_value: p.textValue,
          file_name: p.upload?.originalFilename ?? null,
          mime_type: p.upload?.mimeType ?? null,
          file_url: usable ? this.uploads.signedUrl(p.upload!.id, 'full') : null,
          file_unavailable: !!p.upload && !usable,
        };
      }),
    }));
    if (signed) await this.audit.safe(ctx, { action: 'submission.view_proof', entityType: 'submission', entityId: subId, entityRef: ref, after: { files: signed } });
    return out;
  }

  async detail(ctx: AdminCtx, ref: string) {
    const s = await this.db.submission.findUnique({
      where: { publicRef: ref },
      include: { job: { include: { jobSteps: { orderBy: { position: 'asc' } } } }, workerUser: { select: { publicId: true, fullName: true } }, paidLedgerTx: { select: { publicRef: true } }, dispute: { select: { publicRef: true, status: true } }, submissionEvents: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!s) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    return {
      ref: s.publicRef,
      status: s.status,
      decision_source: s.decisionSource,
      reward_usd: m3(s.rewardUsd),
      worker_public_id: s.workerUser.publicId,
      worker_name_masked: maskName(s.workerUser.fullName),
      job: { public_id: s.job.publicId, title: s.job.title, steps: s.job.jobSteps.map((x) => x.body) },
      review_due_at: iso(s.reviewDueAt),
      escalated_at: iso(s.escalatedAt),
      dispute_open: s.disputeOpen,
      dispute_ref: s.dispute?.publicRef ?? null,
      duplicate_suspected: s.duplicateSuspected,
      rejection_reason_code: s.rejectionReasonCode,
      rejection_reason_text: s.rejectionReasonText,
      attempts: await this.attempts(s.id, ctx, s.publicRef),
      events: s.submissionEvents.map((e) => ({ event_type: e.eventType, actor_type: e.actorType, occurred_at: iso(e.occurredAt), data: e.data })),
      paid_ledger_ref: s.paidLedgerTx?.publicRef ?? null,
      payment_preview: s.status === 'approved' ? null : { source: await this.previewSource(s), amount_usd: m3(s.rewardUsd) },
    };
  }

  async override(ctx: AdminCtx, ref: string, b: Record<string, unknown>, res: Response) {
    const outcome = needEnum(b.outcome, ['approved', 'rejected'] as const, 'outcome');
    const reason = needReason(b.reason, 300);
    const s = await this.db.submission.findUnique({ where: { publicRef: ref } });
    if (!s) throw new ApiError('NOT_FOUND');
    if (s.disputeOpen) throw new ApiError('INVALID_STATE', 'Decide this through the dispute.');
    if (outcome === 'approved') {
      if (s.status === 'approved') throw new ApiError('ALREADY_DECIDED');
      if (s.status === 'in_review') {
        const o = await this.db.$transaction(async (tx) => {
          const o = await this.approval.approveInTx(tx, s.id, 'admin', {});
          await tx.submission.update({ where: { id: s.id }, data: { decidedByAdminId: ctx.id } });
          await this.audit.record(ctx, { action: 'submission.admin_decide', entityType: 'submission', entityId: s.id, entityRef: s.publicRef, reason, before: { status: s.status }, after: { status: 'approved', decision_source: 'admin', ledger_ref: o.ledgerRef } }, tx);
          return o;
        });
        await this.approval.afterApproval(o, 'admin');
        return { ref, status: 'approved', decision_source: 'admin', ledger_ref: o.ledgerRef };
      }
      const r = await this.db.$transaction(async (tx) => {
        const r = await this.payOutside(tx, ctx, s.id, `submission:${s.publicRef}:admin-approve`, {});
        await this.audit.record(ctx, { action: 'submission.admin_decide', entityType: 'submission', entityId: s.id, entityRef: s.publicRef, reason, before: { status: s.status }, after: { status: 'approved', paid_from: r.from, ledger_ref: r.ltx.publicRef } }, tx);
        return r;
      });
      await this.approval.afterApproval(r.outcome, 'admin');
      return { ref, status: 'approved', decision_source: 'admin', paid_from: r.from, ledger_ref: r.ltx.publicRef };
    }
    const code = needEnum(b.reason_code, REJECT_CODES, 'reason_code');
    if (reason.length < 10) throw new ApiError('VALIDATION_FAILED', undefined, { reason: ['Enter 10 to 300 characters.'] });
    if (s.status === 'approved') {
      // Overturn a paid approval (Doc 09 §10.3): system-created adjustment for a second admin.
      const r = await this.db.$transaction(async (tx) => {
        const acc = await this.core.ledger.userAccount(s.workerUserId, 'worker_earnings', tx);
        const lar = await tx.ledgerAdjustmentRequest.create({
          data: { accountId: acc.id, amount: pd(dec(s.rewardUsd).neg()), reasonCode: 'correction', internalNote: `Overturn ${s.publicRef}: ${reason}`.slice(0, 1000), visibleText: `Reversed approval ${s.publicRef}`, createdByAdminId: ctx.id, expiresAt: new Date(Date.now() + 72 * 3600_000) },
        });
        await tx.adminPendingAction.create({ data: { action: 'submission.overturn', objectType: 'ledger_adjustment', objectId: lar.id, payload: { submission_id: s.id, submission_ref: s.publicRef, reason_code: code, reason }, reason, idempotencyKey: `overturn:${s.publicRef}`, createdByAdminId: ctx.id } });
        await tx.submissionEvent.create({ data: { reservationId: s.reservationId, submissionId: s.id, eventType: 'rejected', actorType: 'admin', actorAdminId: ctx.id, data: { intent: 'overturn_pending', adjustment_id: lar.id } } });
        await this.audit.record(ctx, { action: 'ledger.adjust_request', entityType: 'ledger_adjustment_request', entityId: lar.id, entityRef: s.publicRef, reason, after: { amount: m6(lar.amount), account: 'worker_earnings', reason_code: 'correction', overturn: s.publicRef } }, tx);
        return lar;
      });
      res.status(202);
      return { status: 'pending_approval', action: 'submission.overturn', adjustment_id: r.id, requested_by: ctx.shortName, approve_path: `/admin/ledger/adjustments/${r.id}/approve` };
    }
    if (s.status !== 'in_review' && s.status !== 'needs_fix') throw new ApiError('ALREADY_DECIDED');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${s.id}::uuid FOR UPDATE`;
      const job = await this.core.lockJob(tx, s.jobId);
      const now = new Date();
      await tx.submission.update({ where: { id: s.id }, data: { status: 'rejected', decidedAt: now, finalAt: now, decisionSource: 'admin', decidedByAdminId: ctx.id, rejectionReasonCode: code, rejectionReasonText: reason, fixAllowed: false, resubmitDeadline: null } });
      await tx.submissionAttempt.updateMany({ where: { submissionId: s.id, attemptNo: s.currentAttemptNo }, data: { decision: 'rejected', decidedAt: now, rejectionReasonCode: code, rejectionReasonText: reason } });
      await tx.job.update({ where: { id: job.id }, data: { ...(s.status === 'in_review' ? { countInReview: { decrement: 1 } } : { countNeedsFix: { decrement: 1 } }), countRejected: { increment: 1 } } });
      if (job.status !== 'running' && job.status !== 'paused') {
        await this.core.moveReserve(tx, job, 'release', Decimal.min(unitCost(job), dec(job.reserveOutstandingUsd)), `submission:${s.publicRef}:admin-reject-release`, { title: job.title, reason: 'unused slot returned' });
      }
      await tx.submissionEvent.create({ data: { reservationId: s.reservationId, submissionId: s.id, eventType: 'rejected', actorType: 'admin', actorAdminId: ctx.id, data: { reason_code: code } } });
      await this.audit.record(ctx, { action: 'submission.admin_decide', entityType: 'submission', entityId: s.id, entityRef: s.publicRef, reason, before: { status: s.status }, after: { status: 'rejected', reason_code: code } }, tx);
    });
    await this.notify.user(s.workerUserId, { type: 'task_rejected', audience: 'worker', category: 'tasks', title: 'Submission rejected', body: `24 Freelancing reviewed ${s.publicRef}: ${reason}`, linkPath: `/worker/tasks/${s.publicRef}` });
    return { ref, status: 'rejected', decision_source: 'admin' };
  }

  /** Called when an overturn adjustment is approved (from the ledger service). */
  async completeOverturn(tx: Prisma.TransactionClient, ctx: AdminCtx, payload: { submission_id: string; reason_code: string; reason: string }) {
    const s = await tx.submission.findUniqueOrThrow({ where: { id: payload.submission_id } });
    if (s.status !== 'approved') return;
    const now = new Date();
    await tx.submission.update({ where: { id: s.id }, data: { status: 'rejected', decidedAt: now, finalAt: now, decisionSource: 'admin', decidedByAdminId: ctx.id, rejectionReasonCode: payload.reason_code as 'other', rejectionReasonText: payload.reason.slice(0, 300) } });
    await tx.job.update({ where: { id: s.jobId }, data: { countApproved: { decrement: 1 }, countRejected: { increment: 1 } } });
    const comms = await tx.referralCommission.findMany({ where: { submissionId: s.id, status: 'credited' } });
    for (const c of comms) {
      const acc = await this.core.ledger.userAccount(c.referrerUserId, 'worker_earnings', tx);
      const exp = await this.core.ledger.systemAccount('referral_expense', tx);
      const t = await this.core.ledger.post({ type: 'adjustment', idempotencyKey: `referral:${c.id}:reverse`, actor: 'admin', adminId: ctx.id, reason: 'Approved task overturned', reasonCode: 'referral_reversal', description: { visible_text: 'Referral reversed' }, refs: { referralCommissionId: c.id, submissionId: s.id }, lines: [ { accountId: acc.id, amount: dec(c.amount).neg().toFixed(6) }, { accountId: exp.id, amount: dec(c.amount).toFixed(6) } ] }, tx);
      await tx.referralCommission.update({ where: { id: c.id }, data: { status: 'reversed', reversedAt: now, reversalLedgerTxId: t.id, statusReason: 'Approved task overturned' } });
    }
    await tx.submissionEvent.create({ data: { reservationId: s.reservationId, submissionId: s.id, eventType: 'rejected', actorType: 'admin', actorAdminId: ctx.id, data: { overturned: true } } });
  }

  // ------------------------------------------------------------------ disputes

  async disputes(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const where: Prisma.DisputeWhereInput = {};
    if (q.status === 'decided') where.status = { in: ['resolved_worker', 'resolved_employer'] };
    else if (q.status) where.status = q.status as Prisma.EnumDisputeStatusFilter['equals'];
    if (q.ref) where.publicRef = q.ref;
    if (q.assigned === 'me') where.assignedAdminId = ctx.id;
    if (bool(q.overdue)) Object.assign(where, { status: { in: ['open', 'under_review'] }, slaDueAt: { lt: new Date() } });
    const [rows, total, open, ur] = await Promise.all([
      this.db.dispute.findMany({ where, orderBy: { slaDueAt: 'asc' }, skip: p.skip, take: p.take, include: { submission: { select: { publicRef: true } }, workerUser: { select: { fullName: true } }, employerUser: { select: { employerProfile: { select: { businessName: true } } } }, assignedAdmin: { select: { fullName: true } } } }),
      this.db.dispute.count({ where }),
      this.db.dispute.count({ where: { status: 'open' } }),
      this.db.dispute.count({ where: { status: 'under_review' } }),
    ]);
    return paged(
      rows.map((d) => ({ ref: d.publicRef, submission_ref: d.submission.publicRef, worker_name_masked: maskName(d.workerUser.fullName), employer_name: d.employerUser.employerProfile?.businessName ?? null, status: d.status, disputed_decision: d.disputedDecision, opened_at: iso(d.openedAt), sla_due_at: iso(d.slaDueAt), assigned_admin: d.assignedAdmin?.fullName ?? null, assigned_to_me: d.assignedAdminId === ctx.id })),
      total,
      p,
      { counts: { open, under_review: ur } },
    );
  }

  async dispute(ctx: AdminCtx, ref: string) {
    const d = await this.db.dispute.findUnique({ where: { publicRef: ref }, include: { submission: { include: { job: { include: { jobSteps: { orderBy: { position: 'asc' } } } } } }, assignedAdmin: { select: { fullName: true } }, payoutLedgerTx: { select: { publicRef: true } } } });
    if (!d) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    const evidence = [d.evidenceUploadId, d.evidenceUpload2Id, d.evidenceUpload3Id].filter((x): x is string => !!x).map((id) => ({ url: this.uploads.signedUrl(id, 'full') }));
    const lastAttempt = await this.db.submissionAttempt.findFirst({ where: { submissionId: d.submissionId, decision: { in: ['needs_fix', 'rejected'] } }, orderBy: { attemptNo: 'desc' } });
    await this.audit.safe(ctx, { action: 'dispute.view', entityType: 'dispute', entityId: d.id, entityRef: d.publicRef });
    const s = d.submission;
    return {
      ref: d.publicRef,
      status: d.status,
      disputed_decision: d.disputedDecision,
      opened_at: iso(d.openedAt),
      sla_due_at: iso(d.slaDueAt),
      assigned_admin: d.assignedAdmin?.fullName ?? null,
      assigned_to_me: d.assignedAdminId === ctx.id,
      worker_statement: d.workerStatement,
      evidence,
      employer_reason: { code: lastAttempt?.rejectionReasonCode ?? s.rejectionReasonCode, text: lastAttempt?.rejectionReasonText ?? s.rejectionReasonText },
      submission: { ref: s.publicRef, status: s.status, attempts: await this.attempts(s.id, ctx, s.publicRef) },
      job: { public_id: s.job.publicId, title: s.job.title, steps: s.job.jobSteps.map((x) => x.body) },
      payment_preview: d.status === 'open' || d.status === 'under_review' ? { source: await this.previewSource(s), amount_usd: m3(s.rewardUsd) } : null,
      resolution_note: d.resolutionNote,
      resolved_at: iso(d.resolvedAt),
      ledger_ref: d.payoutLedgerTx?.publicRef ?? null,
    };
  }

  async claim(ctx: AdminCtx, ref: string) {
    const d = await this.db.dispute.findUnique({ where: { publicRef: ref } });
    if (!d) throw new ApiError('NOT_FOUND');
    if (d.status === 'withdrawn') throw new ApiError('DISPUTE_WITHDRAWN');
    if (d.status !== 'open') throw new ApiError('ALREADY_DECIDED', 'Someone already claimed this dispute.');
    const r = await this.db.dispute.updateMany({ where: { id: d.id, status: 'open' }, data: { status: 'under_review', assignedAdminId: ctx.id, underReviewAt: new Date() } });
    if (!r.count) throw new ApiError('ALREADY_DECIDED');
    await this.audit.record(ctx, { action: 'dispute.pick_up', entityType: 'dispute', entityId: d.id, entityRef: d.publicRef, after: { status: 'under_review', assignee: ctx.fullName } });
    return { ref, status: 'under_review', assigned_admin_id: ctx.id };
  }

  async resolve(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const outcome = needEnum(b.outcome, ['worker', 'employer'] as const, 'outcome');
    const note = needText(b.note, 1000, 'note', 'Enter a note. Both sides see it.');
    const d0 = await this.db.dispute.findUnique({ where: { publicRef: ref } });
    if (!d0) throw new ApiError('NOT_FOUND');
    const res = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM disputes WHERE id = ${d0.id}::uuid FOR UPDATE`;
      const d = await tx.dispute.findUniqueOrThrow({ where: { id: d0.id }, include: { submission: { include: { job: true } } } });
      if (d.status === 'withdrawn') throw new ApiError('DISPUTE_WITHDRAWN');
      if (d.status !== 'under_review') throw new ApiError('ALREADY_DECIDED', d.status === 'open' ? 'Claim the dispute first.' : 'This dispute was already decided.');
      if (d.assignedAdminId !== ctx.id && !ctx.isSuper) throw new ApiError('ADMIN_FORBIDDEN', 'Claimed by another admin.');
      const now = new Date();
      if (outcome === 'worker') {
        const p = await this.payOutside(tx, ctx, d.submissionId, `dispute:${d.publicRef}:resolve`, { disputeId: d.id });
        await tx.dispute.update({ where: { id: d.id }, data: { status: 'resolved_worker', resolvedAt: now, resolvedByAdminId: ctx.id, resolutionNote: note, payoutLedgerTxId: p.ltx.id } });
        await tx.submissionEvent.create({ data: { reservationId: d.submission.reservationId, submissionId: d.submissionId, eventType: 'dispute_resolved', actorType: 'admin', actorAdminId: ctx.id, data: { outcome } } });
        await this.audit.record(ctx, { action: 'dispute.resolve', entityType: 'dispute', entityId: d.id, entityRef: d.publicRef, reason: note, after: { status: 'resolved_worker', paid_from: p.from, ledger_ref: p.ltx.publicRef, assignee: d.assignedAdminId } }, tx);
        return { d, paid: p, deadline: null as Date | null };
      }
      let deadline: Date | null = null;
      if (d.disputedDecision === 'needs_fix') {
        deadline = new Date(now.getTime() + 24 * 3600_000);
        if (d.submission.job.endsAt && d.submission.job.endsAt < deadline) deadline = d.submission.job.endsAt;
      }
      await tx.submission.update({ where: { id: d.submissionId }, data: { disputeOpen: false, ...(deadline ? { resubmitDeadline: deadline } : {}) } });
      await tx.dispute.update({ where: { id: d.id }, data: { status: 'resolved_employer', resolvedAt: now, resolvedByAdminId: ctx.id, resolutionNote: note } });
      await tx.submissionEvent.create({ data: { reservationId: d.submission.reservationId, submissionId: d.submissionId, eventType: 'dispute_resolved', actorType: 'admin', actorAdminId: ctx.id, data: { outcome } } });
      await this.audit.record(ctx, { action: 'dispute.resolve', entityType: 'dispute', entityId: d.id, entityRef: d.publicRef, reason: note, after: { status: 'resolved_employer', resubmit_deadline: deadline } }, tx);
      return { d, paid: null, deadline };
    });
    if (res.paid) await this.approval.afterApproval(res.paid.outcome, 'admin');
    const s = res.d.submission;
    await this.notify.user(s.workerUserId, { type: 'dispute_resolved', audience: 'worker', category: 'tasks', title: outcome === 'worker' ? 'Decided in your favour' : 'Decision upheld', body: note, linkPath: `/worker/tasks/${s.publicRef}` });
    await this.notify.user(s.employerUserId, { type: 'dispute_resolved', audience: 'employer', category: 'tasks', title: `Dispute ${res.d.publicRef} decided`, body: note });
    return outcome === 'worker'
      ? { ref, status: 'resolved_worker', submission_status: 'approved', paid_usd: m3(s.rewardUsd), paid_from: res.paid!.from, ledger_ref: res.paid!.ltx.publicRef }
      : { ref, status: 'resolved_employer', resubmit_deadline: iso(res.deadline) };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminWorkController {
  constructor(private readonly svc: AdminWorkService) {}

  @Get('submissions')
  @Perms('submissions.read')
  list(@Query() q: Q) {
    return this.svc.list(q);
  }

  @Get('submissions/:ref')
  @Perms('submissions.read')
  detail(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.detail(ctx, ref);
  }

  @Post('submissions/:ref/override')
  @HttpCode(200)
  @Perms('submissions.override')
  override(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.svc.override(ctx, ref, b ?? {}, res);
  }

  @Get('disputes')
  @Perms('disputes.read', 'disputes.resolve')
  disputes(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.disputes(ctx, q);
  }

  @Get('disputes/:ref')
  @Perms('disputes.read', 'disputes.resolve')
  dispute(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.dispute(ctx, ref);
  }

  @Post('disputes/:ref/claim')
  @HttpCode(200)
  @Perms('disputes.resolve')
  claim(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.claim(ctx, ref);
  }

  @Post('disputes/:ref/resolve')
  @HttpCode(200)
  @Perms('disputes.resolve')
  resolve(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.resolve(ctx, ref, b ?? {});
  }
}
