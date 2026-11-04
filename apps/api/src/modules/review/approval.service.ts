import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { formatReward } from '@24f/shared';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReferralCreditService } from '../employer/referral-credit';
import { EmployerCore, dec, shortTitle, unitCost, usd3, usd6 } from '../employer/employer-common';

export type DecisionSource = 'employer' | 'auto' | 'admin';

export interface ApprovalOutcome {
  alreadyApproved: boolean;
  submissionId: string;
  ref: string;
  rewardUsd: Decimal;
  feeUsd: Decimal;
  ledgerRef: string | null;
  jobId: string;
  workerUserId: string;
}

/** Counter moves when a submission leaves a status (Doc 04 §5.12). */
const LEAVE: Record<string, Prisma.JobUpdateInput> = {
  in_review: { countInReview: { decrement: 1 } },
  needs_fix: { countNeedsFix: { decrement: 1 } },
  rejected: { countRejected: { decrement: 1 } },
};

/**
 * The single approval path for employer, bulk and auto decisions (Doc 04 §6.9).
 * One `job_spend` transaction per approval: employer_reserved −reward (display job_spend),
 * worker_earnings +reward (display task_reward, C-30). A fee above 0 posts a separate
 * `platform_fee` transaction in the same commit. Referral commission and notifications run
 * after commit so a failure there never undoes the payment (Doc 08 §9.4).
 */
