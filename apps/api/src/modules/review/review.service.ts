import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@24f/db';
import { initials, maskName } from '@24f/shared';
import { ApiError } from '../../common/api-error';
import { Paged } from '../../common/envelope.interceptor';
import { RedisService } from '../../common/redis.service';
import { SettingsService } from '../settings/settings.service';
import { EmployerCore, unitCost, usd3 } from '../employer/employer-common';
import { proofLabel } from '../jobs/job-rules';
import { ApprovalService } from './approval.service';
import { UploadsService } from '../uploads/uploads.service';

const REASON_LABEL: Record<string, string> = {
  proof_incomplete: 'Proof incomplete',
  steps_not_followed: 'Steps not followed',
  wrong_or_copied: 'Wrong or copied answer',
  link_not_accessible: 'Link not accessible',
  other: 'Other',
};

const TAB_STATUS: Record<string, Prisma.SubmissionWhereInput> = {
  to_review: { status: 'in_review' },
  approved: { status: 'approved' },
  rejected: { status: { in: ['needs_fix', 'rejected'] } },
};

function encodeCursor(v: string) {
  return Buffer.from(v).toString('base64url');
}
function decodeCursor(v?: string) {
  if (!v) return 0;
  const n = Number(Buffer.from(v, 'base64url').toString('utf8'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Review queue reads (Doc 04 §6.8) and the auto-approve sweep (§6.13). */
@Injectable()
export class ReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Review');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: EmployerCore,
    private readonly approval: ApprovalService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  // ------------------------------------------------------------- queue

  async list(employerId: string, q: { job?: string; tab: string; cursor?: string; per_page: number }) {
    const tab = TAB_STATUS[q.tab] ? q.tab : 'to_review';
    let jobFilter: Prisma.SubmissionWhereInput = {};
    let job: { id: string; title: string; autoApprove: boolean; publicId: string } | null = null;
    if (q.job) {
      job = await this.db.job.findFirst({ where: { publicId: q.job, employerUserId: employerId }, select: { id: true, title: true, autoApprove: true, publicId: true } });
      if (!job) throw new ApiError('NOT_FOUND', "We can't find that job.");
      jobFilter = { jobId: job.id };
    }
    const base: Prisma.SubmissionWhereInput = { employerUserId: employerId, ...jobFilter };
    const where = { ...base, ...TAB_STATUS[tab] };
    const offset = decodeCursor(q.cursor);
    const [total, rows, grouped, waitingByJob] = await Promise.all([
      this.db.submission.count({ where }),
      this.db.submission.findMany({
        where,
        orderBy: tab === 'to_review' ? [{ reviewDueAt: 'asc' }, { id: 'asc' }] : [{ decidedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: q.per_page,
        include: {
          job: { select: { publicId: true, title: true, proofTypes: true, rewardUsd: true, feePerTaskUsd: true, autoApprove: true } },
          workerUser: { select: { fullName: true } },
          submissionAttempts: { orderBy: { attemptNo: 'desc' }, take: 1, select: { workerNote: true, changeNote: true } },
        },
      }),
      this.db.submission.groupBy({ by: ['status'], where: base, _count: true }),
      this.db.submission.groupBy({ by: ['jobId'], where: { employerUserId: employerId, status: 'in_review' }, _count: true, _min: { reviewDueAt: true } }),
    ]);
    const count = (s: string[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count, 0);
    const jobs = await this.db.job.findMany({
      where: { employerUserId: employerId, deletedAt: null, OR: [{ id: { in: waitingByJob.map((w) => w.jobId) } }, { status: { in: ['running', 'paused'] } }, { countApproved: { gt: 0 } }] },
      select: { id: true, publicId: true, title: true, autoApprove: true, status: true },
      orderBy: { publishedAt: 'desc' },
    });
    const waitingFor = (id: string) => waitingByJob.find((w) => w.jobId === id)?._count ?? 0;
    const dueFor = (id: string) => waitingByJob.find((w) => w.jobId === id)?._min.reviewDueAt ?? null;
    const scopeJobs = job ? jobs.filter((j) => j.id === job!.id) : jobs;
    const autoDue = scopeJobs
      .filter((j) => j.autoApprove)
      .map((j) => dueFor(j.id))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const data = rows.map((s) => {
      const att = s.submissionAttempts[0];
      return {
        ref: s.publicRef,
        job_public_id: s.job.publicId,
        job_title: s.job.title,
        worker_name_masked: maskName(s.workerUser.fullName),
        worker_initials: initials(s.workerUser.fullName),
        status: s.status,
        sub_label: s.status === 'needs_fix' ? 'Fix requested' : s.status === 'rejected' ? 'Final' : null,
        submitted_at: s.lastSubmittedAt.toISOString(),
        decided_at: s.decidedAt?.toISOString() ?? null,
        review_due_at: s.reviewDueAt.toISOString(),
        preview: att?.changeNote || att?.workerNote || null,
        proof_label: proofLabel(s.job.proofTypes),
        duplicate_suspected: s.duplicateSuspected,
        attempt_no: s.currentAttemptNo,
        dispute_open: s.disputeOpen,
        unit_cost_usd: usd3(s.rewardUsd),
        decision_source: s.decisionSource,
      };
    });
    const next = offset + rows.length < total ? encodeCursor(String(offset + rows.length)) : null;
    const waiting = job ? waitingFor(job.id) : waitingByJob.reduce((n, w) => n + w._count, 0);
    return new Paged(data, {
      total,
      per_page: q.per_page,
      next_cursor: next,
      has_more: !!next,
      tab,
      counts: { to_review: count(['in_review']), approved: count(['approved']), rejected: count(['needs_fix', 'rejected']) },
      header: {
        job_public_id: job?.publicId ?? null,
        job_title: job?.title ?? null,
        waiting,
        jobs_waiting: waitingByJob.filter((w) => w._count > 0 && (!job || w.jobId === job.id)).length,
        auto_approve_at: autoDue?.toISOString() ?? null,
      },
      job_options: jobs.map((j) => ({ public_id: j.publicId, title: j.title, waiting: waitingFor(j.id), status: j.status })),
    });
  }

  async detail(employerId: string, ref: string, q: { job?: string; tab?: string }) {
    const s = await this.db.submission.findFirst({
      where: { publicRef: ref, employerUserId: employerId },
      include: {
        job: true,
        workerUser: { select: { fullName: true, workerProfile: { select: { approvalRatePct: true, approvedTotal: true } } } },
        submissionAttempts: {
          orderBy: { attemptNo: 'desc' },
          include: {
            submissionProofItems: {
              include: {
                proofRequirement: { select: { title: true, position: true, proofType: true } },
                upload: { select: { id: true, originalFilename: true, sizeBytes: true, mimeType: true, deletedAt: true, status: true } },
              },
            },
          },
        },
        dispute: { select: { publicRef: true, status: true, openedAt: true } },
      },
    });
    if (!s) throw new ApiError('NOT_FOUND', "We can't find that submission.");
    // Pager position inside the same tab and job filter.
    const tab = q.tab && TAB_STATUS[q.tab] ? q.tab : s.status === 'in_review' ? 'to_review' : s.status === 'approved' ? 'approved' : 'rejected';
    const pagerWhere: Prisma.SubmissionWhereInput = { employerUserId: employerId, ...TAB_STATUS[tab] };
    if (q.job) pagerWhere.job = { publicId: q.job };
    const ordered = await this.db.submission.findMany({
      where: pagerWhere,
      orderBy: tab === 'to_review' ? [{ reviewDueAt: 'asc' }, { id: 'asc' }] : [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: { publicRef: true },
      take: 500,
    });
    const idx = ordered.findIndex((o) => o.publicRef === s.publicRef);
    const mapItems = (items: (typeof s.submissionAttempts)[number]['submissionProofItems']) =>
      [...items]
        .sort((a, b) => a.proofRequirement.position - b.proofRequirement.position)
        .map((p) => ({
          proof_type: p.proofType,
          title: p.proofRequirement.title,
          link_url: p.linkUrl,
          text_value: p.textValue,
          link_check_status: p.linkCheckStatus,
          file: p.upload
            ? {
                id: p.upload.id,
                // Short-lived signed URLs (Doc 11 §6.7); proof images render straight from <img>.
                url: this.fileUrl(p.upload, 'full'),
                thumbnail_url: p.upload.mimeType?.startsWith('image/') ? this.fileUrl(p.upload, 'thumb') : null,
                filename: p.upload.originalFilename,
                size_bytes: p.upload.sizeBytes,
                mime_type: p.upload.mimeType,
                purged: !!p.upload.deletedAt || p.upload.status === 'deleted',
              }
            : null,
        }));
    const [current, ...previous] = s.submissionAttempts;
    const maxResub = await this.settings.number('max_resubmissions', 1);
    const canFix = s.job.allowResubmission && s.resubmissionCount < maxResub && (!s.job.endsAt || s.job.endsAt > new Date());
    const ac = (s.autoCheck ?? null) as Record<string, unknown> | null;
    // The worker submit flow stores `{ state: 'pass'|'warn'|'pending', items: [{ key, pass, text }] }`;
    // older rows use flat flags. Both map onto one response shape.
    const listed = ac && Array.isArray(ac.items) ? (ac.items as { key?: string; pass?: boolean; text?: string }[]) : null;
    const autoCheck = listed
      ? (() => {
          const raw = String(ac!.state ?? '');
          const state = raw === 'pending' ? 'pending' : raw === 'pass' || raw === 'passed' || listed.every((i) => i.pass) ? 'passed' : 'warning';
          const items = listed.map((i) => ({ check: String(i.key ?? ''), result: i.pass ? 'pass' : 'warn' }));
          const text = listed.map((i) => i.text ?? '').filter(Boolean).join(' · ');
          const summary = state === 'pending' ? 'Checking proof…' : text ? text.charAt(0).toUpperCase() + text.slice(1) : state === 'passed' ? 'Checks passed' : 'Check this proof before you decide';
          return { state, summary, items };
        })()
      : ac
      ? (() => {
          const items: { check: string; result: string }[] = [];
          if ('link_ok' in ac) items.push({ check: 'link_opens', result: ac.link_ok ? 'pass' : 'warn' });
          if ('screenshot_present' in ac) items.push({ check: 'screenshot_present', result: ac.screenshot_present ? 'pass' : 'warn' });
          if ('duplicate_suspected' in ac) items.push({ check: 'image_not_reused', result: ac.duplicate_suspected ? 'warn' : 'pass' });
          const state = (ac.state as string) ?? (items.some((i) => i.result === 'warn') ? 'warning' : 'passed');
          const TEXT: Record<string, [string, string]> = {
            link_opens: ['Link opens', 'Link didn’t open'],
            screenshot_present: ['screenshot present', 'screenshot missing'],
            image_not_reused: ['image not reused', 'image may be reused'],
          };
          const summary = state === 'pending' ? 'Checking proof…' : items.map((i) => TEXT[i.check]![i.result === 'pass' ? 0 : 1]).join(' · ');
          return { state, summary: summary.charAt(0).toUpperCase() + summary.slice(1), items };
        })()
      : null;
    return {
      ref: s.publicRef,
      status: s.status,
      job: {
        public_id: s.job.publicId,
        title: s.job.title,
        allow_resubmission: s.job.allowResubmission,
        auto_approve: s.job.autoApprove,
        status: s.job.status,
        proof_label: proofLabel(s.job.proofTypes),
      },
      worker: {
        name_masked: maskName(s.workerUser.fullName),
        initials: initials(s.workerUser.fullName),
        approval_rate_pct: s.workerUser.workerProfile?.approvalRatePct ?? null,
        tasks_done: s.workerUser.workerProfile?.approvedTotal ?? 0,
      },
      submitted_at: s.lastSubmittedAt.toISOString(),
      first_submitted_at: s.firstSubmittedAt.toISOString(),
      review_due_at: s.reviewDueAt.toISOString(),
      pager: {
        position: idx >= 0 ? idx + 1 : null,
        of: ordered.length,
        prev_ref: idx > 0 ? ordered[idx - 1]!.publicRef : null,
        next_ref: idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1]!.publicRef : null,
      },
      unit_cost_usd: usd3(s.rewardUsd),
      attempt: current
        ? { attempt_no: current.attemptNo, worker_note: current.workerNote, change_note: current.changeNote, submitted_at: current.submittedAt.toISOString(), proof_items: mapItems(current.submissionProofItems) }
        : null,
      previous_attempts: previous.map((a) => ({
        attempt_no: a.attemptNo,
        worker_note: a.workerNote,
        submitted_at: a.submittedAt.toISOString(),
        decision: a.decision,
        reason_code: a.rejectionReasonCode,
        reason_label: a.rejectionReasonCode ? REASON_LABEL[a.rejectionReasonCode] : null,
        reason_text: a.rejectionReasonText,
        proof_items: mapItems(a.submissionProofItems),
      })),
      auto_check: autoCheck,
      duplicate_suspected: s.duplicateSuspected,
      can_allow_fix: canFix,
      fix_default: canFix,
      decision: s.decidedAt
        ? {
            decided_at: s.decidedAt.toISOString(),
            decision_source: s.decisionSource,
            reason_code: s.rejectionReasonCode,
            reason_label: s.rejectionReasonCode ? REASON_LABEL[s.rejectionReasonCode] : null,
            reason_text: s.rejectionReasonText,
            fix_allowed: s.fixAllowed,
            resubmit_deadline: s.resubmitDeadline?.toISOString() ?? null,
          }
        : null,
      dispute: s.dispute ? { ref: s.dispute.publicRef, status: s.dispute.status, opened_at: s.dispute.openedAt?.toISOString?.() ?? null } : null,
    };
  }

  private fileUrl(u: { id: string; deletedAt: Date | null; status: string }, v: 'full' | 'thumb'): string | null {
    if (!this.uploads || u.deletedAt || u.status !== 'uploaded') return null;
    try {
      return this.uploads.signedUrl(u.id, v);
    } catch {
      return null;
    }
  }

  /** After a decision: next item in the same queue, and the sidebar badge (FR-REV-005). */
  async afterDecision(employerId: string, ref: string, jobPublicId?: string) {
    const where: Prisma.SubmissionWhereInput = { employerUserId: employerId, status: 'in_review', publicRef: { not: ref } };
    if (jobPublicId) where.job = { publicId: jobPublicId };
    const next = await this.db.submission.findFirst({ where, orderBy: [{ reviewDueAt: 'asc' }, { id: 'asc' }], select: { publicRef: true } });
    const badge = await this.db.submission.count({ where: { employerUserId: employerId, status: 'in_review' } });
    return { next_ref: next?.publicRef ?? null, badges: { submissions: badge } };
  }

  async jobSummary(jobId: string) {
    const j = await this.db.job.findUniqueOrThrow({ where: { id: jobId } });
    return { public_id: j.publicId, status: j.status, approved: j.countApproved, to_review: j.countInReview, spent_usd: unitCost(j).mul(j.countApproved).toFixed(2) };
  }

  // ------------------------------------------------------------- auto-approve sweep (every minute)

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.AUTO_APPROVE_SWEEP === 'off') return;
    this.timer = setInterval(() => void this.sweepWithLock(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.sweepWithLock(), 5_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweepWithLock() {
    const key = 'lock:submissions.auto-approve';
    try {
      const ok = await this.redis.client.set(key, String(process.pid), 'EX', 55, 'NX');
      if (!ok) return;
    } catch {
      /* Redis down: run anyway; row locks keep it safe */
    }
    try {
      const stats = await this.autoApproveSweep();
      if (stats.approved || stats.failed) this.log.log(`auto-approve: ${JSON.stringify(stats)}`);
    } catch (e) {
      this.log.error(`auto-approve sweep failed: ${String(e)}`);
    } finally {
      await this.redis.client.del(key).catch(() => undefined);
    }
  }

  /** Doc 04 §6.13: in_review, review_due_at ≤ now, job auto_approve, no dispute. One transaction per item. */
  async autoApproveSweep() {
    const BATCH = 500;
    const ids = await this.db.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM submissions s JOIN jobs j ON j.id = s.job_id
      WHERE s.status = 'in_review' AND s.review_due_at <= now() AND j.auto_approve = true AND s.dispute_open = false
      ORDER BY s.review_due_at LIMIT ${BATCH}`;
    const stats = { approved: 0, skipped: 0, failed: 0 };
    for (const { id } of ids) {
      try {
        const r = await this.db.$transaction(async (tx) => {
          const due = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM submissions WHERE id = ${id}::uuid AND status = 'in_review' AND review_due_at <= now() FOR UPDATE SKIP LOCKED`;
          if (!due.length) return null;
          return this.approval.approveInTx(tx, id, 'auto', {});
        });
        if (!r || r.alreadyApproved) stats.skipped++;
        else {
          stats.approved++;
          void this.approval.afterApproval(r, 'auto');
        }
      } catch (e) {
        stats.failed++;
        this.log.error(`auto_approve_failed ${id}: ${String(e)}`);
      }
    }
    return stats;
  }
}
