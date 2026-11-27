import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { SettingsService } from '../settings/settings.service';
import { EmployerCore, type Tx } from './employer-common';

export interface CommissionSource {
  source: 'task' | 'deposit';
  /** The referred friend (worker on a task, employer on a deposit). */
  friendUserId: string;
  /** Reward (task) or credited deposit amount, excluding fees (Doc 08 §9.1 Base). */
  baseUsd: Decimal.Value;
  submissionId?: string;
  depositId?: string;
}

export type CommissionResult =
  | { result: 'credited'; amount: string; ledgerTxId: string; commissionId: string }
  | { result: 'ineligible' | 'pending'; commissionId: string; reason: string }
  | { result: 'skipped'; reason: string };

/**
 * Referral commission (Doc 08 §9; Canonical D-10, C-28), first-task-only rule: the referrer earns
 * `referral_task_rate` × the reward of the friend's FIRST approved task, once per referral.
 * Later tasks and deposits earn nothing. Paid from the platform's `referral_expense` account to the
 * referrer's `worker_earnings`, rounded half-up to 6 dp. Idempotent on `referral:task:{submission_id}`
 * and on the unique source index of `referral_commissions`.
 * Always runs after the source commit; a failure never undoes the approval or the deposit.
 */
@Injectable()
export class ReferralCreditService {
  private readonly log = new Logger('ReferralCredit');

  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.core.db;
  }

  /**
   * D-10 / C-28 eligibility: the friend has any one of KYC verified, a first approved task, a
   * completed deposit, or an approved submission on their own job.
   */
  async referralEligible(friendUserId: string, tx: Tx = this.db): Promise<boolean> {
    const [kyc, task, deposit, ownJob] = await Promise.all([
      tx.user.findFirst({ where: { id: friendUserId, kycStatus: 'verified' }, select: { id: true } }),
      tx.submission.findFirst({ where: { workerUserId: friendUserId, status: 'approved' }, select: { id: true } }),
      tx.deposit.findFirst({ where: { employerUserId: friendUserId, status: 'completed' }, select: { id: true } }),
      tx.submission.findFirst({ where: { employerUserId: friendUserId, status: 'approved' }, select: { id: true } }),
    ]);
    return Boolean(kyc || task || deposit || ownJob);
  }

  async credit(src: CommissionSource): Promise<CommissionResult> {
    if (!(await this.settings.get<boolean>('referral_enabled', true))) return { result: 'skipped', reason: 'disabled' };
    // First-task-only rule: deposits never earn referral commission.
    if (src.source === 'deposit') return { result: 'skipped', reason: 'deposit_not_eligible' };
    const referral = await this.db.referral.findUnique({ where: { referredUserId: src.friendUserId } });
    if (!referral) return { result: 'skipped', reason: 'no_referral' };

    // Only the friend's first approved task counts, and only once per referral.
    const [first, otherTask] = await Promise.all([
      this.db.submission.findFirst({
        where: { workerUserId: src.friendUserId, status: 'approved' },
        orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
      this.db.referralCommission.findFirst({
        where: { referralId: referral.id, sourceType: 'task', NOT: { submissionId: src.submissionId } },
        select: { id: true },
      }),
    ]);
    if (!first || first.id !== src.submissionId || otherTask) return { result: 'skipped', reason: 'not_first_task' };

    const key = `referral:task:${src.submissionId}`;
    const existing = await this.db.referralCommission.findFirst({ where: { submissionId: src.submissionId }, select: { id: true } });
    if (existing) return { result: 'skipped', reason: 'duplicate' };

    const rate = new Decimal(String(await this.settings.get('referral_task_rate', '0.05')));
    const base = new Decimal(String(src.baseUsd));
    const amount = base.mul(rate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    if (amount.lte(0) || rate.lte(0) || rate.gte(1)) return { result: 'skipped', reason: 'zero' };

    // Hard blocks and risk holds (Doc 08 §9.5): the commission is recorded but never touches the ledger.
    const blockScore = await this.settings.number('referral_risk_block_score', 60);
    let blocked: string | null = null;
    if (referral.referrerUserId === src.friendUserId) blocked = 'self_referral';
    else if (referral.status === 'ineligible') blocked = referral.ineligibleReason ?? 'ineligible';
    else if ((referral.riskScore ?? 0) >= blockScore) blocked = 'risk_hold';

    const eligible = blocked ? false : await this.referralEligible(src.friendUserId);
    const baseRow = {
      referralId: referral.id,
      referrerUserId: referral.referrerUserId,
      referredUserId: src.friendUserId,
      sourceType: src.source,
      submissionId: src.submissionId,
      depositId: null,
      baseAmount: new Prisma.Decimal(base.toFixed(6)),
      rate: new Prisma.Decimal(rate.toFixed(6)),
      amount: new Prisma.Decimal(amount.toFixed(6)),
    } as const;

    try {
      if (blocked || !eligible) {
        const status = blocked ? 'ineligible' : 'pending';
        const reason = blocked ?? 'awaiting_eligibility';
        const c = await this.db.referralCommission.create({ data: { ...baseRow, status, statusReason: reason } });
        return { result: status, commissionId: c.id, reason };
      }

      const friend = await this.db.user.findUnique({ where: { id: src.friendUserId }, select: { fullName: true } });
      const masked = maskName(friend?.fullName ?? '');
      const out = await this.db.$transaction(async (tx) => {
        // `rc_credited_ck`: a credited row must carry its ledger transaction, so insert as pending first.
        const c = await tx.referralCommission.create({ data: { ...baseRow, status: 'pending' } });
        const expense = await this.core.ledger.systemAccount('referral_expense', tx);
        const earnings = await this.core.ledger.userAccount(referral.referrerUserId, 'worker_earnings', tx);
        const t = await this.core.ledger.post(
          {
            type: 'referral_commission',
            idempotencyKey: key,
            description: { friend: masked, source: src.source },
            refs: { submissionId: src.submissionId, depositId: src.depositId, referralCommissionId: c.id },
            lines: [
              { accountId: expense.id, amount: amount.neg().toFixed(6) },
              { accountId: earnings.id, amount: amount.toFixed(6) },
            ],
          },
          tx,
        );
        const now = new Date();
        await tx.referralCommission.update({ where: { id: c.id }, data: { status: 'credited', ledgerTxId: t.id, creditedAt: now } });
        await tx.referral.update({
          where: { id: referral.id },
          data: {
            status: 'active',
            eligibleAt: referral.eligibleAt ?? now,
            activatedAt: referral.activatedAt ?? now,
            lastActivityAt: now,
          },
        });
        return { c, t, masked };
      });

      // A one-time bonus, so the referrer hears about it straight away.
      await this.core.notify({
        userId: referral.referrerUserId,
        audience: 'worker',
        category: 'referrals',
        type: 'referral_commission',
        title: `Referral bonus · +$${amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`,
        body: `${rate.mul(100).toDecimalPlaces(2).toString()}% of ${out.masked}’s first task.`,
        linkPath: '/worker/referral',
        dedupeKey: `referral-task:${src.submissionId}`,
      });
      return { result: 'credited', amount: amount.toFixed(6), ledgerTxId: out.t.id, commissionId: out.c.id };
    } catch (e) {
      // A concurrent run inserted the same source first: the unique index makes this a no-op.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { result: 'skipped', reason: 'duplicate' };
      this.log.error(`referral ${key} failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
}
