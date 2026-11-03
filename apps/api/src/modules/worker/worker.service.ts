import { Injectable } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import {
  PUBLIC_CATEGORY_SLUGS,
  type ActivityItem,
  type CategorySlug,
  type EligibilityState,
  type JobReportCreated,
  type KycStatus,
  type MyJobState,
  type ProofType,
  type StartState,
  type WorkerJobCard,
  type WorkerJobDetail,
  type WorkerJobsQuery,
  type WorkerOverview,
} from '@24f/shared';
import { formatMoney, formatReward } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { proofLabel, toJobCard, type JobRowRaw } from '../public/job-mapper';
import { ReservationsService } from '../reservations/reservations.service';
import { dhakaMonthBounds, employerTrust, isUniqueViolation, iso, reward3, trendPercent, usd2 } from './worker-common';

const BUCKET_MINUTES: Record<string, number[]> = { under_5: [2, 5], '5_15': [10, 15], over_15: [30, 60] };
const SORT_SQL: Record<string, Prisma.Sql> = {
  newest: Prisma.sql`j.published_at DESC`,
  highest_reward: Prisma.sql`j.reward_usd DESC, j.published_at DESC`,
  shortest_time: Prisma.sql`j.display_minutes ASC, j.published_at DESC`,
  most_slots: Prisma.sql`j.slots_left DESC, j.published_at DESC`,
  ending_soon: Prisma.sql`j.ends_at ASC, j.published_at DESC`,
};
const DEFAULT_RULES = {
  allowed: ['Do your own work — every answer is checked.', 'One submission per worker. Fix and resubmit if asked.'],
  not_allowed: ['No copy-paste from other workers or automated tools.', 'Don’t share the task materials outside this task.'],
};

type Skip = 'chip' | 'category' | 'time' | 'proof';

interface WorkerCtx {
  userId: string;
  interests: string[];
  rate: number | null;
  kyc: KycStatus;
}

