import { Injectable } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { initials, maskName } from '@24f/shared';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { EmployerCore, dec, dhakaDayStart, dhakaMonthStart, slotsLeftOf, unitCost, usd2, usd3 } from './employer-common';

const DAY = 86_400_000;

/** Overview, spending chart, profile and job defaults (Doc 06 §5.8, §5.10). */
@Injectable()
export class EmployerService {
  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  private async reservedAccountId(userId: string) {
    const acc = await this.db.walletAccount.findFirst({ where: { ownerUserId: userId, kind: 'employer_reserved' }, select: { id: true } });
    return acc?.id ?? null;
  }

  /** Spend on the reserved account (job_spend + platform_fee) and approvals in [from, to). */
  async spendBetween(userId: string, from: Date, to: Date) {
    const rid = await this.reservedAccountId(userId);
    if (!rid) return { amount: new Decimal(0), tasks: 0 };
    const rows = await this.db.$queryRaw<{ amount: Prisma.Decimal | null; tasks: number }[]>`
      SELECT -COALESCE(SUM(e.amount), 0) AS amount,
             COUNT(*) FILTER (WHERE e.display_type = 'job_spend')::int AS tasks
      FROM ledger_entries e
      WHERE e.account_id = ${rid}::uuid AND e.display_type IN ('job_spend', 'platform_fee')
        AND e.created_at >= ${from} AND e.created_at < ${to}`;
    return { amount: dec(rows[0]?.amount), tasks: rows[0]?.tasks ?? 0 };
  }

  /** Month-to-date spend and the RND-13 trend vs the same elapsed days of last month. */
  async monthSpend(userId: string) {
    const now = new Date();
    const start = dhakaMonthStart(0, now);
    const prevStart = dhakaMonthStart(-1, now);
    const elapsed = now.getTime() - start.getTime();
    const cur = await this.spendBetween(userId, start, now);
    const prev = await this.spendBetween(userId, prevStart, new Date(Math.min(prevStart.getTime() + elapsed, start.getTime())));
    const trend = prev.amount.gt(0) ? Math.round(cur.amount.minus(prev.amount).div(prev.amount).mul(100).toNumber()) : null;
    return { spent: cur.amount, tasks: cur.tasks, trend };
  }

