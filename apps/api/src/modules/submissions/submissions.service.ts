import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import {
  REJECTION_REASON_CODE,
  type ProofItemView,
  type ProofType,
  type RejectionReasonCode,
  type ResubmitResponse,
  type SubmissionEventType,
  type SubmissionStatus,
  type WorkerDispute,
  type WorkerSubmissionDetail,
  type WorkerSubmissionsQuery,
  type WorkerTaskRow,
  type WorkerTaskSummary,
  type CategorySlug,
  type DecisionSource,
  type DisputeStatus,
} from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { ProofChecksService } from '../reservations/proof-checks.service';
import { ReservationsService, type ProofInput } from '../reservations/reservations.service';
import { dhakaMonthBounds, employerTrust, EVENT_LABEL, iso, recordEvent, reward3, trendPercent, usd2 } from '../worker/worker-common';

const RANGE_DAYS: Record<string, number | null> = { last_7_days: 7, last_30_days: 30, last_90_days: 90, all_time: null };
const HIDDEN_EVENTS: SubmissionEventType[] = ['steps_updated', 'draft_saved'];

/** My tasks, task details, fix and resubmit (Doc 06 §5.7, Doc 04 §6.12). */
@Injectable()
export class SubmissionsService {
  private readonly log = new Logger('Submissions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
    private readonly reservations: ReservationsService,
    private readonly checks: ProofChecksService,
  ) {}

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async summary(userId: string): Promise<WorkerTaskSummary> {
    const db = this.prisma.db;
    const { start, prevStart } = dhakaMonthBounds();
    const minDecisions = await this.settings.number('approval_rate_min_decisions', 5);
    const [inReview, approvedThis, approvedPrev, profile] = await Promise.all([
      db.submission.aggregate({ where: { workerUserId: userId, status: 'in_review' }, _sum: { rewardUsd: true }, _count: { _all: true } }),
      db.submission.aggregate({ where: { workerUserId: userId, status: 'approved', decidedAt: { gte: start } }, _sum: { rewardUsd: true }, _count: { _all: true } }),
      db.submission.aggregate({ where: { workerUserId: userId, status: 'approved', decidedAt: { gte: prevStart, lt: start } }, _sum: { rewardUsd: true } }),
      db.workerProfile.findUnique({ where: { userId } }),
    ]);
    const thisSum = new Decimal((approvedThis._sum.rewardUsd ?? 0).toString());
    const prevSum = new Decimal((approvedPrev._sum.rewardUsd ?? 0).toString());
    const rate = profile?.approvalRatePct ?? null;
    const decided = (profile?.approved30d ?? 0) + (profile?.rejected30d ?? 0);
    return {
      pending_review_usd: usd2(inReview._sum.rewardUsd),
      pending_review_tasks: inReview._count._all,
      approved_this_month_usd: usd2(thisSum),
      approved_this_month_tasks: approvedThis._count._all,
      approved_trend_percent: trendPercent(thisSum, prevSum),
      approval_rate_percent: rate,
      approved_30d: profile?.approved30d ?? 0,
      rejected_30d: profile?.rejected30d ?? 0,
      decisions_needed: rate === null ? Math.max(0, minDecisions - decided) : 0,
    };
  }