/** Worker jobs and overview (Doc 06 §5.6, Doc 04 §4.3). */
@Injectable()
export class WorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly reservations: ReservationsService,
  ) {}

  private async ctx(userId: string): Promise<WorkerCtx> {
    const u = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { workerProfile: true, userInterests: { include: { category: { select: { slug: true } } } } },
    });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    return {
      userId,
      interests: u.userInterests.map((i) => i.category.slug).filter((s) => (PUBLIC_CATEGORY_SLUGS as string[]).includes(s)),
      rate: u.workerProfile?.approvalRatePct ?? null,
      kyc: u.kycStatus as KycStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Find jobs
  // ---------------------------------------------------------------------------

  private fromSql = Prisma.sql`FROM jobs j JOIN categories c ON c.id = j.category_id JOIN employer_profiles e ON e.user_id = j.employer_user_id`;

  private where(q: Partial<WorkerJobsQuery>, c: WorkerCtx, skip: Skip[] = []) {
    const parts: Prisma.Sql[] = [
      Prisma.sql`j.status = 'running' AND j.ends_at > now() AND j.deleted_at IS NULL`,
      Prisma.sql`j.employer_user_id <> ${c.userId}::uuid`, // BR-022
    ];
    if (q.q) parts.push(Prisma.sql`(j.title ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'} OR c.name ILIKE ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'} OR j.public_id = ${q.q.toUpperCase()})`);
    if (!skip.includes('chip') && q.chip && q.chip !== 'all') {
      if (q.chip === 'for_you') parts.push(c.interests.length ? Prisma.sql`c.slug IN (${Prisma.join(c.interests)})` : Prisma.sql`false`);
      else parts.push(Prisma.sql`c.slug = ${q.chip}`);
    } else if (!skip.includes('chip')) {
      // "other" jobs appear only under All (C-17); other chips are public categories.
    }
    if (!skip.includes('category') && q.category?.length) parts.push(Prisma.sql`c.slug IN (${Prisma.join(q.category)})`);
    if (q.reward_min) parts.push(Prisma.sql`j.reward_usd >= ${q.reward_min}::numeric`);
    if (q.reward_max && Number(q.reward_max) < 0.4) parts.push(Prisma.sql`j.reward_usd <= ${q.reward_max}::numeric`);
    if (!skip.includes('time') && q.time?.length) {
      const mins = q.time.flatMap((t) => BUCKET_MINUTES[t] ?? []);
      if (mins.length) parts.push(Prisma.sql`j.est_minutes IN (${Prisma.join(mins)})`);
    }
    if (!skip.includes('proof') && q.proof?.length) parts.push(Prisma.sql`j.proof_types && ${q.proof}::proof_type[]`);
    if (q.only_open) parts.push(Prisma.sql`j.slots_left > 0`);
    if (q.hide_done) parts.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM submissions s WHERE s.job_id = j.id AND s.worker_user_id = ${c.userId}::uuid)`);
    return Prisma.join(parts, ' AND ');
  }

  private selectCols(c: WorkerCtx) {
    return Prisma.sql`j.id, j.public_id, j.title, c.slug AS category_slug, c.name AS category_name, e.business_name,
      (e.employer_verified_at IS NOT NULL) AS employer_verified, j.reward_usd::text AS reward_usd, j.display_minutes,
      j.proof_types::text[] AS proof_types, j.slots_total, GREATEST(j.slots_left, 0) AS slots_left, j.published_at, j.ends_at,
      j.eligibility::text AS eligibility, j.min_approval_rate,
      EXISTS (SELECT 1 FROM submissions s WHERE s.job_id = j.id AND s.worker_user_id = ${c.userId}::uuid) AS done,
      EXISTS (SELECT 1 FROM slot_reservations r WHERE r.job_id = j.id AND r.worker_user_id = ${c.userId}::uuid AND r.status = 'active' AND r.expires_at > now()) AS in_progress`;
  }

  private card(r: JobRowRaw & { eligibility: string; min_approval_rate: number; done: boolean; in_progress: boolean }, c: WorkerCtx, newMin: number): WorkerJobCard {
    let eligibility: EligibilityState = 'eligible';
    if (r.eligibility === 'kyc_verified' && c.kyc !== 'verified') eligibility = 'kyc_required';
    else if (r.min_approval_rate > 0 && c.rate !== null && c.rate < r.min_approval_rate) eligibility = 'approval_rate';
    const my: MyJobState = r.done ? 'done' : r.in_progress ? 'in_progress' : 'not_started';
    return { ...toJobCard(r, newMin), eligibility_state: eligibility, my_state: my };
  }

  async jobs(userId: string, q: WorkerJobsQuery) {
    const db = this.prisma.db;
    const c = await this.ctx(userId);
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${this.fromSql} WHERE ${this.where(q, c)}`;

    // Chip counts honour every filter except the chip itself (C-07).
    const chipRows = await db.$queryRaw<{ slug: string; n: number }[]>`
      SELECT c.slug, count(*)::int AS n ${this.fromSql} WHERE ${this.where(q, c, ['chip'])} GROUP BY c.slug`;
    const counts: Record<string, number> = { all: chipRows.reduce((s, r) => s + r.n, 0), for_you: 0 };
    for (const s of PUBLIC_CATEGORY_SLUGS) counts[s] = 0;
    for (const r of chipRows) {
      if ((PUBLIC_CATEGORY_SLUGS as string[]).includes(r.slug)) counts[r.slug] = r.n;
      if (c.interests.includes(r.slug)) counts.for_you! += r.n;
    }
    const facet = async (skip: Skip, col: Prisma.Sql) =>
      db.$queryRaw<{ k: string; n: number }[]>`SELECT ${col} AS k, count(*)::int AS n ${this.fromSql} WHERE ${this.where(q, c, [skip])} GROUP BY 1`;
    const [catF, timeF, proofF] = await Promise.all([
      facet('category', Prisma.sql`c.slug`),
      facet('time', Prisma.sql`CASE WHEN j.est_minutes <= 5 THEN 'under_5' WHEN j.est_minutes <= 15 THEN '5_15' ELSE 'over_15' END`),
      db.$queryRaw<{ k: string; n: number }[]>`SELECT p::text AS k, count(*)::int AS n ${this.fromSql} CROSS JOIN LATERAL unnest(j.proof_types) AS p WHERE ${this.where(q, c, ['proof'])} GROUP BY 1`,
    ]);
    const toMap = (rows: { k: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.k, r.n]));
    const facets = { category: toMap(catF), time: toMap(timeF), proof: toMap(proofF) };

    const perPage = q.per_page;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const applied = { chip: q.chip, category: q.category, reward_min: q.reward_min, reward_max: q.reward_max, time: q.time, proof: q.proof, only_open: q.only_open, hide_done: q.hide_done, sort: q.sort, q: q.q };
    if (q.count_only) return { data: [] as WorkerJobCard[], meta: { total, page: 1, per_page: perPage, total_pages: totalPages, has_more: false, counts, facets, applied_filters: applied } };
    const page = Math.min(q.page, totalPages);
    const rows = await db.$queryRaw<(JobRowRaw & { eligibility: string; min_approval_rate: number; done: boolean; in_progress: boolean })[]>`
      SELECT ${this.selectCols(c)} ${this.fromSql} WHERE ${this.where(q, c)}
      ORDER BY ${SORT_SQL[q.sort] ?? SORT_SQL.newest} LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;
    return {
      data: rows.map((r) => this.card(r, c, newMin)),
      meta: { total, page, per_page: perPage, total_pages: totalPages, has_more: page < totalPages, counts, facets, applied_filters: applied },
    };
  }

  // ---------------------------------------------------------------------------
  // Overview (one call, C-07)
  // ---------------------------------------------------------------------------

  async overview(userId: string): Promise<WorkerOverview> {
    const db = this.prisma.db;
    const c = await this.ctx(userId);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { workerProfile: true, walletAccounts: { where: { kind: 'worker_earnings' } }, payoutMethods: { where: { deletedAt: null }, select: { id: true } } },
    });
    const now = new Date();
    const { start, prevStart } = dhakaMonthBounds(now);
    const minDecisions = await this.settings.number('approval_rate_min_decisions', 5);
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const referralRate = Number(await this.settings.get<unknown>('referral_task_rate', 0.05));

    const [inReview, needsFix, approvedThis, approvedPrev, waiting, activeRes, unread, openJobs, newMatching, starter] = await Promise.all([
      db.submission.aggregate({ where: { workerUserId: userId, status: 'in_review' }, _sum: { rewardUsd: true }, _count: { _all: true } }),
      db.submission.count({ where: { workerUserId: userId, status: 'needs_fix' } }),
      db.submission.aggregate({ where: { workerUserId: userId, status: 'approved', decidedAt: { gte: start } }, _sum: { rewardUsd: true }, _count: { _all: true } }),
      db.submission.aggregate({ where: { workerUserId: userId, status: 'approved', decidedAt: { gte: prevStart, lt: start } }, _sum: { rewardUsd: true } }),
      db.submission.findMany({
        where: { workerUserId: userId, status: 'in_review' },
        orderBy: { lastSubmittedAt: 'desc' },
        take: 3,
        include: { job: { select: { title: true, employerUser: { select: { fullName: true, employerProfile: { select: { businessName: true } } } } } } },
      }),
      db.slotReservation.findFirst({ where: { workerUserId: userId, status: 'active', expiresAt: { gt: now } }, orderBy: { expiresAt: 'asc' }, include: { job: { select: { publicId: true, title: true } } } }),
      db.notification.count({ where: { userId, audience: 'worker', readAt: null, expiresAt: { gt: now } } }),
      db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${this.fromSql} WHERE ${this.where({ only_open: true }, c)}`,
      c.interests.length
        ? db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${this.fromSql} WHERE ${this.where({ chip: 'for_you', only_open: true, hide_done: true }, c)} AND j.published_at > now() - interval '24 hours'`
        : Promise.resolve([{ n: 0 }]),
      db.submission.count({ where: { workerUserId: userId } }),
    ]);

    // Recommended: interests first, newest otherwise (FR-WJOB-003).
    const recQ: Partial<WorkerJobsQuery> = { chip: c.interests.length ? 'for_you' : 'all', only_open: true, hide_done: true };
    const recRows = await db.$queryRaw<(JobRowRaw & { eligibility: string; min_approval_rate: number; done: boolean; in_progress: boolean })[]>`
      SELECT ${this.selectCols(c)} ${this.fromSql} WHERE ${this.where(recQ, c)} ORDER BY j.published_at DESC LIMIT 4`;
    const categories = await db.category.findMany({ where: { slug: { in: c.interests } }, orderBy: { sortOrder: 'asc' }, select: { name: true } });

    const profile = user.workerProfile;
    const decided = (profile?.approved30d ?? 0) + (profile?.rejected30d ?? 0);
    const rate = profile?.approvalRatePct ?? null;
    const available = user.walletAccounts[0]?.balanceCached ?? new Prisma.Decimal(0);
    const name = (user.fullName ?? '').split(/\s+/)[0] || 'there';
    const part = (() => {
      const h = (now.getUTCHours() + 6) % 24;
      return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'evening';
    })();
    const thisSum = new Decimal((approvedThis._sum.rewardUsd ?? 0).toString());
    const prevSum = new Decimal((approvedPrev._sum.rewardUsd ?? 0).toString());

    return {
      greeting: `Good ${part}, ${name}`,
      subtitle_counts: { tasks_in_review: inReview._count._all, new_matching_jobs: newMatching[0]?.n ?? 0 },
      stats: {
        available_usd: usd2(available),
        pending_review_usd: usd2(inReview._sum.rewardUsd),
        pending_review_tasks: inReview._count._all,
        show_usually_reviewed_24h: inReview._count._all > 0,
        approved_this_month_usd: usd2(thisSum),
        approved_this_month_tasks: approvedThis._count._all,
        approved_trend_percent: trendPercent(thisSum, prevSum),
      },
      quick_actions: { open_jobs: openJobs[0]?.n ?? 0, needs_fix: needsFix, available_usd: usd2(available), referral_task_percent: Math.round(referralRate * 100) },
      recommended: {
        based_on: categories.slice(0, 3).map((x) => x.name),
        more_interests: Math.max(0, categories.length - 3),
        jobs: recRows.map((r) => this.card(r, c, newMin)),
      },
      approval: {
        rate_percent: rate,
        approved_30d: profile?.approved30d ?? 0,
        rejected_30d: profile?.rejected30d ?? 0,
        decisions_needed: rate === null ? Math.max(0, minDecisions - decided) : 0,
      },
      recent_activity: await this.activity(userId, 5),
      waiting_for_review: {
        total: inReview._count._all,
        items: waiting.map((s) => ({
          ref: s.publicRef,
          job_title: s.job.title,
          employer_name: s.job.employerUser.employerProfile?.businessName ?? s.job.employerUser.fullName ?? 'Employer',
          reward_usd: reward3(s.rewardUsd),
          status: s.status,
          submitted_at: s.lastSubmittedAt.toISOString(),
          review_due_at: iso(s.reviewDueAt),
        })),
      },
      nudges: {
        setup_card_visible: !user.setupCardDismissedAt && (!user.payoutMethods.length || !starter || !c.interests.length),
        setup: { account_created: true, interests_done: c.interests.length > 0, payout_method_done: user.payoutMethods.length > 0, starter_task_done: starter > 0 },
        kyc_required_before_withdrawal: user.kycStatus !== 'verified',
        kyc_status: user.kycStatus as KycStatus,
        add_email_nudge: !user.email,
        no_payout_method: user.payoutMethods.length === 0,
        active_reservation: activeRes ? { id: activeRes.id, job_public_id: activeRes.job.publicId, job_title: activeRes.job.title, expires_at: activeRes.expiresAt.toISOString() } : null,
      },
      badges: { my_tasks: inReview._count._all + needsFix, notifications_unread: unread },
    };
  }

  /** Recent activity: submissions, decisions and paid withdrawals, newest first (Figma 28:756). */
  async activity(userId: string, limit: number): Promise<ActivityItem[]> {
    const db = this.prisma.db;
    const subs = await db.submission.findMany({
      where: { workerUserId: userId },
      orderBy: { updatedAt: 'desc' },
      take: limit * 2,
      include: { job: { select: { title: true } } },
    });
    const items: ActivityItem[] = [];
    for (const s of subs) {
      const link = `/worker/tasks/${s.publicRef}`;
      if (s.decidedAt && s.status !== 'in_review') {
        if (s.status === 'approved') items.push({ kind: 'approved', title: `Approved · +${formatReward(s.rewardUsd.toString())}`, description: s.job.title, occurred_at: s.decidedAt.toISOString(), link_path: link });
        if (s.status === 'needs_fix') items.push({ kind: 'needs_fix', title: 'Needs a fix', description: s.job.title, occurred_at: s.decidedAt.toISOString(), link_path: `${link}/fix` });
        if (s.status === 'rejected') items.push({ kind: 'rejected', title: 'Rejected', description: s.job.title, occurred_at: s.decidedAt.toISOString(), link_path: link });
      }
      items.push({
        kind: s.currentAttemptNo > 1 ? 'resubmitted' : 'submitted',
        title: `${s.currentAttemptNo > 1 ? 'Resubmitted' : 'Submitted'} · ${formatReward(s.rewardUsd.toString())}`,
        description: s.job.title,
        occurred_at: s.lastSubmittedAt.toISOString(),
        link_path: link,
      });
    }
    const paid = await db.withdrawal.findMany({ where: { userId, status: 'paid', paidAt: { not: null } }, orderBy: { paidAt: 'desc' }, take: limit });
    for (const w of paid) {
      const last3 = (w.destinationMasked ?? '').replace(/\D/g, '').slice(-3);
      const label = w.method === 'usdt_trc20' ? 'USDT wallet' : 'Mobile wallet';
      items.push({ kind: 'withdrawal_paid', title: `Withdrawal paid · ${formatMoney(w.amountUsd.toString())}`, description: `${label} ••${last3}`, occurred_at: w.paidAt!.toISOString(), link_path: `/worker/wallet/withdrawals?ref=${w.publicRef}` });
    }
    return items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Job details (pre-start and in progress, G-08)
  // ---------------------------------------------------------------------------

  async jobDetail(userId: string, publicId: string): Promise<WorkerJobDetail> {
    const db = this.prisma.db;
    const job = await db.job.findUnique({
      where: { publicId },
      include: {
        category: true,
        jobSteps: { orderBy: { position: 'asc' } },
        jobProofRequirements: { orderBy: { position: 'asc' } },
        employerUser: { select: { fullName: true, employerProfile: true } },
      },
    });
    if (!job || job.status === 'draft' || job.deletedAt) throw new ApiError('NOT_FOUND');
    const now = new Date();
    const [user, submission, reservation, lastRes] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId }, include: { workerProfile: true } }),
      db.submission.findFirst({ where: { jobId: job.id, workerUserId: userId }, select: { publicRef: true, status: true } }),
      db.slotReservation.findFirst({ where: { jobId: job.id, workerUserId: userId, status: 'active' } }),
      db.slotReservation.findFirst({ where: { jobId: job.id, workerUserId: userId, status: { in: ['released', 'expired', 'cancelled'] } }, orderBy: { startedAt: 'desc' } }),
    ]);
    if (job.status === 'suspended' && !submission && !reservation) throw new ApiError('NOT_FOUND');
    const live = reservation && reservation.expiresAt > now ? reservation : null;
    if (reservation && !live) await this.reservations.expireOne(reservation.id).catch(() => undefined);

    // job_views (one row per viewer; counts first views only).
    const viewerKey = `u:${userId}`;
    const seen = await db.jobView.findUnique({ where: { jobId_viewerKey: { jobId: job.id, viewerKey } }, select: { id: true } });
    if (seen) await db.jobView.update({ where: { id: seen.id }, data: { lastViewedAt: now, viewCount: { increment: 1 } } });
    else {
      await db.jobView.create({ data: { jobId: job.id, viewerUserId: userId, viewerKey } }).catch(() => undefined);
      await db.job.update({ where: { id: job.id }, data: { countViews: { increment: 1 } } }).catch(() => undefined);
    }

    const rate = user.workerProfile?.approvalRatePct ?? null;
    const ended = !job.endsAt || job.endsAt <= now;
    const slotsLeft = Math.max(job.slotsLeft ?? 0, 0);
    let ineligible: WorkerJobDetail['ineligible'] = null;
    let state: StartState;
    if (job.employerUserId === userId) state = 'own_job';
    else if (submission) state = 'already_done';
    else if (live) state = 'in_progress';
    else if (user.status !== 'active') state = 'restricted';
    else if (!user.emailVerifiedAt && !user.phoneVerifiedAt) state = 'verify_required';
    else if (job.status === 'paused') state = 'paused';
    else if (job.status !== 'running' || ended) state = 'closed';
    else if (slotsLeft <= 0) state = 'full';
    else if (job.eligibility === 'kyc_verified' && user.kycStatus !== 'verified') {
      state = 'not_eligible';
      ineligible = { reason: 'kyc_required', required_rate: null, your_rate: rate };
    } else if (job.minApprovalRate > 0 && rate !== null && rate < job.minApprovalRate) {
      state = 'not_eligible';
      ineligible = { reason: 'approval_rate', required_rate: job.minApprovalRate, your_rate: rate };
    } else state = 'can_start';

    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const holdMinutes = await this.settings.number('slot_hold_minutes', 60);
    const emp = job.employerUser.employerProfile;
    const slotsTotal = job.slotsTotal ?? 0;
    const showLink = !!live || !!submission;
    return {
      public_id: job.publicId,
      title: job.title,
      category: job.category ? { slug: job.category.slug as CategorySlug, name: job.category.name } : null,
      is_new: !!job.publishedAt && now.getTime() - job.publishedAt.getTime() <= newMin * 60_000,
      job_status: job.status as WorkerJobDetail['job_status'],
      reward_usd: reward3(job.rewardUsd),
      display_minutes: job.displayMinutes,
      proof_label: proofLabel(job.proofTypes as ProofType[]),
      proof_types: job.proofTypes as ProofType[],
      slots_total: slotsTotal,
      slots_left: slotsLeft,
      slots_filled: Math.min(slotsTotal, slotsTotal - slotsLeft),
      published_at: iso(job.publishedAt),
      ends_at: iso(job.endsAt),
      start_state: state,
      ineligible,
      reservation: live ? await this.reservations.view(live, job) : null,
      last_reservation: !live && !submission && lastRes ? { status: lastRes.status, ended_at: iso(lastRes.expiredAt ?? lastRes.releasedAt ?? lastRes.cancelledAt) } : null,
      task_link_url: showLink ? job.taskLinkUrl : null,
      steps: job.jobSteps.map((s) => ({ position: s.position, body: s.body })),
      proof_requirements: job.jobProofRequirements.map((p) => ({
        id: p.id,
        position: p.position,
        proof_type: p.proofType as ProofType,
        title: p.title,
        field_label: p.fieldLabel,
        helper: p.helper,
        is_required: p.isRequired,
      })),
      proof_instructions: job.proofInstructions,
      rules: (job.rules as WorkerJobDetail['rules'] | null) ?? DEFAULT_RULES,
      terms: { review_window_hours: job.reviewWindowHours, auto_approve: job.autoApprove, allow_resubmission: job.allowResubmission, rejections_need_reason: true },
      employer: employerTrust(emp, job.employerUser.fullName),
      submission_ref: submission?.publicRef ?? null,
      submission_status: submission?.status ?? null,
      slot_hold_minutes: holdMinutes,
    };
  }

  // ---------------------------------------------------------------------------
  // Job reports (Doc 04 §10.6)
  // ---------------------------------------------------------------------------

  async report(userId: string, publicId: string, dto: { reason: string; details: string | null }): Promise<JobReportCreated> {
    const job = await this.prisma.db.job.findUnique({ where: { publicId }, select: { id: true, status: true, deletedAt: true } });
    if (!job || job.status === 'draft' || job.deletedAt) throw new ApiError('NOT_FOUND');
    try {
      const r = await this.prisma.db.jobReport.create({
        data: { jobId: job.id, reporterUserId: userId, reason: dto.reason as Prisma.JobReportCreateInput['reason'], details: dto.details },
      });
      return { id: r.id, status: r.status, created_at: r.createdAt.toISOString() };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('ALREADY_REPORTED');
      throw e;
    }
  }
}
