import { Injectable } from '@nestjs/common';
import { Prisma, type Job } from '@24f/db';
import Decimal from 'decimal.js';
import { ApiError } from '../../common/api-error';
import { Paged } from '../../common/envelope.interceptor';
import { SettingsService } from '../settings/settings.service';
import {
  EmployerCore,
  allowedActions,
  committed,
  dec,
  dhakaDate,
  expectedReserve,
  feeFor,
  shortTitle,
  slotsLeftOf,
  unitCost,
  usd2,
  usd2Up,
  usd3,
  type Tx,
} from '../employer/employer-common';
import {
  TIME_MINUTES,
  firstIncompleteStep,
  proofLabel,
  screenContent,
  validateStep,
  type JobFull,
  type JobLimits,
  type JobWrite,
} from './job-rules';

const DAY = 86_400_000;

/** Platform default job rules (BR-026, A-54). Same text as the public job page. */
const DEFAULT_RULES = {
  allowed: ['Do your own work — every row is checked against the photo.', 'One submission per worker. Fix and resubmit if asked.'],
  not_allowed: ['No copy-paste from other workers or automated tools.', 'Don’t share the photos or sheet outside this task.'],
};

/** Fields that lock at the first submission (Doc 04 §5.8, VR-091). */
const LOCKABLE: Record<string, keyof Job | 'steps' | 'proof_requirements'> = {
  title: 'title',
  category: 'categoryId',
  time_per_task: 'timePerTask',
  eligibility: 'eligibility',
  min_approval_rate: 'minApprovalRate',
  steps: 'steps',
  task_link_url: 'taskLinkUrl',
  proof_requirements: 'proof_requirements',
  proof_instructions: 'proofInstructions',
  reward_usd: 'rewardUsd',
  review_window_hours: 'reviewWindowHours',
  auto_approve: 'autoApprove',
  allow_resubmission: 'allowResubmission',
};

const A53_BUCKET: Record<string, string[]> = {
  about_2: ['about_2', 'about_5'],
  about_5: ['about_2', 'about_5'],
  about_10: ['about_10', 'about_15'],
  about_15: ['about_10', 'about_15'],
  about_30: ['about_30', 'about_60'],
  about_60: ['about_30', 'about_60'],
};

@Injectable()
export class JobsService {
  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  async limits(): Promise<JobLimits> {
    const s = this.settings;
    return {
      rewardMin: String(await s.get('reward_min_usd', '0.010')),
      rewardMax: String(await s.get('reward_max_usd', '10.000')),
      slotsMin: await s.number('slots_min', 1),
      slotsMax: await s.number('slots_max', 10000),
      openForDays: await s.get<number[]>('open_for_days_options', [1, 3, 7, 14, 30]),
      minApprovalRates: await s.get<number[]>('min_approval_rate_options', [0, 60, 70, 80, 90, 95]),
      reviewWindows: await s.get<number[]>('review_window_options_hours', [24, 48, 72]),
      shorteners: await s.get<string[]>('url_shortener_domains', []),
    };
  }

  private async full(id: string, tx: Tx = this.db): Promise<JobFull> {
    return tx.job.findUniqueOrThrow({
      where: { id },
      include: {
        jobSteps: { orderBy: { position: 'asc' } },
        jobProofRequirements: { orderBy: { position: 'asc' } },
        category: { select: { slug: true, name: true } },
      },
    }) as Promise<JobFull>;
  }

  private async newPublicId(tx: Tx) {
    const prefix = await this.settings.get<string>('job_id_prefix', 'WJ-');
    for (let i = 0; i < 10; i++) {
      const id = `${prefix}${10000 + Math.floor(Math.random() * 90000)}`;
      const clash = await tx.job.findUnique({ where: { publicId: id }, select: { id: true } });
      if (!clash) return id;
    }
    throw new ApiError('TEMPORARILY_UNAVAILABLE');
  }

  // ---------------------------------------------------------------- DTOs

  lockedFields(j: Job): string[] {
    if (j.firstSubmissionAt) return Object.keys(LOCKABLE);
    if (j.status !== 'draft' && j.countActiveReservations > 0) return ['reward_usd'];
    return [];
  }

  async dto(j: JobFull) {
    const lim = await this.limits();
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const profile = await this.db.employerProfile.findUnique({ where: { userId: j.employerUserId } });
    const incomplete = firstIncompleteStep(j, lim);
    const feePercent = j.status === 'draft' ? await this.settings.number('platform_fee_percent', 0) : Number(j.platformFeePercent);
    return {
      public_id: j.publicId,
      status: j.status,
      pause_reason: j.pauseReason,
      close_reason: j.closeReason,
      wizard_step: j.wizardStep,
      first_incomplete_step: incomplete,
      version: j.version,
      title: j.title,
      category: j.category ? { slug: j.category.slug, name: j.category.name } : null,
      time_per_task: j.timePerTask,
      open_for_days: j.openForDays,
      eligibility: j.eligibility,
      min_approval_rate: j.minApprovalRate,
      steps: j.jobSteps.map((s) => ({ position: s.position, body: s.body })),
      task_link_url: j.taskLinkUrl,
      proof_requirements: j.jobProofRequirements.map((p) => ({
        id: p.id,
        position: p.position,
        proof_type: p.proofType,
        title: p.title,
        field_label: p.fieldLabel,
        helper: p.helper,
        is_required: p.isRequired,
      })),
      proof_instructions: j.proofInstructions,
      reward_usd: j.rewardUsd ? usd3(j.rewardUsd) : null,
      slots_total: j.slotsTotal,
      review_window_hours: j.reviewWindowHours,
      submissions_per_worker: j.submissionsPerWorker,
      allow_resubmission: j.allowResubmission,
      auto_approve: j.autoApprove,
      pause_on_low_deposit: j.pauseOnLowDeposit,
      platform_fee_percent: String(feePercent),
      published_at: j.publishedAt?.toISOString() ?? null,
      ends_at: j.endsAt?.toISOString() ?? null,
      created_at: j.createdAt.toISOString(),
      has_submissions: !!j.firstSubmissionAt,
      locked_fields: this.lockedFields(j),
      counts: {
        approved: j.countApproved,
        to_review: j.countInReview,
        needs_fix: j.countNeedsFix,
        rejected: j.countRejected,
        active_reservations: j.countActiveReservations,
      },
      employer: profile ? { business_name: profile.businessName, employer_verified: !!profile.employerVerifiedAt } : null,
      preview: {
        is_new: !!j.publishedAt && Date.now() - j.publishedAt.getTime() <= newMin * 60_000,
        display_minutes: TIME_MINUTES[j.timePerTask] ?? j.displayMinutes,
        proof_label: proofLabel(j.proofTypes),
        slots_left: j.status === 'draft' ? (j.slotsTotal ?? 0) : slotsLeftOf(j),
      },
      allowed_actions: allowedActions(j),
    };
  }