  async list(userId: string, q: WorkerSubmissionsQuery) {
    const db = this.prisma.db;
    const days = RANGE_DAYS[q.range];
    const base: Prisma.SubmissionWhereInput = { workerUserId: userId };
    if (days) base.lastSubmittedAt = { gte: new Date(Date.now() - days * 86_400_000) };
    if (q.q) {
      const ref = q.q.toUpperCase();
      base.OR = [
        { job: { title: { contains: q.q, mode: 'insensitive' } } },
        { job: { employerUser: { employerProfile: { businessName: { contains: q.q, mode: 'insensitive' } } } } },
        { publicRef: ref },
        { job: { publicId: ref } },
      ];
    }
    const where: Prisma.SubmissionWhereInput = q.tab === 'all' ? base : { ...base, status: q.tab as SubmissionStatus };
    const [grouped, total, summary] = await Promise.all([
      db.submission.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      db.submission.count({ where }),
      this.summary(userId),
    ]);
    const counts = { all: 0, in_review: 0, approved: 0, needs_fix: 0, rejected: 0 };
    for (const g of grouped) {
      counts[g.status as SubmissionStatus] = g._count._all;
      counts.all += g._count._all;
    }
    const perPage = q.per_page;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(q.page, totalPages);
    const rows = await db.submission.findMany({
      where,
      orderBy: [{ lastSubmittedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { job: { select: { publicId: true, title: true, employerUser: { select: { fullName: true, employerProfile: { select: { businessName: true } } } } } } },
    });
    const data: WorkerTaskRow[] = rows.map((s) => ({
      ref: s.publicRef,
      job_public_id: s.job.publicId,
      job_title: s.job.title,
      employer_name: s.job.employerUser.employerProfile?.businessName ?? s.job.employerUser.fullName ?? 'Employer',
      reward_usd: reward3(s.rewardUsd),
      status: s.status,
      submitted_at: s.lastSubmittedAt.toISOString(),
      review_due_at: s.status === 'in_review' ? s.reviewDueAt.toISOString() : null,
      waiting_for_employer: s.status === 'in_review' && s.reviewDueAt < new Date(),
      rejection_reason_text: s.status === 'needs_fix' || s.status === 'rejected' ? s.rejectionReasonText : null,
      resubmit_deadline: s.status === 'needs_fix' ? iso(s.resubmitDeadline) : null,
      fix_allowed: s.status === 'needs_fix' || s.status === 'rejected' ? s.fixAllowed : null,
      dispute_open: s.disputeOpen,
    }));
    return { data, meta: { total, page, per_page: perPage, total_pages: totalPages, has_more: page < totalPages, counts, summary } };
  }

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------

  private async loadOwned(userId: string, ref: string) {
    const s = await this.prisma.db.submission.findUnique({
      where: { publicRef: ref.toUpperCase() },
      include: {
        job: {
          include: {
            category: true,
            jobProofRequirements: { orderBy: { position: 'asc' } },
            employerUser: { select: { fullName: true, employerProfile: true } },
          },
        },
        submissionAttempts: { orderBy: { attemptNo: 'desc' }, include: { submissionProofItems: { include: { upload: true, proofRequirement: true } } } },
        dispute: true,
        paidLedgerTx: { select: { publicRef: true } },
      },
    });
    if (!s || s.workerUserId !== userId) throw new ApiError('NOT_FOUND');
    return s;
  }

  async disputeView(d: Prisma.DisputeGetPayload<object>, submissionRef: string): Promise<WorkerDispute> {
    const ids = [d.evidenceUploadId, d.evidenceUpload2Id, d.evidenceUpload3Id].filter((v): v is string => !!v);
    const recs = await this.uploads.records(ids);
    return {
      ref: d.publicRef,
      status: d.status as DisputeStatus,
      submission_ref: submissionRef,
      disputed_decision: d.disputedDecision,
      worker_statement: d.workerStatement,
      evidence: ids
        .map((id) => recs[id])
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ upload_id: r.upload_id, filename: r.filename, size_bytes: r.size_bytes, url: r.url ?? null, thumbnail_url: r.thumbnail_url ?? null })),
      opened_at: d.openedAt.toISOString(),
      sla_due_at: d.slaDueAt.toISOString(),
      resolved_at: iso(d.resolvedAt),
      resolution_note: d.resolutionNote,
      can_withdraw: d.status === 'open' || d.status === 'under_review',
    };
  }

  async detail(userId: string, ref: string): Promise<WorkerSubmissionDetail> {
    const s = await this.loadOwned(userId, ref);
    const now = new Date();
    const maxResubmissions = await this.settings.number('max_resubmissions', 1);
    const disputeWindowH = await this.settings.number('dispute_window_hours', 72);
    const uploadIds = s.submissionAttempts.flatMap((a) => a.submissionProofItems.map((p) => p.uploadId)).filter((v): v is string => !!v);
    const recs = await this.uploads.records(uploadIds);
    const events = await this.prisma.db.submissionEvent.findMany({
      where: { OR: [{ submissionId: s.id }, { reservationId: s.reservationId }], eventType: { notIn: HIDDEN_EVENTS } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const emp = s.job.employerUser.employerProfile;
    const decided = s.status !== 'in_review';
    const tracker: WorkerSubmissionDetail['tracker'] = [{ stage: 'submitted', state: 'done', at: s.firstSubmittedAt.toISOString() }];
    if (s.status === 'in_review') {
      tracker.push({ stage: 'in_review', state: 'current', due_at: s.reviewDueAt.toISOString() }, { stage: 'approved', state: 'pending', at: null }, { stage: 'paid_to_balance', state: 'pending', at: null });
    } else if (s.status === 'approved') {
      tracker.push({ stage: 'in_review', state: 'done', at: iso(s.decidedAt) }, { stage: 'approved', state: 'done', at: iso(s.decidedAt) }, { stage: 'paid_to_balance', state: 'done', at: iso(s.decidedAt) });
    } else if (s.status === 'needs_fix') {
      tracker.push({ stage: 'in_review', state: 'done', at: iso(s.decidedAt) }, { stage: 'needs_fix', state: 'current', due_at: iso(s.resubmitDeadline) }, { stage: 'paid_to_balance', state: 'pending', at: null });
    } else {
      tracker.push({ stage: 'in_review', state: 'done', at: iso(s.decidedAt) }, { stage: 'rejected', state: 'failed', at: iso(s.decidedAt) }, { stage: 'paid_to_balance', state: 'pending', at: null });
    }
    const disputeDeadline = decided && s.decidedAt && (s.status === 'needs_fix' || s.status === 'rejected') ? new Date(s.decidedAt.getTime() + disputeWindowH * 3600_000) : null;
    const deadlineOk = !!s.resubmitDeadline && (s.resubmitDeadline > now || s.disputeOpen);
    return {
      ref: s.publicRef,
      status: s.status,
      decision_source: (s.decisionSource as DecisionSource | null) ?? null,
      job: {
        public_id: s.job.publicId,
        title: s.job.title,
        category: s.job.category ? { slug: s.job.category.slug as CategorySlug, name: s.job.category.name } : null,
        review_window_hours: s.job.reviewWindowHours,
        auto_approve: s.job.autoApprove,
        status: s.job.status,
        employer: employerTrust(emp, s.job.employerUser.fullName),
      },
      reward_usd: reward3(s.rewardUsd),
      first_submitted_at: s.firstSubmittedAt.toISOString(),
      last_submitted_at: s.lastSubmittedAt.toISOString(),
      review_due_at: s.status === 'in_review' ? s.reviewDueAt.toISOString() : null,
      decided_at: iso(s.decidedAt),
      paid_ledger_ref: s.paidLedgerTx?.publicRef ?? null,
      rejection:
        s.status === 'needs_fix' || s.status === 'rejected'
          ? {
              reason_code: (s.rejectionReasonCode as RejectionReasonCode | null) ?? null,
              reason_label: s.rejectionReasonCode ? REJECTION_REASON_CODE.labels[s.rejectionReasonCode as RejectionReasonCode] : null,
              reason_text: s.rejectionReasonText,
              fix_allowed: !!s.fixAllowed,
              resubmit_deadline: iso(s.resubmitDeadline),
              decided_at: iso(s.decidedAt),
            }
          : null,
      tracker,
      attempts: s.submissionAttempts.map((a) => ({
        attempt_no: a.attemptNo,
        submitted_at: a.submittedAt.toISOString(),
        worker_note: a.workerNote,
        change_note: a.changeNote,
        decision: (a.decision as SubmissionStatus | null) ?? null,
        decided_at: iso(a.decidedAt),
        proof_items: a.submissionProofItems
          .sort((x, y) => x.proofRequirement.position - y.proofRequirement.position)
          .map((p): ProofItemView => {
            const rec = p.uploadId ? recs[p.uploadId] : undefined;
            return {
              proof_type: p.proofType as ProofType,
              title: p.proofRequirement.fieldLabel ?? p.proofRequirement.title,
              proof_requirement_id: p.proofRequirementId,
              link_url: p.linkUrl,
              text_value: p.textValue,
              file: rec ? { upload_id: rec.upload_id, filename: rec.filename, size_bytes: rec.size_bytes, url: rec.url ?? null, thumbnail_url: rec.thumbnail_url ?? null } : null,
            };
          }),
      })),
      proof_requirements: s.job.jobProofRequirements.map((p) => ({
        id: p.id,
        position: p.position,
        proof_type: p.proofType as ProofType,
        title: p.title,
        field_label: p.fieldLabel,
        helper: p.helper,
        is_required: p.isRequired,
      })),
      activity: events.map((e) => ({ event_type: e.eventType, label: EVENT_LABEL[e.eventType] ?? e.eventType, occurred_at: e.occurredAt.toISOString() })),
      dispute: s.dispute ? await this.disputeView(s.dispute, s.publicRef) : null,
      can_resubmit: s.status === 'needs_fix' && !!s.fixAllowed && deadlineOk && s.resubmissionCount < maxResubmissions,
      resubmissions_left: Math.max(0, maxResubmissions - s.resubmissionCount),
      can_dispute: !s.dispute && !!disputeDeadline && disputeDeadline > now,
      dispute_deadline: iso(disputeDeadline),
    };
  }

  // ---------------------------------------------------------------------------
  // Resubmit (§6.12)
  // ---------------------------------------------------------------------------

  async resubmit(userId: string, ref: string, dto: { proof_items: ProofInput[]; change_note: string | null }): Promise<ResubmitResponse> {
    const maxResubmissions = await this.settings.number('max_resubmissions', 1);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM submissions WHERE public_ref = ${ref.toUpperCase()} AND worker_user_id = ${userId}::uuid FOR UPDATE`;
      if (!rows.length) throw new ApiError('NOT_FOUND');
      const sub = (await tx.submission.findUnique({ where: { id: rows[0]!.id }, include: { dispute: true } }))!;
      if (sub.status !== 'needs_fix' || !sub.fixAllowed) throw new ApiError('RESUBMIT_NOT_ALLOWED', 'This task can’t be resubmitted.');
      // A-55: the deadline is suspended while a dispute is open.
      if (!sub.disputeOpen && (!sub.resubmitDeadline || sub.resubmitDeadline < new Date())) throw new ApiError('RESUBMIT_NOT_ALLOWED');
      if (sub.resubmissionCount >= maxResubmissions) throw new ApiError('RESUBMIT_NOT_ALLOWED', 'You’ve used your resubmission for this task.');
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${sub.jobId}::uuid FOR UPDATE`;
      const job = (await tx.job.findUnique({ where: { id: sub.jobId } }))!;
      const reqs = await tx.jobProofRequirement.findMany({ where: { jobId: job.id }, orderBy: { position: 'asc' } });
      const prev = await tx.submissionAttempt.findUnique({
        where: { submissionId_attemptNo: { submissionId: sub.id, attemptNo: sub.currentAttemptNo } },
        include: { submissionProofItems: true },
      });
      // VR-101: a link is kept from the last attempt unless changed; text likewise.
      const merged: ProofInput[] = reqs.map((r) => {
        const given = dto.proof_items.find((p) => p.proof_requirement_id === r.id);
        const old = prev?.submissionProofItems.find((p) => p.proofRequirementId === r.id);
        return {
          proof_requirement_id: r.id,
          link_url: given?.link_url ?? (r.proofType === 'link' ? (old?.linkUrl ?? null) : null),
          text_value: given?.text_value ?? (r.proofType === 'text' ? (old?.textValue ?? null) : null),
          upload_id: given?.upload_id ?? null,
        };
      });
      // VR-102 (BR-042): a required screenshot must be a new upload.
      const fields: Record<string, string[]> = {};
      reqs.forEach((r, i) => {
        if (r.proofType !== 'screenshot' && r.proofType !== 'file') return;
        const old = prev?.submissionProofItems.find((p) => p.proofRequirementId === r.id);
        const now = merged[i]!.upload_id;
        if (r.isRequired && (!now || (old?.uploadId && old.uploadId === now))) fields[`proof_items.${i}.upload_id`] = [r.proofType === 'screenshot' ? 'Upload a new screenshot.' : 'Upload a new file.'];
      });
      if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', undefined, fields);
      const items = await this.reservations.resolveProof(tx, userId, reqs, merged);

      let withdrawnDispute: string | null = null;
      if (sub.disputeOpen && sub.dispute && (sub.dispute.status === 'open' || sub.dispute.status === 'under_review')) {
        await tx.dispute.update({ where: { id: sub.dispute.id }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
        await recordEvent(tx, sub.reservationId, sub.id, 'dispute_resolved', { type: 'user', userId }, { outcome: 'withdrawn', reason: 'resubmitted' });
        withdrawnDispute = sub.dispute.publicRef;
      }
      const attemptNo = sub.currentAttemptNo + 1;
      const at = new Date();
      const attempt = await tx.submissionAttempt.create({
        data: { submissionId: sub.id, attemptNo, changeNote: dto.change_note, attestationAcceptedAt: at, stepsChecked: prev?.stepsChecked ?? [] },
      });
      for (const it of items) {
        await tx.submissionProofItem.create({ data: { attemptId: attempt.id, proofRequirementId: it.req.id, proofType: it.req.proofType, linkUrl: it.link, textValue: it.text, uploadId: it.uploadId } });
      }
      await this.uploads.markClaimed(tx, items.map((i) => i.uploadId).filter((v): v is string => !!v));
      const reviewDueAt = new Date(at.getTime() + job.reviewWindowHours * 3600_000);
      await tx.submission.update({
        where: { id: sub.id },
        data: {
          status: 'in_review',
          currentAttemptNo: attemptNo,
          resubmissionCount: { increment: 1 },
          lastSubmittedAt: at,
          reviewDueAt,
          decidedAt: null,
          decisionSource: null,
          decidedByUserId: null,
          decidedByAdminId: null,
          rejectionReasonCode: null,
          rejectionReasonText: null,
          fixAllowed: null,
          resubmitDeadline: null,
          autoCheck: { state: 'pending' },
          duplicateSuspected: false,
          disputeOpen: false,
        },
      });
      await tx.job.update({ where: { id: job.id }, data: { countNeedsFix: { decrement: 1 }, countInReview: { increment: 1 } } });
      await recordEvent(tx, sub.reservationId, sub.id, 'resubmitted', { type: 'user', userId });
      return { sub, job, attempt, attemptNo, at, reviewDueAt, withdrawnDispute };
    });
    setImmediate(() => void this.checks.run(result.sub.id, result.attempt.id).catch((e) => this.log.warn(`auto-check ${result.sub.publicRef}: ${String(e)}`)));
    await this.notifications.notify('employer_submission_resubmitted', result.sub.employerUserId, { ref: result.sub.publicRef, job: result.job.title });
    if (result.withdrawnDispute) await this.notifications.notify('employer_dispute_withdrawn', result.sub.employerUserId, { ref: result.sub.publicRef });
    return {
      ref: result.sub.publicRef,
      status: 'in_review',
      attempt_no: result.attemptNo,
      last_submitted_at: result.at.toISOString(),
      review_due_at: result.reviewDueAt.toISOString(),
    };
  }
}