@Injectable()
export class ApprovalService {
  private readonly log = new Logger('Approval');

  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
    private readonly referrals: ReferralCreditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  async approveInTx(tx: Prisma.TransactionClient, subId: string, source: DecisionSource, actor: { userId?: string }): Promise<ApprovalOutcome> {
    // 1. Lock submission, then job, then wallets (TX-3).
    await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${subId}::uuid FOR UPDATE`;
    const sub = await tx.submission.findUniqueOrThrow({ where: { id: subId } });
    const base = { submissionId: sub.id, ref: sub.publicRef, rewardUsd: dec(sub.rewardUsd), feeUsd: dec(sub.feeUsd), jobId: sub.jobId, workerUserId: sub.workerUserId };
    if (sub.status === 'approved') return { ...base, alreadyApproved: true, ledgerRef: null };
    if (sub.status !== 'in_review') throw new ApiError('ALREADY_DECIDED', undefined, undefined, { status: sub.status });
    const job = await this.core.lockJob(tx, sub.jobId);
    const cost = dec(sub.rewardUsd).plus(dec(sub.feeUsd));
    if (dec(job.reserveOutstandingUsd).lt(cost)) {
      this.log.error(`reserve_short job=${job.publicId} sub=${sub.publicRef} outstanding=${job.reserveOutstandingUsd} cost=${cost}`);
      throw new ApiError('INSUFFICIENT_RESERVE');
    }
    const reserved = await this.core.ledger.userAccount(job.employerUserId, 'employer_reserved', tx);
    const earnings = await this.core.ledger.userAccount(sub.workerUserId, 'worker_earnings', tx);
    const profile = await tx.employerProfile.findUnique({ where: { userId: job.employerUserId }, select: { businessName: true } });

    // 2. Post. The idempotency key makes a repeat a no-op at the ledger too.
    const opId = (await tx.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
    const t1 = await this.core.ledger.post(
      {
        type: 'job_spend',
        idempotencyKey: `submission:${sub.publicRef}:approve`,
        operationId: opId,
        actor: source === 'auto' ? 'system' : 'user',
        userId: source === 'auto' ? undefined : actor.userId,
        description: { title: job.title, employer: profile?.businessName ?? null, decision_source: source },
        refs: { jobId: job.id, submissionId: sub.id },
        lines: [
          { accountId: reserved.id, amount: dec(sub.rewardUsd).neg().toFixed(6), displayType: 'job_spend' },
          { accountId: earnings.id, amount: usd6(sub.rewardUsd), displayType: 'task_reward' },
        ],
      },
      tx,
    );
    if (dec(sub.feeUsd).gt(0)) {
      const revenue = await this.core.ledger.systemAccount('platform_revenue', tx);
      await this.core.ledger.post(
        {
          type: 'platform_fee',
          idempotencyKey: `submission:${sub.publicRef}:fee`,
          operationId: opId,
          description: { title: job.title, percent: String(job.platformFeePercent) },
          refs: { jobId: job.id, submissionId: sub.id },
          lines: [
            { accountId: reserved.id, amount: dec(sub.feeUsd).neg().toFixed(6) },
            { accountId: revenue.id, amount: usd6(sub.feeUsd) },
          ],
        },
        tx,
      );
    }

    // 3. Business rows, same commit.
    const now = new Date();
    await tx.submission.update({
      where: { id: sub.id },
      data: {
        status: 'approved',
        decidedAt: now,
        finalAt: now,
        decisionSource: source,
        decidedByUserId: source === 'employer' ? actor.userId : null,
        rejectionReasonCode: null,
        rejectionReasonText: null,
        fixAllowed: null,
        resubmitDeadline: null,
        paidLedgerTxId: t1.id,
        disputeOpen: false,
      },
    });
    await tx.submissionAttempt.updateMany({ where: { submissionId: sub.id, attemptNo: sub.currentAttemptNo }, data: { decision: 'approved', decidedAt: now } });
    await tx.job.update({
      where: { id: job.id },
      data: {
        ...LEAVE[sub.status],
        countApproved: { increment: 1 },
        spentUsd: { increment: new Prisma.Decimal(cost.toFixed(6)) },
        reserveOutstandingUsd: { decrement: new Prisma.Decimal(cost.toFixed(6)) },
      },
    });
    const actorType = source === 'auto' ? 'system' : 'user';
    await tx.submissionEvent.createMany({
      data: [
        { reservationId: sub.reservationId, submissionId: sub.id, eventType: source === 'auto' ? 'auto_approved' : 'approved', actorType, actorUserId: source === 'employer' ? actor.userId : null },
        { reservationId: sub.reservationId, submissionId: sub.id, eventType: 'paid_to_balance', actorType, actorUserId: source === 'employer' ? actor.userId : null, data: { amount: usd6(sub.rewardUsd) } },
      ],
    });
    await tx.workerProfile.updateMany({ where: { userId: sub.workerUserId }, data: { approvedTotal: { increment: 1 }, approved30d: { increment: 1 } } });

    // 4. Completion in the same transaction (Doc 04 §5.13).
    const fresh = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
    if ((fresh.status === 'running' || fresh.status === 'paused') && fresh.countApproved >= (fresh.slotsTotal ?? 0)) {
      const keep = unitCost(fresh).mul(fresh.countInReview + fresh.countNeedsFix + fresh.countActiveReservations);
      const release = Decimal.max(0, dec(fresh.reserveOutstandingUsd).minus(keep));
      await this.core.moveReserve(tx, fresh, 'release', release, `job:${fresh.publicId}:complete`, { title: fresh.title, reason: 'job completed, unused budget' });
      await tx.job.update({ where: { id: fresh.id }, data: { status: 'completed', closeReason: 'slots_filled', closedAt: now, pauseReason: null } });
    }
    return { ...base, alreadyApproved: false, ledgerRef: t1.publicRef ?? null };
  }

  /** After-commit side effects: worker notification and referral commission (Doc 08 §9.4). */
  async afterApproval(o: ApprovalOutcome, source: DecisionSource) {
    if (o.alreadyApproved) return;
    try {
      const sub = await this.db.submission.findUnique({ where: { id: o.submissionId }, include: { job: { select: { title: true, employerUserId: true } } } });
      if (!sub) return;
      const profile = await this.db.employerProfile.findUnique({ where: { userId: sub.job.employerUserId }, select: { businessName: true } });
      const vars = { reward: formatReward(sub.rewardUsd.toString()), job: sub.job.title, employer: profile?.businessName ?? 'The employer', ref: sub.publicRef };
      if (this.notifications) await this.notifications.notify(source === 'auto' ? 'task_auto_approved' : 'task_approved', sub.workerUserId, vars, { data: { submission_ref: sub.publicRef, amount: usd6(sub.rewardUsd) } });
      else
        await this.core.notify({
          userId: sub.workerUserId,
          audience: 'worker',
          category: 'tasks',
          type: source === 'auto' ? 'task_auto_approved' : 'task_approved',
          title: `Task approved · +${vars.reward}`,
          body: `“${vars.job}” was approved by ${vars.employer}.`,
          linkPath: `/worker/tasks/${sub.publicRef}`,
        });
    } catch (e) {
      this.log.warn(`approval notify failed ${o.ref}: ${String(e)}`);
    }
    await this.creditReferral(o).catch((e) => this.log.error(`referral commission failed ${o.ref}: ${String(e)}`));
  }

  /**
   * Task referral commission (Doc 08 §9): 5% of the reward from `referral_expense` to the
   * referrer's `worker_earnings`, idempotent on `referral:task:{submission_id}`.
   */
  async creditReferral(o: Pick<ApprovalOutcome, 'submissionId' | 'workerUserId' | 'rewardUsd'>) {
    return this.referrals.credit({ source: 'task', friendUserId: o.workerUserId, baseUsd: o.rewardUsd, submissionId: o.submissionId });
  }

  /**
   * Safety net for the after-commit step (Doc 08 §9.4 "runs in a separate job"): approved tasks
   * from the last 7 days by referred workers that have no commission row yet get credited now.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'referrals.task-sweep' })
  async referralSweep() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.db.$queryRaw<{ id: string; worker_user_id: string; reward_usd: Prisma.Decimal }[]>`
      SELECT s.id, s.worker_user_id, s.reward_usd FROM submissions s
      JOIN referrals r ON r.referred_user_id = s.worker_user_id
      LEFT JOIN referral_commissions c ON c.submission_id = s.id
      WHERE s.status = 'approved' AND s.decided_at >= ${since} AND c.id IS NULL
      LIMIT 200`;
    for (const r of rows) {
      await this.creditReferral({ submissionId: r.id, workerUserId: r.worker_user_id, rewardUsd: dec(r.reward_usd) }).catch((e) => this.log.error(`referral sweep ${r.id}: ${String(e)}`));
    }
    return rows.length;
  }

  /** Employer entry point (Doc 04 §6.9). */
  async approve(employerId: string, ref: string) {
    const sub = await this.db.submission.findFirst({ where: { publicRef: ref, employerUserId: employerId }, select: { id: true } });
    if (!sub) throw new ApiError('NOT_FOUND', "We can't find that submission.");
    const r = await this.db.$transaction((tx) => this.approveInTx(tx, sub.id, 'employer', { userId: employerId }), { timeout: 15_000 });
    if (r.alreadyApproved) throw new ApiError('ALREADY_DECIDED', undefined, undefined, { status: 'approved' });
    void this.afterApproval(r, 'employer');
    return r;
  }

  /** Bulk approve: one transaction per item, per-item results (Doc 04 §6.10). */
  async bulkApprove(employerId: string, refs: string[]) {
    const max = await this.settings.number('bulk_approve_max', 100);
    if (refs.length < 1 || refs.length > max) throw new ApiError('VALIDATION_FAILED', undefined, { refs: [`Select up to ${max} submissions.`] });
    const unique = [...new Set(refs)];
    const rows = await this.db.submission.findMany({ where: { publicRef: { in: unique }, employerUserId: employerId }, select: { id: true, publicRef: true } });
    const byRef = new Map(rows.map((r) => [r.publicRef, r.id]));
    const results: Record<string, unknown>[] = [];
    let total = new Decimal(0);
    for (const ref of unique) {
      const id = byRef.get(ref);
      if (!id) {
        results.push({ ref, result: 'skipped', code: 'NOT_FOUND', message: "We can't find that submission." });
        continue;
      }
      try {
        const r = await this.db.$transaction((tx) => this.approveInTx(tx, id, 'employer', { userId: employerId }), { timeout: 15_000 });
        if (r.alreadyApproved) results.push({ ref, result: 'skipped', code: 'ALREADY_DECIDED', message: 'This submission was already decided.' });
        else {
          total = total.plus(r.rewardUsd);
          results.push({ ref, result: 'approved', paid_usd: usd3(r.rewardUsd), ledger_ref: r.ledgerRef });
          void this.afterApproval(r, 'employer');
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ALREADY_DECIDED') results.push({ ref, result: 'skipped', code: 'ALREADY_DECIDED', message: 'This submission was already decided.' });
        else {
          this.log.error(`bulk approve ${ref}: ${String(e)}`);
          results.push({ ref, result: 'failed', code: e instanceof ApiError ? e.code : 'INTERNAL_ERROR', message: "This one couldn't be approved. Try again." });
        }
      }
    }
    return {
      approved_count: results.filter((r) => r.result === 'approved').length,
      skipped_count: results.filter((r) => r.result === 'skipped').length,
      failed_count: results.filter((r) => r.result === 'failed').length,
      total_paid_usd: total.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2),
      results,
    };
  }

  /** Reject, final or fix allowed (Doc 04 §6.11). */
  async reject(employerId: string, ref: string, dto: { reason_code: string; reason_text: string; allow_fix: boolean }) {
    const found = await this.db.submission.findFirst({ where: { publicRef: ref, employerUserId: employerId }, select: { id: true } });
    if (!found) throw new ApiError('NOT_FOUND', "We can't find that submission.");
    const maxResub = await this.settings.number('max_resubmissions', 1);
    const windowH = await this.settings.number('resubmit_window_hours', 24);
    const out = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${found.id}::uuid FOR UPDATE`;
      const sub = await tx.submission.findUniqueOrThrow({ where: { id: found.id } });
      if (sub.status !== 'in_review') throw new ApiError('ALREADY_DECIDED', undefined, undefined, { status: sub.status });
      const job = await this.core.lockJob(tx, sub.jobId);
      const now = new Date();
      const fixPossible = job.allowResubmission && sub.resubmissionCount < maxResub && (!job.endsAt || job.endsAt > now);
      if (dto.allow_fix && !fixPossible) throw new ApiError('FIX_NOT_ALLOWED');
      const fix = dto.allow_fix && fixPossible;
      const deadline = fix ? new Date(Math.min(now.getTime() + windowH * 3_600_000, job.endsAt?.getTime() ?? Infinity)) : null;
      await tx.submission.update({
        where: { id: sub.id },
        data: {
          status: fix ? 'needs_fix' : 'rejected',
          decidedAt: now,
          finalAt: fix ? null : now,
          decisionSource: 'employer',
          decidedByUserId: employerId,
          rejectionReasonCode: dto.reason_code as never,
          rejectionReasonText: dto.reason_text,
          fixAllowed: fix,
          resubmitDeadline: deadline,
        },
      });
      await tx.submissionAttempt.updateMany({
        where: { submissionId: sub.id, attemptNo: sub.currentAttemptNo },
        data: { decision: fix ? 'needs_fix' : 'rejected', decidedAt: now, rejectionReasonCode: dto.reason_code as never, rejectionReasonText: dto.reason_text },
      });
      await tx.job.update({
        where: { id: job.id },
        data: fix ? { countInReview: { decrement: 1 }, countNeedsFix: { increment: 1 } } : { countInReview: { decrement: 1 }, countRejected: { increment: 1 } },
      });
      await tx.submissionEvent.create({
        data: { reservationId: sub.reservationId, submissionId: sub.id, eventType: fix ? 'needs_fix' : 'rejected', actorType: 'user', actorUserId: employerId, data: { reason_code: dto.reason_code } },
      });
      if (!fix) {
        await tx.workerProfile.updateMany({ where: { userId: sub.workerUserId }, data: { rejected30d: { increment: 1 } } });
        // BR-009: a final rejection frees the slot. On a paused or finished job the budget goes back now.
        if (job.status !== 'running') {
          await this.core.moveReserve(tx, job, 'release', unitCost(job), `submission:${sub.publicRef}:release`, { title: job.title, reason: 'unused slot returned' });
        }
      }
      const profile = await tx.employerProfile.findUnique({ where: { userId: employerId }, select: { businessName: true } });
      return { sub, job, fix, deadline, now, employerName: profile?.businessName ?? 'The employer' };
    });
    const vars = { employer: out.employerName, job: out.job.title, ref: out.sub.publicRef };
    try {
      if (this.notifications) await this.notifications.notify(out.fix ? 'submission_needs_fix' : 'submission_rejected', out.sub.workerUserId, vars, { data: { submission_ref: out.sub.publicRef } });
      else
        await this.core.notify({
          userId: out.sub.workerUserId,
          audience: 'worker',
          category: 'tasks',
          type: out.fix ? 'submission_needs_fix' : 'submission_rejected',
          title: out.fix ? 'Submission needs a fix' : 'Submission rejected',
          body: out.fix ? `${vars.employer} asked you to resubmit “${vars.job}”. Reason included.` : `${vars.employer} rejected “${vars.job}”. Reason included.`,
          linkPath: `/worker/tasks/${vars.ref}`,
        });
    } catch {
      /* never breaks the decision */
    }
    return {
      ref: out.sub.publicRef,
      status: out.fix ? 'needs_fix' : 'rejected',
      decided_at: out.now.toISOString(),
      reason_code: dto.reason_code,
      reason_text: dto.reason_text,
      fix_allowed: out.fix,
      resubmit_deadline: out.deadline?.toISOString() ?? null,
      job_public_id: out.job.publicId,
      reward_usd: usd3(out.sub.rewardUsd),
    };
  }
}

export const shortJobTitle = shortTitle;