  // ---------------------------------------------------------------- list

  async list(userId: string, q: { tab: string; q?: string; page: number; per_page: number }) {
    const base: Prisma.JobWhereInput = { employerUserId: userId, deletedAt: null };
    const TAB: Record<string, Prisma.JobWhereInput> = {
      running: { status: 'running' },
      paused: { status: { in: ['paused', 'suspended'] } },
      completed: { status: { in: ['completed', 'cancelled'] } },
      drafts: { status: 'draft' },
    };
    const tab = TAB[q.tab] ? q.tab : 'running';
    const search: Prisma.JobWhereInput = q.q
      ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { publicId: { contains: q.q.toUpperCase() } }] }
      : {};
    const where = { ...base, ...TAB[tab], ...search };
    const [total, rows, grouped] = await Promise.all([
      this.db.job.count({ where }),
      this.db.job.findMany({
        where,
        include: { category: { select: { slug: true, name: true } } },
        orderBy: tab === 'drafts' ? { updatedAt: 'desc' } : tab === 'completed' ? { closedAt: 'desc' } : { publishedAt: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
      this.db.job.groupBy({ by: ['status'], where: { ...base, ...search }, _count: true }),
    ]);
    const c = (s: string[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count, 0);
    const feeNow = await this.settings.number('platform_fee_percent', 0);
    const data = rows.map((j) => {
      const unit = j.status === 'draft' ? dec(j.rewardUsd).plus(feeFor(dec(j.rewardUsd), feeNow)) : unitCost(j);
      return {
        public_id: j.publicId,
        title: j.title,
        category: j.category,
        status: j.status,
        pause_reason: j.pauseReason,
        close_reason: j.closeReason,
        published_at: j.publishedAt?.toISOString() ?? null,
        created_at: j.createdAt.toISOString(),
        updated_at: j.updatedAt.toISOString(),
        paused_at: j.pausedAt?.toISOString() ?? null,
        closed_at: j.closedAt?.toISOString() ?? null,
        ends_at: j.endsAt?.toISOString() ?? null,
        wizard_step: j.wizardStep,
        approved: j.countApproved,
        slots_total: j.slotsTotal ?? 0,
        slots_left: j.status === 'draft' ? (j.slotsTotal ?? 0) : slotsLeftOf(j),
        to_review: j.countInReview,
        spent_usd: usd2(j.spentUsd),
        budget_total_usd: usd2(unit.mul(j.slotsTotal ?? 0)),
        reward_usd: j.rewardUsd ? usd3(j.rewardUsd) : null,
        allowed_actions: allowedActions(j),
      };
    });
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    return new Paged(data, {
      total,
      page: q.page,
      per_page: q.per_page,
      total_pages: totalPages,
      has_more: q.page < totalPages,
      tab,
      counts: { running: c(['running']), paused: c(['paused', 'suspended']), completed: c(['completed', 'cancelled']), drafts: c(['draft']) },
    });
  }

  // ---------------------------------------------------------------- drafts

  async get(userId: string, publicId: string) {
    const j = await this.core.ownJob(userId, publicId);
    return this.dto(await this.full(j.id));
  }

  async create(userId: string, body: JobWrite) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
    if (user.status === 'suspended' || user.status === 'closed') throw new ApiError('ACCOUNT_SUSPENDED');
    if ([...(body.title ?? '').trim()].length < 10 || [...(body.title ?? '').trim()].length > 80)
      throw new ApiError('VALIDATION_FAILED', undefined, { title: ['Use 10–80 characters for the title.'] });
    const profile = await this.core.ensureProfile(userId);
    await this.core.accounts(userId);
    const created = await this.db.$transaction(async (tx) => {
      const publicId = await this.newPublicId(tx);
      const job = await tx.job.create({
        data: {
          publicId,
          employerUserId: userId,
          title: (body.title ?? '').trim().slice(0, 80),
          minApprovalRate: profile.defaultMinApprovalRate,
          reviewWindowHours: profile.defaultReviewWindowHours,
          autoApprove: profile.defaultAutoApprove,
          allowResubmission: profile.defaultAllowResubmission,
          pauseOnLowDeposit: profile.defaultPauseOnLowDeposit,
        },
      });
      await this.applyFields(tx, job, body);
      return job;
    });
    const fresh = await this.full(created.id);
    return { public_id: fresh.publicId, status: fresh.status, wizard_step: fresh.wizardStep, title: fresh.title, version: fresh.version };
  }

  /** Writes wizard fields onto a job row (no money, no lock checks). */
  private async applyFields(tx: Prisma.TransactionClient, job: Job, b: JobWrite) {
    // The database enforces these ranges even on drafts, so check each sent field first.
    const lim = await this.limits();
    const errs: Record<string, string[]> = {};
    if (b.title !== undefined && ([...(b.title ?? '').trim()].length < 10 || [...(b.title ?? '').trim()].length > 80)) errs.title = ['Use 10–80 characters for the title.'];
    if (b.open_for_days !== undefined && job.status === 'draft' && !lim.openForDays.includes(b.open_for_days)) errs.open_for_days = ['Choose how long the job stays open.'];
    if (b.min_approval_rate !== undefined && !lim.minApprovalRates.includes(b.min_approval_rate)) errs.min_approval_rate = ['Choose a minimum approval rate.'];
    if (b.review_window_hours !== undefined && !lim.reviewWindows.includes(b.review_window_hours)) errs.review_window_hours = ['Choose 24, 48 or 72 hours.'];
    if (b.submissions_per_worker !== undefined && b.submissions_per_worker !== 1) errs.submissions_per_worker = ['Each worker can submit once.'];
    if (b.slots_total !== undefined && b.slots_total !== null && (b.slots_total < lim.slotsMin || b.slots_total > lim.slotsMax))
      errs.slots_total = [`Enter between ${lim.slotsMin} and ${lim.slotsMax.toLocaleString('en-US')} slots.`];
    if (b.reward_usd) {
      const ok = /^\d+(\.\d+)?$/.test(b.reward_usd) && new Decimal(b.reward_usd).gte(lim.rewardMin) && new Decimal(b.reward_usd).lte(lim.rewardMax) && new Decimal(b.reward_usd).decimalPlaces() <= 3;
      if (!ok) errs.reward_usd = [`Enter a reward between $${new Decimal(lim.rewardMin).toFixed(3)} and $${new Decimal(lim.rewardMax).toFixed(3)}.`];
    }
    if (b.task_link_url && b.task_link_url.trim() && !/^https:\/\/\S+$/i.test(b.task_link_url.trim())) errs.task_link_url = ['Enter a full link starting with https://.'];
    if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', undefined, errs);
    const data: Prisma.JobUncheckedUpdateInput = {};
    if (b.title !== undefined) data.title = (b.title ?? '').trim().slice(0, 80);
    if (b.category !== undefined) {
      if (b.category === null || b.category === '') data.categoryId = null;
      else {
        const cat = await tx.category.findUnique({ where: { slug: b.category } });
        if (!cat || !cat.isActive) throw new ApiError('VALIDATION_FAILED', undefined, { category: ['Choose a category.'] });
        data.categoryId = cat.id;
      }
    }
    if (b.time_per_task) {
      data.timePerTask = b.time_per_task;
      data.estMinutes = TIME_MINUTES[b.time_per_task];
      data.displayMinutes = TIME_MINUTES[b.time_per_task];
    }
    if (b.open_for_days !== undefined && job.status === 'draft') data.openForDays = b.open_for_days;
    if (b.eligibility) data.eligibility = b.eligibility;
    if (b.min_approval_rate !== undefined) data.minApprovalRate = b.min_approval_rate;
    if (b.task_link_url !== undefined) data.taskLinkUrl = b.task_link_url?.trim() || null;
    if (b.proof_instructions !== undefined) data.proofInstructions = b.proof_instructions?.trim().slice(0, 300) || null;
    if (b.reward_usd !== undefined) {
      if (b.reward_usd === null || b.reward_usd === '') data.rewardUsd = null;
      else {
        if (!/^\d+(\.\d+)?$/.test(b.reward_usd)) throw new ApiError('VALIDATION_FAILED', undefined, { reward_usd: ['Enter an amount.'] });
        data.rewardUsd = new Prisma.Decimal(new Decimal(b.reward_usd).toFixed(6));
      }
    }
    if (b.slots_total !== undefined) data.slotsTotal = b.slots_total;
    if (b.review_window_hours !== undefined) data.reviewWindowHours = b.review_window_hours;
    if (b.submissions_per_worker !== undefined) data.submissionsPerWorker = b.submissions_per_worker;
    if (b.allow_resubmission !== undefined) data.allowResubmission = b.allow_resubmission;
    if (b.auto_approve !== undefined) data.autoApprove = b.auto_approve;
    if (b.pause_on_low_deposit !== undefined) data.pauseOnLowDeposit = b.pause_on_low_deposit;
    if (b.wizard_step !== undefined) data.wizardStep = Math.max(job.wizardStep, b.wizard_step);
    if (b.steps) {
      await tx.jobStep.deleteMany({ where: { jobId: job.id } });
      const steps = b.steps.map((s) => s.body.trim()).filter(Boolean);
      if (steps.length) await tx.jobStep.createMany({ data: steps.map((body, i) => ({ jobId: job.id, position: i + 1, body: body.slice(0, 300) })) });
    }
    if (b.proof_requirements) {
      const seen = new Set<string>();
      const reqs = b.proof_requirements.filter((p) => (seen.has(p.proof_type) ? false : (seen.add(p.proof_type), true)));
      await tx.jobProofRequirement.deleteMany({ where: { jobId: job.id } });
      if (reqs.length)
        await tx.jobProofRequirement.createMany({
          data: reqs.map((p, i) => ({
            jobId: job.id,
            position: i + 1,
            proofType: p.proof_type,
            title: p.title.slice(0, 80),
            fieldLabel: p.field_label ?? null,
            helper: p.helper ?? null,
            isRequired: p.is_required ?? true,
          })),
        });
      data.proofTypes = reqs.map((p) => p.proof_type);
    }
    if (Object.keys(data).length || b.steps || b.proof_requirements) {
      await tx.job.update({ where: { id: job.id }, data: { ...data, version: { increment: 1 } } });
    }
  }

  async update(userId: string, publicId: string, b: JobWrite) {
    const own = await this.core.ownJob(userId, publicId);
    const lim = await this.limits();
    const res = await this.db.$transaction(async (tx) => {
      const job = await this.core.lockJob(tx, own.id);
      if (b.expected_version !== undefined && b.expected_version !== job.version)
        throw new ApiError('INVALID_STATE', 'This job was changed in another tab. Reload to see the latest version.', undefined, { version: job.version });
      if (job.status === 'suspended') throw new ApiError('JOB_SUSPENDED', undefined, undefined, { reason: job.suspensionReason });
      if (job.status === 'completed' || job.status === 'cancelled') throw new ApiError('INVALID_STATE', 'This job has ended and can’t be edited.');
      const published = job.status !== 'draft';

      // Edit lock (VR-091).
      const before = await this.full(job.id, tx);
      const locked = this.lockedFields(job);
      const changed = Object.keys(LOCKABLE).filter((k) => {
        const v = (b as Record<string, unknown>)[k];
        if (v === undefined) return false;
        switch (k) {
          case 'category':
            return v !== (before.category?.slug ?? null);
          case 'steps':
            return JSON.stringify((v as { body: string }[]).map((s) => s.body.trim())) !== JSON.stringify(before.jobSteps.map((s) => s.body));
          case 'proof_requirements':
            return JSON.stringify((v as { proof_type: string }[]).map((p) => p.proof_type)) !== JSON.stringify(before.jobProofRequirements.map((p) => p.proofType));
          case 'reward_usd':
            return !dec(v as string).eq(dec(job.rewardUsd));
          case 'title':
            return (v as string).trim() !== job.title;
          default:
            return v !== (job as unknown as Record<string, unknown>)[LOCKABLE[k] as string];
        }
      });
      const lockedHits = changed.filter((k) => locked.includes(k));
      if (lockedHits.length) throw new ApiError('JOB_LOCKED', undefined, undefined, { locked_fields: lockedHits });

      // Slots floor on a published job.
      if (published && b.slots_total !== undefined && b.slots_total !== null) {
        const floor = job.countApproved + committed(job);
        if (b.slots_total < Math.max(1, floor))
          throw new ApiError('VALIDATION_FAILED', undefined, { slots_total: [`Keep at least ${Math.max(1, floor)} slots: they are approved or in progress.`] });
        if (b.slots_total > lim.slotsMax) throw new ApiError('VALIDATION_FAILED', undefined, { slots_total: [`Enter at most ${lim.slotsMax} slots.`] });
      }

      // Extend "Keep open for" (FR-EJOB-027, VR-090).
      let endsAt = job.endsAt;
      if (b.extend_days !== undefined) {
        if (!published || !job.endsAt || !job.publishedAt) throw new ApiError('INVALID_STATE', 'Only published jobs can be extended.');
        if (![1, 3, 7, 14, 30].includes(b.extend_days)) throw new ApiError('VALIDATION_FAILED', undefined, { extend_days: ['Choose 1, 3, 7, 14 or 30 days.'] });
        const next = new Date(job.endsAt.getTime() + b.extend_days * DAY);
        if (next.getTime() - job.publishedAt.getTime() > 90 * DAY) throw new ApiError('JOB_EXTENSION_LIMIT');
        endsAt = next;
        await tx.job.update({ where: { id: job.id }, data: { endsAt: next } });
      }

      await this.applyFields(tx, job, { ...b, extend_days: undefined, open_for_days: published ? undefined : b.open_for_days });
      if (b.reward_usd !== undefined && published) {
        const fresh = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
        await tx.job.update({ where: { id: job.id }, data: { feePerTaskUsd: new Prisma.Decimal(feeFor(dec(fresh.rewardUsd), dec(job.platformFeePercent)).toFixed(6)) } });
      }

      // Step validation for the step being saved.
      const after = await this.full(job.id, tx);
      if (b.wizard_step && b.wizard_step <= 3) {
        const errs = validateStep(b.wizard_step, after, lim);
        if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', undefined, errs);
      } else if (published) {
        for (const s of [1, 2, 3]) {
          const errs = validateStep(s, after, lim);
          if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', undefined, errs);
        }
      }

      // Money difference on a running job (FR-EJOB-022).
      let reserveChange: { kind: string; amount_usd: string; ledger_ref: string | null } | null = null;
      if (after.status === 'running' && (b.reward_usd !== undefined || b.slots_total !== undefined)) {
        const diff = expectedReserve(after).minus(dec(after.reserveOutstandingUsd));
        if (!diff.isZero()) {
          if (b.confirm_total_reserved_usd !== undefined) {
            const total = unitCost(after).mul(after.slotsTotal ?? 0);
            if (!this.sameAmount(b.confirm_total_reserved_usd, total)) throw new ApiError('QUOTE_CHANGED', undefined, undefined, { total_reserved_usd: usd2(total) });
          }
          const dir = diff.gt(0) ? 'reserve' : 'release';
          const t = await this.core.moveReserve(
            tx,
            after,
            dir,
            diff.abs(),
            `job:${after.publicId}:edit:${after.version}`,
            dir === 'reserve'
              ? { title: after.title, slots: after.slotsTotal, reward: usd3(after.rewardUsd), kind: 'edit' }
              : { title: after.title, reason: 'slots removed' },
            { userId },
          );
          reserveChange = { kind: dir === 'reserve' ? 'job_reserve' : 'job_release', amount_usd: usd2(diff.abs()), ledger_ref: t?.publicRef ?? null };
        }
      }
      const final = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
      return {
        public_id: final.publicId,
        status: final.status,
        version: final.version,
        wizard_step: final.wizardStep,
        ends_at: (endsAt ?? final.endsAt)?.toISOString() ?? null,
        reserve_change: reserveChange,
      };
    });
    return res;
  }

  private sameAmount(shown: string, actual: Decimal) {
    try {
      const s = new Decimal(shown);
      return s.eq(actual) || s.eq(actual.toDecimalPlaces(2, Decimal.ROUND_DOWN)) || s.eq(actual.toDecimalPlaces(2, Decimal.ROUND_UP));
    } catch {
      return false;
    }
  }

  async remove(userId: string, publicId: string) {
    const j = await this.core.ownJob(userId, publicId);
    if (j.status !== 'draft') throw new ApiError('JOB_NOT_DELETABLE');
    await this.db.job.update({ where: { id: j.id }, data: { deletedAt: new Date() } });
    return { public_id: j.publicId, deleted: true };
  }

  // ---------------------------------------------------------------- quote and publish

  async gates(userId: string) {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
    const blockers: string[] = [];
    if (!u.emailVerifiedAt && !u.phoneVerifiedAt) blockers.push('verification_required');
    if (u.status !== 'active') blockers.push('account_restricted');
    return blockers;
  }

  async quote(userId: string, publicId: string, body: { reward_usd?: string; slots_total?: number }) {
    const own = await this.core.ownJob(userId, publicId);
    const j = await this.full(own.id);
    const lim = await this.limits();
    const feePercent = j.status === 'draft' ? await this.settings.number('platform_fee_percent', 0) : Number(j.platformFeePercent);
    const reward = body.reward_usd && /^\d+(\.\d+)?$/.test(body.reward_usd) ? new Decimal(body.reward_usd) : dec(j.rewardUsd);
    const slots = body.slots_total ?? j.slotsTotal ?? 0;
    const fee = feeFor(reward, feePercent);
    const unit = reward.plus(fee);
    const total = unit.mul(slots);
    const { available } = await this.core.balances(userId);
    const receivable = (await this.db.employerProfile.findUnique({ where: { userId }, select: { receivableUsd: true } }))?.receivableUsd;
    const shortfall = Decimal.max(0, total.minus(available));
    const blockers = await this.gates(userId);
    if (shortfall.gt(0)) blockers.push('insufficient_balance');
    if (dec(receivable).gt(0)) blockers.push('receivable_outstanding');
    const incomplete = firstIncompleteStep({ ...j, rewardUsd: new Prisma.Decimal(reward.toFixed(6)), slotsTotal: slots }, lim);
    if (incomplete) blockers.push('job_incomplete');
    return {
      reward_usd: usd3(reward),
      slots_total: slots,
      fee_per_task_usd: usd3(fee),
      platform_fee_percent: String(feePercent),
      unit_cost_usd: usd3(unit),
      max_spend_usd: usd2(reward.mul(slots)),
      platform_fee_total_usd: usd2(fee.mul(slots)),
      total_reserved_usd: usd2(total),
      total_reserved_exact_usd: total.toFixed(6),
      available_usd: usd2(available),
      available_after_usd: usd2(available.minus(total)),
      deposit_balance_usd: usd2((await this.core.balances(userId)).total),
      shortfall_usd: usd2Up(shortfall),
      can_publish: blockers.length === 0,
      blockers,
      first_incomplete_step: incomplete,
    };
  }

  async publish(userId: string, publicId: string, body: { posting_rules_accepted?: boolean; expected_total_reserved_usd?: string }) {
    const own = await this.core.ownJob(userId, publicId);
    const lim = await this.limits();
    const gates = await this.gates(userId);
    if (gates.includes('verification_required')) throw new ApiError('VERIFICATION_REQUIRED');
    if (gates.includes('account_restricted')) throw new ApiError('ACCOUNT_RESTRICTED');
    const lists = {
      blockTerms: await this.settings.get<string[]>('moderation_blocklist_terms', []),
      blockDomains: await this.settings.get<string[]>('moderation_blocklist_domains', []),
      shorteners: lim.shorteners,
      watchTerms: await this.settings.get<string[]>('moderation_watchlist_terms', []),
    };
    const feePercent = await this.settings.number('platform_fee_percent', 0);
    const preMode = (await this.settings.get<string>('job_moderation_mode', 'post')) === 'pre';

    const out = await this.db.$transaction(async (tx) => {
      const locked = await this.core.lockJob(tx, own.id);
      if (locked.status !== 'draft') throw new ApiError('INVALID_STATE', 'This job is already published.');
      const job = await this.full(locked.id, tx);
      const incomplete = firstIncompleteStep(job, lim);
      if (incomplete) throw new ApiError('JOB_INCOMPLETE', undefined, undefined, { first_incomplete_step: incomplete });
      if (!body.posting_rules_accepted) throw new ApiError('POSTING_RULES_REQUIRED');
      const profile = await this.core.ensureProfile(userId, tx);
      if (dec(profile.receivableUsd).gt(0)) throw new ApiError('RECEIVABLE_OUTSTANDING', undefined, undefined, { receivable_usd: usd2(profile.receivableUsd) });
      const screen = screenContent(job, lists);
      if (screen.result === 'block') throw new ApiError('JOB_CONTENT_BLOCKED', `This job can't be published: ${screen.reason}.`, undefined, { reason: screen.reason });

      const fee = feeFor(dec(job.rewardUsd), feePercent);
      const unit = dec(job.rewardUsd).plus(fee);
      const total = unit.mul(job.slotsTotal ?? 0);
      if (body.expected_total_reserved_usd === undefined || !this.sameAmount(body.expected_total_reserved_usd, total))
        throw new ApiError('QUOTE_CHANGED', undefined, undefined, { total_reserved_usd: usd2(total) });
      const acc = await this.core.lockAccounts(userId, tx);
      if (acc.availableBal.lt(total)) {
        const short = total.minus(acc.availableBal);
        throw new ApiError('INSUFFICIENT_BALANCE', `You need $${usd2Up(short)} more to publish. Add funds or lower the slots or reward.`, undefined, {
          shortfall_usd: usd2Up(short),
          available_usd: usd2(acc.availableBal),
        });
      }
      const t = await this.core.moveReserve(
        tx,
        job,
        'reserve',
        total,
        `job:${job.publicId}:publish`,
        { title: job.title, slots: job.slotsTotal, reward: usd3(job.rewardUsd), ...(feePercent > 0 ? { fee_percent: String(feePercent) } : {}) },
        { userId },
      );
      const now = new Date();
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: preMode ? 'paused' : 'running',
          pauseReason: preMode ? 'admin' : null,
          pausedAt: preMode ? now : null,
          platformFeePercent: new Prisma.Decimal(feePercent),
          feePerTaskUsd: new Prisma.Decimal(fee.toFixed(6)),
          publishedAt: now,
          endsAt: new Date(now.getTime() + job.openForDays * DAY),
          postingRulesAcceptedAt: now,
          rules: (job.rules ?? DEFAULT_RULES) as Prisma.InputJsonValue,
          moderationFlags: screen.result === 'flag' ? (screen.hits as Prisma.InputJsonValue) : Prisma.JsonNull,
          moderationFlaggedAt: screen.result === 'flag' ? now : null,
          wizardStep: 4,
          version: { increment: 1 },
        },
      });
      if (preMode) {
        await this.core.moveReserve(tx, job, 'release', total, `job:${job.publicId}:pause:1`, { title: job.title, reason: 'paused, budget released' });
      }
      await tx.employerProfile.update({ where: { userId }, data: { jobsPostedCount: { increment: 1 } } });
      const after = await this.core.balances(userId, tx);
      const fresh = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
      return {
        public_id: fresh.publicId,
        status: fresh.status,
        published_at: fresh.publishedAt!.toISOString(),
        ends_at: fresh.endsAt!.toISOString(),
        total_reserved_usd: usd2(total),
        ledger_ref: t?.publicRef ?? null,
        available_after_usd: usd2(after.available),
        title: fresh.title,
      };
    });
    await this.core.notify({
      userId,
      audience: 'employer',
      category: 'tasks',
      type: 'job_published',
      title: 'Job published',
      body: `“${out.title}” is live. $${out.total_reserved_usd} is reserved from your deposit.`,
      linkPath: `/employer/jobs/${out.public_id}`,
      data: { job_public_id: out.public_id },
    });
    return out;
  }

  // ---------------------------------------------------------------- lifecycle

  async pause(userId: string, publicId: string, reason: 'employer' | 'low_deposit' = 'employer') {
    const own = await this.core.ownJob(userId, publicId);
    return this.db.$transaction(async (tx) => {
      const job = await this.core.lockJob(tx, own.id);
      if (job.status === 'suspended') throw new ApiError('JOB_SUSPENDED', undefined, undefined, { reason: job.suspensionReason });
      if (job.status !== 'running') throw new ApiError('INVALID_STATE', 'Only running jobs can be paused.');
      const release = Decimal.max(0, dec(job.reserveOutstandingUsd).minus(expectedReserve(job, 'paused')));
      const n = await this.core.nextCounter(tx, `job:${job.publicId}:pause:`);
      const t = await this.core.moveReserve(tx, job, 'release', release, `job:${job.publicId}:pause:${n}`, { title: job.title, reason: 'paused, budget released' }, { userId });
      const now = new Date();
      await tx.job.update({ where: { id: job.id }, data: { status: 'paused', pauseReason: reason, pausedAt: now, version: { increment: 1 } } });
      return { public_id: job.publicId, status: 'paused', pause_reason: reason, paused_at: now.toISOString(), released_usd: usd2(release), ledger_ref: t?.publicRef ?? null };
    });
  }

  async resume(userId: string, publicId: string, body: { expected_reserve_usd?: string }) {
    const own = await this.core.ownJob(userId, publicId);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
    if (user.status !== 'active') throw new ApiError('ACCOUNT_RESTRICTED');
    let lowDeposit = false;
    try {
      return await this.db.$transaction(async (tx) => {
        const job = await this.core.lockJob(tx, own.id);
        if (job.status === 'suspended' || (job.status === 'paused' && job.pauseReason === 'admin'))
          throw new ApiError('INVALID_STATE', 'This job was paused by 24 Freelancing. Contact us to resume it.');
        if (job.status !== 'paused') throw new ApiError('INVALID_STATE', 'Only paused jobs can be resumed.');
        if (job.endsAt && job.endsAt <= new Date()) throw new ApiError('INVALID_STATE', 'This job has reached its end date.');
        const need = Decimal.max(0, expectedReserve(job, 'running').minus(dec(job.reserveOutstandingUsd)));
        if (body.expected_reserve_usd !== undefined && !this.sameAmount(body.expected_reserve_usd, need))
          throw new ApiError('QUOTE_CHANGED', undefined, undefined, { total_reserved_usd: usd2(need) });
        const acc = await this.core.lockAccounts(userId, tx);
        if (acc.availableBal.lt(need)) {
          lowDeposit = job.pauseOnLowDeposit;
          throw new ApiError('INSUFFICIENT_BALANCE', `You need $${usd2Up(need.minus(acc.availableBal))} more to resume this job. Add funds first.`, undefined, {
            shortfall_usd: usd2Up(need.minus(acc.availableBal)),
            available_usd: usd2(acc.availableBal),
          });
        }
        const n = await this.core.nextCounter(tx, `job:${job.publicId}:resume:`);
        const t = await this.core.moveReserve(
          tx,
          job,
          'reserve',
          need,
          `job:${job.publicId}:resume:${n}`,
          { title: job.title, slots: slotsLeftOf(job), reward: usd3(job.rewardUsd), kind: 'resume' },
          { userId },
        );
        await tx.job.update({ where: { id: job.id }, data: { status: 'running', pauseReason: null, pausedAt: null, version: { increment: 1 } } });
        return { public_id: job.publicId, status: 'running', reserved_usd: usd2(need), ledger_ref: t?.publicRef ?? null };
      });
    } catch (e) {
      // Doc 04 §5.7: stays paused, flagged so the next deposit can resume it.
      if (lowDeposit) await this.db.job.update({ where: { id: own.id }, data: { pauseReason: 'low_deposit' } }).catch(() => undefined);
      throw e;
    }
  }

  async close(userId: string, publicId: string) {
    const own = await this.core.ownJob(userId, publicId);
    return this.db.$transaction(async (tx) => {
      const job = await this.core.lockJob(tx, own.id);
      if (job.status === 'suspended') throw new ApiError('JOB_SUSPENDED', undefined, undefined, { reason: job.suspensionReason });
      if (job.status !== 'running' && job.status !== 'paused') throw new ApiError('INVALID_STATE', 'Only running or paused jobs can be closed.');
      const keep = expectedReserve(job, 'cancelled');
      const release = Decimal.max(0, dec(job.reserveOutstandingUsd).minus(keep));
      const t = await this.core.moveReserve(tx, job, 'release', release, `job:${job.publicId}:close`, { title: job.title, reason: 'job closed, unused slots' }, { userId });
      const now = new Date();
      await tx.job.update({ where: { id: job.id }, data: { status: 'cancelled', closeReason: 'employer_closed', closedAt: now, pauseReason: null, version: { increment: 1 } } });
      return {
        public_id: job.publicId,
        status: 'cancelled',
        close_reason: 'employer_closed',
        closed_at: now.toISOString(),
        released_usd: usd2(release),
        still_committed_usd: usd2(keep),
        to_review: job.countInReview,
        ledger_ref: t?.publicRef ?? null,
      };
    });
  }

  async addSlots(userId: string, publicId: string, body: { add_slots: number; expected_amount_usd?: string }, idemKey: string) {
    const own = await this.core.ownJob(userId, publicId);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
    if (user.status !== 'active') throw new ApiError('ACCOUNT_RESTRICTED');
    const max = await this.settings.number('slots_max', 10000);
    return this.db.$transaction(async (tx) => {
      const job = await this.core.lockJob(tx, own.id);
      if (job.status === 'suspended') throw new ApiError('JOB_SUSPENDED', undefined, undefined, { reason: job.suspensionReason });
      if (job.status !== 'running' && job.status !== 'paused') throw new ApiError('INVALID_STATE', 'Slots can only be added to running or paused jobs.');
      const n = body.add_slots;
      const room = max - (job.slotsTotal ?? 0);
      if (!Number.isInteger(n) || n < 1 || n > room) throw new ApiError('VALIDATION_FAILED', undefined, { add_slots: [`Add between 1 and ${room} slots.`] });
      const amount = job.status === 'running' ? unitCost(job).mul(n) : new Decimal(0);
      if (body.expected_amount_usd !== undefined && !this.sameAmount(body.expected_amount_usd, amount))
        throw new ApiError('QUOTE_CHANGED', undefined, undefined, { total_reserved_usd: usd2(amount) });
      await tx.job.update({ where: { id: job.id }, data: { slotsTotal: { increment: n }, version: { increment: 1 } } });
      const t =
        job.status === 'running'
          ? await this.core.moveReserve(
              tx,
              job,
              'reserve',
              amount,
              `job:${job.publicId}:slots:${idemKey}`,
              { title: job.title, slots: n, added: n, reward: usd3(job.rewardUsd), kind: 'add_slots' },
              { userId },
            )
          : null;
      const fresh = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
      const bal = await this.core.balances(userId, tx);
      return {
        public_id: fresh.publicId,
        status: fresh.status,
        slots_total: fresh.slotsTotal,
        slots_left: slotsLeftOf(fresh),
        added: n,
        amount_usd: usd2(amount),
        ledger_ref: t?.publicRef ?? null,
        available_after_usd: usd2(bal.available),
      };
    });
  }

  async duplicate(userId: string, publicId: string) {
    const own = await this.core.ownJob(userId, publicId);
    if (own.status === 'suspended') throw new ApiError('JOB_SUSPENDED');
    const src = await this.full(own.id);
    const copy = await this.db.$transaction(async (tx) => {
      const pid = await this.newPublicId(tx);
      const title = `Copy of ${src.title}`.slice(0, 80);
      const job = await tx.job.create({
        data: {
          publicId: pid,
          employerUserId: userId,
          categoryId: src.categoryId,
          title,
          timePerTask: src.timePerTask,
          estMinutes: src.estMinutes,
          displayMinutes: src.displayMinutes,
          openForDays: [1, 3, 7, 14, 30].includes(src.openForDays) ? src.openForDays : 7,
          eligibility: src.eligibility,
          minApprovalRate: src.minApprovalRate,
          taskLinkUrl: src.taskLinkUrl,
          proofInstructions: src.proofInstructions,
          proofTypes: src.proofTypes,
          rules: (src.rules ?? undefined) as Prisma.InputJsonValue | undefined,
          rewardUsd: src.rewardUsd,
          slotsTotal: src.slotsTotal,
          reviewWindowHours: src.reviewWindowHours,
          allowResubmission: src.allowResubmission,
          autoApprove: src.autoApprove,
          pauseOnLowDeposit: src.pauseOnLowDeposit,
          duplicatedFromJobId: src.id,
          wizardStep: 1,
        },
      });
      if (src.jobSteps.length) await tx.jobStep.createMany({ data: src.jobSteps.map((s) => ({ jobId: job.id, position: s.position, body: s.body })) });
      if (src.jobProofRequirements.length)
        await tx.jobProofRequirement.createMany({
          data: src.jobProofRequirements.map((p) => ({
            jobId: job.id,
            position: p.position,
            proofType: p.proofType,
            title: p.title,
            fieldLabel: p.fieldLabel,
            helper: p.helper,
            isRequired: p.isRequired,
          })),
        });
      return job;
    });
    return { public_id: copy.publicId, status: 'draft', title: copy.title, duplicated_from: src.publicId, next_path: `/employer/jobs/${copy.publicId}/edit?step=1` };
  }

  // ---------------------------------------------------------------- analytics

  async performance(userId: string, publicId: string) {
    const j = await this.core.ownJob(userId, publicId);
    const subs = await this.db.submission.findMany({
      where: { jobId: j.id },
      select: { status: true, firstSubmittedAt: true, lastSubmittedAt: true, decidedAt: true, decisionSource: true, rejectionReasonCode: true, reviewDueAt: true },
    });
    const DAYS = 30;
    const start = j.publishedAt ?? j.createdAt;
    const endT = Math.min(Date.now(), (j.endsAt ?? new Date()).getTime(), (j.closedAt ?? new Date(8.64e15)).getTime());
    const days: { date: string; label: string; approved: number; rejected: number; waiting: number }[] = [];
    const firstDay = new Date(Math.max(start.getTime(), endT - (DAYS - 1) * DAY));
    for (let t = new Date(dhakaDate(firstDay) + 'T00:00:00+06:00').getTime(); t <= endT; t += DAY) {
      const date = dhakaDate(new Date(t));
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(t));
      days.push({ date, label, approved: 0, rejected: 0, waiting: 0 });
    }
    for (const s of subs) {
      const d = days.find((x) => x.date === dhakaDate(s.firstSubmittedAt));
      if (!d) continue;
      if (s.status === 'approved') d.approved++;
      else if (s.status === 'in_review') d.waiting++;
      else d.rejected++;
    }
    const yMax = Math.max(1, ...days.map((d) => d.approved + d.rejected + d.waiting));
    const decided = subs.filter((s) => s.decidedAt && s.decisionSource === 'employer');
    const avgReviewHours = decided.length
      ? Math.round(decided.reduce((n, s) => n + (s.decidedAt!.getTime() - s.lastSubmittedAt.getTime()), 0) / decided.length / 3_600_000)
      : null;
    const reasonCounts: Record<string, number> = {};
    for (const s of subs) if (s.rejectionReasonCode && s.status !== 'approved') reasonCounts[s.rejectionReasonCode] = (reasonCounts[s.rejectionReasonCode] ?? 0) + 1;
    const LABEL: Record<string, string> = {
      proof_incomplete: 'Proof incomplete',
      steps_not_followed: 'Steps not followed',
      wrong_or_copied: 'Wrong or copied answer',
      link_not_accessible: 'Link not accessible',
      other: 'Other',
    };
    const reasons = Object.keys(LABEL)
      .filter((k) => k !== 'other' || (reasonCounts[k] ?? 0) > 0)
      .map((code) => ({ code, label: LABEL[code], count: reasonCounts[code] ?? 0 }));
    const waiting = subs.filter((s) => s.status === 'in_review');
    const oldest = waiting.reduce<Date | null>((m, s) => (!m || s.lastSubmittedAt < m ? s.lastSubmittedAt : m), null);
    const due = waiting.reduce<Date | null>((m, s) => (!m || s.reviewDueAt < m ? s.reviewDueAt : m), null);
    const submitted = subs.length;
    const budgetTotal = unitCost(j).mul(j.slotsTotal ?? 0);
    return {
      job: {
        public_id: j.publicId,
        title: j.title,
        status: j.status,
        pause_reason: j.pauseReason,
        close_reason: j.closeReason,
        published_at: j.publishedAt?.toISOString() ?? null,
        paused_at: j.pausedAt?.toISOString() ?? null,
        ends_at: j.endsAt?.toISOString() ?? null,
        reward_usd: usd3(j.rewardUsd),
        slots_total: j.slotsTotal ?? 0,
        slots_left: slotsLeftOf(j),
        allowed_actions: allowedActions(j),
      },
      kpis: {
        to_review: j.countInReview,
        approved: j.countApproved,
        rejected: j.countNeedsFix + j.countRejected,
        spent_usd: usd2(j.spentUsd),
        budget_left_usd: usd2(j.reserveOutstandingUsd),
        budget_total_usd: usd2(budgetTotal),
        avg_review_hours: avgReviewHours,
      },
      chart: { days, y_max: yMax },
      funnel: {
        opened: j.countViews,
        started: j.countStarts,
        submitted,
        approved: j.countApproved,
        opened_to_submitted_percent: j.countViews > 0 ? ((submitted / j.countViews) * 100).toFixed(1) : null,
      },
      rejection_reasons: reasons,
      settings: {
        reward_usd: usd3(j.rewardUsd),
        slots_total: j.slotsTotal ?? 0,
        review_window_hours: j.reviewWindowHours,
        auto_approve: j.autoApprove,
        allow_resubmission: j.allowResubmission,
        pause_on_low_deposit: j.pauseOnLowDeposit,
        open_for_days: j.openForDays,
      },
      review_cta: {
        visible: waiting.length > 0,
        waiting: waiting.length,
        oldest_submitted_at: oldest?.toISOString() ?? null,
        auto_approve_at: j.autoApprove && due ? due.toISOString() : null,
      },
    };
  }

  async marketRates(q: { category?: string; time_per_task?: string }) {
    const none = { available: false, minutes: null, category_name: null, low_usd: null, high_usd: null, sample_size: 0 };
    if (!q.category || !q.time_per_task || !A53_BUCKET[q.time_per_task]) return none;
    const cat = await this.db.category.findUnique({ where: { slug: q.category } });
    if (!cat) return none;
    const minJobs = await this.settings.number('market_hint_min_jobs', 5);
    const windowDays = await this.settings.number('market_hint_window_days', 30);
    const rows = await this.db.$queryRaw<{ p25: number | null; p75: number | null; n: number }[]>`
      SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY reward_usd) AS p25,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY reward_usd) AS p75, count(*)::int AS n
      FROM jobs WHERE status = 'running' AND deleted_at IS NULL AND category_id = ${cat.id}::uuid
        AND time_per_task::text IN (${Prisma.join(A53_BUCKET[q.time_per_task])})
        AND published_at >= now() - make_interval(days => ${windowDays}::int)`;
    const r = rows[0];
    if (!r || r.n < minJobs || r.p25 === null || r.p75 === null) return { ...none, sample_size: r?.n ?? 0 };
    return {
      available: true,
      minutes: TIME_MINUTES[q.time_per_task],
      category_name: cat.name.toLowerCase(),
      low_usd: new Decimal(r.p25).toFixed(2),
      high_usd: new Decimal(r.p75).toFixed(2),
      sample_size: r.n,
    };
  }

  async categories() {
    const rows = await this.db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { slug: true, name: true } });
    return rows;
  }

  shortTitle = shortTitle;
}
