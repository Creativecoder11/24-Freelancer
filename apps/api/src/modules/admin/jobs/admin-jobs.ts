import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { EmployerCore, expectedReserve, unitCost } from '../../employer/employer-common';
import { ApprovalService } from '../../review/approval.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { bool, dec, iso, m2, m3, needEnum, needReason, paged, paging, type Q } from '../core/helpers';

const REJECT_CODES = ['proof_incomplete', 'steps_not_followed', 'wrong_or_copied', 'link_not_accessible', 'other'] as const;

type Flag = { kind?: string; term?: string; step?: number; detail?: string } | string;
const flagsOf = (j: { moderationFlags: Prisma.JsonValue | null }): Flag[] => (Array.isArray(j.moderationFlags) ? (j.moderationFlags as Flag[]) : []);

/** Jobs, moderation and job reports (Doc 06 §6.5, §6.8; Doc 09 SCR-ADM-07, -10, §9). */
@Injectable()
export class AdminJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: EmployerCore,
    private readonly approval: ApprovalService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async job(publicId: string) {
    const j = await this.db.job.findUnique({ where: { publicId } });
    if (!j || j.deletedAt) throw new ApiError('NOT_FOUND', `We can't find job ${publicId}.`);
    return j;
  }

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const where: Prisma.JobWhereInput = { deletedAt: null, status: { not: 'draft' } };
    const term = (q.q ?? '').trim();
    if (term) where.OR = [{ publicId: { equals: term.toUpperCase() } }, { title: { contains: term, mode: 'insensitive' } }];
    if (q.status) where.status = q.status as Prisma.EnumJobStatusFilter['equals'];
    if (bool(q.flagged)) where.moderationFlaggedAt = { not: null };
    if (bool(q.reported)) where.jobReports = { some: { status: 'open' } };
    if (q.employer) where.employerUser = { publicId: q.employer };
    if (q.category) where.category = { slug: q.category };
    let orderBy: Prisma.JobOrderByWithRelationInput = { publishedAt: 'desc' };
    if (q.sort === 'published_at') orderBy = { publishedAt: 'asc' };
    if (bool(q.flagged)) orderBy = { moderationFlaggedAt: 'asc' };
    if (q.sort === '-open_reports') orderBy = { jobReports: { _count: 'desc' } };
    const [rows, total, flagged, reported, suspended] = await Promise.all([
      this.db.job.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { employerUser: { select: { publicId: true, employerProfile: { select: { businessName: true } } } }, _count: { select: { jobReports: { where: { status: 'open' } } } } } }),
      this.db.job.count({ where }),
      this.db.job.count({ where: { deletedAt: null, moderationFlaggedAt: { not: null } } }),
      this.db.job.count({ where: { deletedAt: null, jobReports: { some: { status: 'open' } } } }),
      this.db.job.count({ where: { deletedAt: null, status: 'suspended' } }),
    ]);
    return paged(
      rows.map((j) => ({
        public_id: j.publicId,
        title: j.title,
        employer: { public_id: j.employerUser.publicId, business_name: j.employerUser.employerProfile?.businessName ?? null },
        status: j.status,
        pause_reason: j.pauseReason,
        flagged: !!j.moderationFlaggedAt,
        open_reports: j._count.jobReports,
        reward_usd: m3(j.rewardUsd),
        slots_total: j.slotsTotal ?? 0,
        slots_left: j.slotsLeft ?? 0,
        published_at: iso(j.publishedAt),
      })),
      total,
      p,
      { counts: { flagged, reported, suspended }, detail_access: ctx.has('jobs.read_detail') },
    );
  }

  async detail(publicId: string) {
    const j = await this.db.job.findUnique({
      where: { publicId },
      include: {
        jobSteps: { orderBy: { position: 'asc' } },
        jobProofRequirements: { orderBy: { position: 'asc' } },
        category: { select: { name: true } },
        suspendedByAdmin: { select: { fullName: true } },
        employerUser: { select: { publicId: true, status: true, employerProfile: { select: { businessName: true } } } },
        jobReports: { orderBy: { createdAt: 'asc' }, include: { reporterUser: { select: { publicId: true } } } },
        submissions: { where: { status: 'in_review' }, orderBy: { lastSubmittedAt: 'asc' }, include: { workerUser: { select: { fullName: true, publicId: true } } } },
      },
    });
    if (!j || j.deletedAt) throw new ApiError('NOT_FOUND', `We can't find job ${publicId}.`);
    const unit = unitCost(j);
    const free = Math.max(0, (j.slotsTotal ?? 0) - j.countApproved - j.countInReview - j.countNeedsFix);
    return {
      public_id: j.publicId,
      title: j.title,
      status: j.status,
      pause_reason: j.pauseReason,
      close_reason: j.closeReason,
      category: j.category?.name ?? null,
      task_link_url: j.taskLinkUrl,
      proof_instructions: j.proofInstructions,
      steps: j.jobSteps.map((s) => ({ position: s.position, body: s.body })),
      proof_requirements: j.jobProofRequirements.map((r) => ({ proof_type: r.proofType, title: r.title, required: r.isRequired })),
      rules: j.rules,
      screen_hits: flagsOf(j),
      flagged: !!j.moderationFlaggedAt,
      flagged_at: iso(j.moderationFlaggedAt),
      reports: j.jobReports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, reporter_public_id: r.reporterUser.publicId, status: r.status, created_at: iso(r.createdAt) })),
      employer: { public_id: j.employerUser.publicId, business_name: j.employerUser.employerProfile?.businessName ?? null, status: j.employerUser.status },
      counts: { active_reservations: j.countActiveReservations, in_review: j.countInReview, needs_fix: j.countNeedsFix, approved: j.countApproved, rejected: j.countRejected },
      reward_usd: m3(j.rewardUsd),
      unit_cost_usd: dec(unit).toFixed(6),
      slots_total: j.slotsTotal ?? 0,
      slots_left: j.slotsLeft ?? 0,
      budget_usd: m2(unit.mul(j.slotsTotal ?? 0)),
      reserve_outstanding_usd: m2(j.reserveOutstandingUsd),
      review_window_hours: j.reviewWindowHours,
      auto_approve: j.autoApprove,
      eligibility: j.eligibility,
      min_approval_rate: j.minApprovalRate,
      published_at: iso(j.publishedAt),
      ends_at: iso(j.endsAt),
      suspended_at: iso(j.suspendedAt),
      suspended_by: j.suspendedByAdmin?.fullName ?? null,
      suspension_reason: j.suspensionReason,
      preview: {
        suspend_release_usd: m2(dec(j.reserveOutstandingUsd).minus(unit.mul(j.countInReview + j.countNeedsFix)).clampedTo(0, Infinity)),
        reinstate_reserve_usd: m2(unit.mul(free)),
        close_release_usd: m2(unit.mul(free)),
      },
      in_review: j.submissions.map((s) => ({ ref: s.publicRef, worker_name_masked: maskName(s.workerUser.fullName), worker_public_id: s.workerUser.publicId, submitted_at: iso(s.lastSubmittedAt), reward_usd: m3(s.rewardUsd) })),
    };
  }

  /** Cancels active reservations and notifies workers (Canonical §7.2). Returns the count. */
  private async cancelReservations(tx: Prisma.TransactionClient, jobId: string, title: string) {
    const res = await tx.slotReservation.findMany({ where: { jobId, status: 'active' }, select: { id: true, workerUserId: true } });
    if (!res.length) return 0;
    const now = new Date();
    await tx.slotReservation.updateMany({ where: { id: { in: res.map((r) => r.id) } }, data: { status: 'cancelled', cancelledAt: now } });
    await tx.job.update({ where: { id: jobId }, data: { countActiveReservations: { decrement: res.length } } });
    for (const r of res) {
      await tx.submissionEvent.create({ data: { reservationId: r.id, eventType: 'reservation_cancelled', actorType: 'admin', data: { reason: 'job_suspended' } } });
      await this.notify.user(r.workerUserId, { type: 'reservation_cancelled', audience: 'worker', category: 'tasks', title: 'Job no longer available', body: `“${title}” was suspended by 24 Freelancing, so your slot was released.` }, tx);
    }
    return res.length;
  }

  async suspend(ctx: AdminCtx, publicId: string, b: Record<string, unknown>, _opts: { silentAudit?: boolean } = {}) {
    const reason = needReason(b.reason, 300);
    const j0 = await this.job(publicId);
    const out = await this.db.$transaction(async (tx) => {
      const j = await this.core.lockJob(tx, j0.id);
      if (j.status !== 'running' && j.status !== 'paused') throw new ApiError('INVALID_STATE', 'Only running or paused jobs can be suspended.');
      const cancelled = await this.cancelReservations(tx, j.id, j.title);
      const now = new Date();
      const fresh = await tx.job.update({ where: { id: j.id }, data: { status: 'suspended', pauseReason: null, suspendedAt: now, suspendedByAdminId: ctx.id, suspensionReason: reason } });
      const keep = expectedReserve(fresh, 'suspended');
      const release = Decimal.max(0, dec(fresh.reserveOutstandingUsd).minus(keep));
      const n = await this.core.nextCounter(tx, `job:${j.publicId}:admin-suspend:`);
      const ltx = await this.core.moveReserve(tx, fresh, 'release', release, `job:${j.publicId}:admin-suspend:${n}`, { title: j.title, reason: 'job suspended by admin' });
      await tx.submission.updateMany({ where: { jobId: j.id, status: { in: ['in_review', 'needs_fix'] } }, data: { timersPausedAt: now } });
      await tx.jobReport.updateMany({ where: { jobId: j.id, status: 'open' }, data: { status: 'actioned', handledAt: now, handledByAdminId: ctx.id, resolutionNote: 'Job suspended' } });
      await this.audit.record(ctx, { action: 'job.suspend', entityType: 'job', entityId: j.id, entityRef: j.publicId, reason, before: { status: j.status }, after: { status: 'suspended', reservations_cancelled: cancelled, released_usd: release.toFixed(6), ledger_ref: ltx?.publicRef ?? null } }, tx);
      return { j, cancelled, release };
    });
    await this.notify.user(out.j.employerUserId, { type: 'employer_job_suspended', audience: 'employer', category: 'tasks', title: 'Job suspended by admin', body: `“${out.j.title}” was suspended: ${reason} Contact support.`, linkPath: `/employer/jobs/${out.j.publicId}`, mandatory: true });
    return { public_id: publicId, status: 'suspended', pause_reason: 'admin', reservations_cancelled: out.cancelled, released_usd: m2(out.release) };
  }

  async reinstate(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const j0 = await this.job(publicId);
    const out = await this.db.$transaction(async (tx) => {
      const j = await this.core.lockJob(tx, j0.id);
      const ok = j.status === 'suspended' || (j.status === 'paused' && j.pauseReason === 'admin');
      if (!ok) throw new ApiError('INVALID_STATE', 'This job is not suspended.');
      const need = Decimal.max(0, expectedReserve(j, 'running').minus(dec(j.reserveOutstandingUsd)));
      const n = await this.core.nextCounter(tx, `job:${j.publicId}:admin-reinstate:`);
      const ltx = await this.core.moveReserve(tx, j, 'reserve', need, `job:${j.publicId}:admin-reinstate:${n}`, { title: j.title, reason: 'job reinstated by admin' });
      const now = new Date();
      // Timers continue from where they stopped.
      const paused = await tx.submission.findMany({ where: { jobId: j.id, timersPausedAt: { not: null } }, select: { id: true, timersPausedAt: true, reviewDueAt: true, resubmitDeadline: true } });
      for (const s of paused) {
        const shift = now.getTime() - s.timersPausedAt!.getTime();
        await tx.submission.update({ where: { id: s.id }, data: { timersPausedAt: null, reviewDueAt: new Date(s.reviewDueAt.getTime() + shift), resubmitDeadline: s.resubmitDeadline ? new Date(s.resubmitDeadline.getTime() + shift) : null } });
      }
      await tx.job.update({ where: { id: j.id }, data: { status: 'running', pauseReason: null, suspendedAt: null, suspensionReason: null, suspendedByAdminId: null } });
      await this.audit.record(ctx, { action: 'job.reinstate', entityType: 'job', entityId: j.id, entityRef: j.publicId, reason, before: { status: j.status }, after: { status: 'running', reserved_usd: need.toFixed(6), ledger_ref: ltx?.publicRef ?? null } }, tx);
      return { j, need, ltx };
    });
    await this.notify.user(out.j.employerUserId, { type: 'employer_job_reinstated', audience: 'employer', category: 'tasks', title: 'Job reinstated', body: `“${out.j.title}” is running again.`, linkPath: `/employer/jobs/${out.j.publicId}` });
    return { public_id: publicId, status: 'running', reserved_usd: m2(out.need), ledger_ref: out.ltx?.publicRef ?? null };
  }

  async close(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const rejectRefs = Array.isArray(b.reject_refs) ? (b.reject_refs as string[]) : [];
    const rejectCode = rejectRefs.length ? needEnum(b.rejection_reason_code ?? 'other', REJECT_CODES, 'rejection_reason_code') : 'other';
    const j0 = await this.job(publicId);
    const approvals: Awaited<ReturnType<ApprovalService['approveInTx']>>[] = [];
    const out = await this.db.$transaction(
      async (tx) => {
        const j = await this.core.lockJob(tx, j0.id);
        if (!['running', 'paused', 'suspended'].includes(j.status)) throw new ApiError('INVALID_STATE', 'This job is already closed.');
        await this.cancelReservations(tx, j.id, j.title);
        const inReview = await tx.submission.findMany({ where: { jobId: j.id, status: 'in_review', disputeOpen: false } });
        let rejected = 0;
        const now = new Date();
        for (const s of inReview) {
          if (rejectRefs.includes(s.publicRef)) {
            await tx.submission.update({ where: { id: s.id }, data: { status: 'rejected', decidedAt: now, finalAt: now, decisionSource: 'admin', decidedByAdminId: ctx.id, rejectionReasonCode: rejectCode, rejectionReasonText: reason.slice(0, 300), fixAllowed: false } });
            await tx.submissionAttempt.updateMany({ where: { submissionId: s.id, attemptNo: s.currentAttemptNo }, data: { decision: 'rejected', decidedAt: now, rejectionReasonCode: rejectCode, rejectionReasonText: reason.slice(0, 300) } });
            await tx.job.update({ where: { id: j.id }, data: { countInReview: { decrement: 1 }, countRejected: { increment: 1 } } });
            await tx.submissionEvent.create({ data: { reservationId: s.reservationId, submissionId: s.id, eventType: 'rejected', actorType: 'admin', actorAdminId: ctx.id, data: { reason_code: rejectCode, source: 'admin_close' } } });
            rejected++;
          } else {
            const o = await this.approval.approveInTx(tx, s.id, 'admin', {});
            await tx.submission.update({ where: { id: s.id }, data: { decidedByAdminId: ctx.id } });
            approvals.push(o);
          }
        }
        const fresh = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
        const keep = unitCost(fresh).mul(fresh.countNeedsFix + fresh.countInReview);
        const release = Decimal.max(0, dec(fresh.reserveOutstandingUsd).minus(keep));
        await this.core.moveReserve(tx, fresh, 'release', release, `job:${j.publicId}:admin-close`, { title: j.title, reason: 'job closed, unused slots' });
        await tx.job.update({ where: { id: j.id }, data: { status: 'cancelled', closeReason: 'admin_closed', closedAt: now, pauseReason: null } });
        const spent = approvals.reduce((a, o) => a.plus(o.rewardUsd).plus(o.feeUsd), new Decimal(0));
        await this.audit.record(ctx, { action: 'job.admin_close', entityType: 'job', entityId: j.id, entityRef: j.publicId, reason, before: { status: j.status }, after: { status: 'cancelled', close_reason: 'admin_closed', approved: approvals.length, rejected, released_usd: release.toFixed(6), spent_usd: spent.toFixed(6) } }, tx);
        return { j, rejected, release, spent };
      },
      { timeout: 60_000 },
    );
    for (const o of approvals) await this.approval.afterApproval(o, 'admin').catch(() => undefined);
    await this.notify.user(out.j.employerUserId, { type: 'employer_job_closed', audience: 'employer', category: 'tasks', title: 'Job closed by admin', body: `“${out.j.title}” was closed by 24 Freelancing: ${reason}`, linkPath: `/employer/jobs/${out.j.publicId}`, mandatory: true });
    return { public_id: publicId, status: 'cancelled', close_reason: 'admin_closed', approved_count: approvals.length, rejected_count: out.rejected, paid_usd: m2(out.spent), released_usd: m2(out.release) };
  }

  async clearFlag(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const j = await this.job(publicId);
    if (!j.moderationFlaggedAt) throw new ApiError('INVALID_STATE', 'This job has no flag.');
    await this.db.$transaction(async (tx) => {
      await tx.job.update({ where: { id: j.id }, data: { moderationFlags: Prisma.DbNull, moderationFlaggedAt: null } });
      await this.audit.record(ctx, { action: 'job.moderation_clear', entityType: 'job', entityId: j.id, entityRef: j.publicId, reason, before: { flags: j.moderationFlags }, after: { flags: [] } }, tx);
    });
    return { public_id: publicId, moderation_flags: [], moderation_flagged_at: null };
  }

  // ------------------------------------------------------------------ job reports

  async reports(q: Q) {
    const p = paging(q);
    const status = (q.status ?? 'open') as Prisma.EnumJobReportStatusFilter['equals'];
    const where: Prisma.JobReportWhereInput = { status };
    if (q.reason) where.reason = q.reason as Prisma.EnumJobReportReasonFilter['equals'];
    if (q.job) where.job = { publicId: q.job };
    const rows = await this.db.jobReport.findMany({ where, include: { job: { select: { publicId: true, title: true, status: true } }, reporterUser: { select: { publicId: true } } } });
    const openCounts = await this.db.jobReport.groupBy({ by: ['jobId'], where: { status: 'open' }, _count: { _all: true } });
    const perJob = new Map(openCounts.map((c) => [c.jobId, c._count._all]));
    const urgent = (r: (typeof rows)[number]) => ((perJob.get(r.jobId) ?? 0) >= 3 ? 0 : ['scam_or_payment', 'personal_data'].includes(r.reason) ? 1 : 2);
    rows.sort((a, b) => urgent(a) - urgent(b) || a.createdAt.getTime() - b.createdAt.getTime());
    const [open, actioned, dismissed] = await Promise.all(['open', 'actioned', 'dismissed'].map((s) => this.db.jobReport.count({ where: { status: s as 'open' } })));
    return paged(
      rows.slice(p.skip, p.skip + p.take).map((r) => ({
        id: r.id,
        job_public_id: r.job.publicId,
        job_title: r.job.title,
        job_status: r.job.status,
        reason: r.reason,
        details: r.details,
        reporter_public_id: r.reporterUser.publicId,
        open_reports_on_job: perJob.get(r.jobId) ?? 0,
        status: r.status,
        resolution_note: r.resolutionNote,
        created_at: iso(r.createdAt),
      })),
      rows.length,
      p,
      { counts: { open, actioned, dismissed } },
    );
  }

  async handleReport(ctx: AdminCtx, id: string, to: 'dismissed' | 'actioned', b: Record<string, unknown>) {
    const reason = to === 'actioned' ? needReason(b.reason) : ((b.reason as string | undefined)?.trim() || null);
    const r = await this.db.jobReport.findUnique({ where: { id }, include: { job: { select: { publicId: true } } } });
    if (!r) throw new ApiError('NOT_FOUND');
    if (r.status !== 'open') throw new ApiError('ALREADY_DECIDED', 'This report was already handled.');
    await this.db.$transaction(async (tx) => {
      await tx.jobReport.update({ where: { id }, data: { status: to, handledAt: new Date(), handledByAdminId: ctx.id, resolutionNote: reason?.slice(0, 500) ?? null } });
      await this.audit.record(ctx, { action: to === 'dismissed' ? 'job_report.dismiss' : 'job_report.action', entityType: 'job_report', entityId: id, entityRef: r.job.publicId, reason, after: { status: to } }, tx);
    });
    return { id, status: to };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminJobsController {
  constructor(private readonly svc: AdminJobsService) {}

  @Get('jobs')
  @Perms('jobs.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('jobs/:publicId')
  @Perms('jobs.read_detail')
  detail(@Param('publicId') id: string) {
    return this.svc.detail(id);
  }

  @Post('jobs/:publicId/suspend')
  @HttpCode(200)
  @Perms('jobs.moderate')
  suspend(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.suspend(ctx, id, b ?? {});
  }

  @Post('jobs/:publicId/reinstate')
  @HttpCode(200)
  @Perms('jobs.moderate')
  reinstate(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reinstate(ctx, id, b ?? {});
  }

  @Post('jobs/:publicId/close')
  @HttpCode(200)
  @Perms('jobs.moderate')
  close(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.close(ctx, id, b ?? {});
  }

  @Post('jobs/:publicId/clear-flag')
  @HttpCode(200)
  @Perms('jobs.moderate')
  clearFlag(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.clearFlag(ctx, id, b ?? {});
  }

  @Get('reports')
  @Perms('reports.read')
  reports(@Query() q: Q) {
    return this.svc.reports(q);
  }

  @Post('reports/:id/dismiss')
  @HttpCode(200)
  @Perms('reports.handle')
  dismiss(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.handleReport(ctx, id, 'dismissed', b ?? {});
  }

  @Post('reports/:id/mark-actioned')
  @HttpCode(200)
  @Perms('reports.handle')
  actioned(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.handleReport(ctx, id, 'actioned', b ?? {});
  }
}