  private greeting(name: string) {
    const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(new Date()));
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const short = name.replace(/\b(ltd|limited|inc|llc|co)\.?$/i, '').trim().split(/\s+/)[0] ?? name;
    return `${part}, ${short}`;
  }

  async overview(userId: string) {
    const profile = await this.core.ensureProfile(userId);
    const bal = await this.core.balances(userId);
    const month = await this.monthSpend(userId);
    const waitingRows = await this.db.submission.groupBy({ by: ['jobId'], where: { employerUserId: userId, status: 'in_review' }, _count: true, _min: { lastSubmittedAt: true } });
    const waiting = waitingRows.reduce((n, r) => n + r._count, 0);
    const oldest = waitingRows.map((r) => r._min.lastSubmittedAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const live = await this.db.job.findMany({
      where: { employerUserId: userId, deletedAt: null, status: { in: ['running', 'paused', 'suspended'] } },
      orderBy: [{ publishedAt: 'desc' }],
    });
    const order = { running: 0, paused: 1, suspended: 2 } as Record<string, number>;
    const runningJobs = [...live].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).slice(0, 3);
    const runningCount = live.filter((j) => j.status === 'running').length;
    const lowJobs = live.filter((j) => j.status === 'paused' && j.pauseReason === 'low_deposit');
    const runningUnits = live.filter((j) => j.status === 'running').map((j) => unitCost(j));
    const avgUnit = runningUnits.length ? runningUnits.reduce((s, u) => s.plus(u), new Decimal(0)).div(runningUnits.length) : null;
    const lowVisible = bal.available.lt(0) || lowJobs.length > 0;
    const latest = await this.db.submission.findMany({
      where: { employerUserId: userId, status: 'in_review' },
      orderBy: { lastSubmittedAt: 'desc' },
      take: 4,
      include: { job: { select: { title: true, publicId: true } }, workerUser: { select: { fullName: true } } },
    });
    const unread = await this.db.notification.count({ where: { userId, audience: 'employer', readAt: null, expiresAt: { gt: new Date() } } });
    return {
      greeting: this.greeting(profile.businessName),
      business_name: profile.businessName,
      subtitle_counts: { waiting, running_jobs: runningCount },
      stats: {
        deposit_balance_usd: usd2(bal.total),
        reserved_usd: usd2(bal.reserved),
        available_usd: usd2(bal.available),
        waiting_for_review: waiting,
        waiting_jobs: waitingRows.length,
        oldest_waiting_submitted_at: oldest?.toISOString() ?? null,
        spent_this_month_usd: usd2(month.spent),
        spent_trend_percent: month.trend,
        approved_this_month_tasks: month.tasks,
      },
      alerts: {
        decision_needed: { visible: waiting > 0, count: waiting },
        low_deposit: {
          visible: lowVisible,
          available_usd: usd2(bal.available),
          approvals_covered: lowVisible && avgUnit && avgUnit.gt(0) ? Math.max(0, Math.floor(bal.available.div(avgUnit).toNumber())) : null,
          paused_jobs: lowJobs.length,
        },
      },
      quick_actions: { review_waiting: waiting, deposit_balance_usd: usd2(bal.total) },
      running_jobs: runningJobs.map((j) => ({
        public_id: j.publicId,
        status: j.status,
        pause_reason: j.pauseReason,
        paused_at: j.pausedAt?.toISOString() ?? null,
        title: j.title,
        to_review: j.countInReview,
        approved: j.countApproved,
        slots_total: j.slotsTotal ?? 0,
        slots_left: slotsLeftOf(j),
        spent_usd: usd2(j.spentUsd),
        budget_total_usd: usd2(unitCost(j).mul(j.slotsTotal ?? 0)),
        ends_at: j.endsAt?.toISOString() ?? null,
      })),
      latest_submissions: latest.map((s) => ({
        ref: s.publicRef,
        worker_name_masked: maskName(s.workerUser.fullName),
        worker_initials: initials(s.workerUser.fullName),
        submitted_at: s.lastSubmittedAt.toISOString(),
        job_title: s.job.title,
        job_public_id: s.job.publicId,
        unit_cost_usd: usd3(s.rewardUsd),
      })),
      badges: { submissions: waiting, notifications_unread: unread },
    };
  }

  async spending(userId: string, range: '7d' | '30d' | '90d') {
    const rid = await this.reservedAccountId(userId);
    const now = new Date();
    type Bar = { label: string; date: string; from: Date; to: Date; amount: Decimal; tasks: number };
    const bars: Bar[] = [];
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'Asia/Dhaka' }).format(d);
    if (range === '90d') {
      for (let w = 12; w >= 0; w--) {
        const from = dhakaDayStart(w * 7 + 6, now);
        const to = new Date(dhakaDayStart(w * 7, now).getTime() + DAY);
        bars.push({ label: fmt(from, { month: 'short', day: 'numeric' }), date: new Date(from.getTime() + 6 * 3_600_000).toISOString().slice(0, 10), from, to, amount: new Decimal(0), tasks: 0 });
      }
    } else {
      const n = range === '30d' ? 30 : 7;
      for (let d = n - 1; d >= 0; d--) {
        const from = dhakaDayStart(d, now);
        bars.push({
          label: range === '7d' ? fmt(from, { weekday: 'short' }) : fmt(from, { month: 'short', day: 'numeric' }),
          date: new Date(from.getTime() + 6 * 3_600_000).toISOString().slice(0, 10),
          from,
          to: new Date(from.getTime() + DAY),
          amount: new Decimal(0),
          tasks: 0,
        });
      }
    }
    if (rid) {
      const rows = await this.db.$queryRaw<{ at: Date; amount: Prisma.Decimal; is_spend: boolean }[]>`
        SELECT e.created_at AS at, -e.amount AS amount, (e.display_type = 'job_spend') AS is_spend
        FROM ledger_entries e
        WHERE e.account_id = ${rid}::uuid AND e.display_type IN ('job_spend', 'platform_fee') AND e.created_at >= ${bars[0]!.from}`;
      for (const r of rows) {
        const b = bars.find((x) => r.at >= x.from && r.at < x.to);
        if (!b) continue;
        b.amount = b.amount.plus(dec(r.amount));
        if (r.is_spend) b.tasks++;
      }
    }
    const total = bars.reduce((s, b) => s.plus(b.amount), new Decimal(0));
    const max = bars.reduce((m, b) => Decimal.max(m, b.amount), new Decimal(0));
    const top = max.gt(0) ? max.mul(1.1) : new Decimal(1);
    const ticks = [0, 1, 2, 3].map((i) => top.mul(i).div(3).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2));
    return {
      range,
      total_usd: usd2(total),
      total_tasks: bars.reduce((n, b) => n + b.tasks, 0),
      y_max_usd: ticks[3],
      y_ticks_usd: ticks,
      bars: bars.map((b) => ({ label: b.label, date: b.date, amount_usd: usd2(b.amount), tasks: b.tasks })),
    };
  }

  // ------------------------------------------------------------------ profile

  async profile(userId: string) {
    const p = await this.core.ensureProfile(userId);
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true, email: true, phoneE164: true, twoStepEnabled: true } });
    const deposits = await this.db.deposit.findMany({ where: { employerUserId: userId }, orderBy: { initiatedAt: 'desc' }, take: 10 });
    return {
      public_id: u.publicId,
      business_name: p.businessName,
      initials: initials(p.businessName),
      logo_url: null,
      website_url: p.websiteUrl,
      industry: p.industry,
      billing_email: p.billingEmail,
      about: p.about,
      verification_status: p.verificationStatus,
      employer_verified_at: p.employerVerifiedAt?.toISOString() ?? null,
      verification_note: p.verificationNote,
      approval_rate_pct: p.approvalRatePct,
      jobs_posted_count: p.jobsPostedCount,
      member_since: p.createdAt.toISOString(),
      account: { email: u.email, phone: u.phoneE164, two_step_enabled: u.twoStepEnabled },
      job_defaults: {
        default_review_window_hours: p.defaultReviewWindowHours,
        default_min_approval_rate: p.defaultMinApprovalRate,
        default_auto_approve: p.defaultAutoApprove,
        default_allow_resubmission: p.defaultAllowResubmission,
        default_pause_on_low_deposit: p.defaultPauseOnLowDeposit,
      },
      recent_deposits: deposits.map((d) => ({
        ref: d.publicRef,
        created_at: d.initiatedAt.toISOString(),
        method: d.method,
        amount_usd: usd2(d.amountUsd),
        status: d.status,
      })),
    };
  }

  async updateProfile(userId: string, b: { business_name?: string; website_url?: string | null; industry?: string | null; billing_email?: string | null; about?: string | null }) {
    const p = await this.core.ensureProfile(userId);
    const data: Prisma.EmployerProfileUpdateInput = {};
    let requeued = false;
    if (b.business_name !== undefined) data.businessName = b.business_name;
    if (b.website_url !== undefined) data.websiteUrl = b.website_url || null;
    if (b.industry !== undefined) data.industry = b.industry || null;
    if (b.billing_email !== undefined) data.billingEmail = b.billing_email || null;
    if (b.about !== undefined) data.about = b.about || null;
    // A-50: changing a verified name re-queues verification; first complete profile queues it.
    if (b.business_name !== undefined && b.business_name !== p.businessName && p.verificationStatus === 'verified') {
      Object.assign(data, { verificationStatus: 'pending', employerVerifiedAt: null, verificationSubmittedAt: new Date() });
      requeued = true;
    } else if (p.verificationStatus === 'not_submitted') {
      const name = b.business_name ?? p.businessName;
      const site = b.website_url !== undefined ? b.website_url : p.websiteUrl;
      const mail = b.billing_email !== undefined ? b.billing_email : p.billingEmail;
      if (name && (site || mail)) {
        Object.assign(data, { verificationStatus: 'pending', verificationSubmittedAt: new Date() });
        requeued = true;
      }
    }
    const saved = await this.db.employerProfile.update({ where: { userId }, data });
    return { business_name: saved.businessName, verification_status: saved.verificationStatus, verification_requeued: requeued };
  }

  async updateDefaults(userId: string, b: Record<string, unknown>) {
    await this.core.ensureProfile(userId);
    const windows = await this.settings.get<number[]>('review_window_options_hours', [24, 48, 72]);
    const rates = await this.settings.get<number[]>('min_approval_rate_options', [0, 60, 70, 80, 90, 95]);
    const data: Prisma.EmployerProfileUpdateInput = {};
    if (b.default_review_window_hours !== undefined) {
      if (!windows.includes(Number(b.default_review_window_hours))) throw new ApiError('VALIDATION_FAILED', undefined, { default_review_window_hours: ['Choose 24, 48 or 72 hours.'] });
      data.defaultReviewWindowHours = Number(b.default_review_window_hours);
    }
    if (b.default_min_approval_rate !== undefined) {
      if (!rates.includes(Number(b.default_min_approval_rate))) throw new ApiError('VALIDATION_FAILED', undefined, { default_min_approval_rate: ['Choose a minimum approval rate.'] });
      data.defaultMinApprovalRate = Number(b.default_min_approval_rate);
    }
    if (typeof b.default_auto_approve === 'boolean') data.defaultAutoApprove = b.default_auto_approve;
    if (typeof b.default_allow_resubmission === 'boolean') data.defaultAllowResubmission = b.default_allow_resubmission;
    if (typeof b.default_pause_on_low_deposit === 'boolean') data.defaultPauseOnLowDeposit = b.default_pause_on_low_deposit;
    const p = await this.db.employerProfile.update({ where: { userId }, data });
    return {
      default_review_window_hours: p.defaultReviewWindowHours,
      default_min_approval_rate: p.defaultMinApprovalRate,
      default_auto_approve: p.defaultAutoApprove,
      default_allow_resubmission: p.defaultAllowResubmission,
      default_pause_on_low_deposit: p.defaultPauseOnLowDeposit,
    };
  }
}
