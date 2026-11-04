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
 * Referral commission (Doc 08 §9; Canonical D-10, C-28). One commission per source event,
 * `rate × base` rounded half-up to 6 dp, from the platform's `referral_expense` account to the
 * referrer's `worker_earnings`. Idempotent on `referral:task:{submission_id}` /
 * `referral:deposit:{deposit_id}` and on the unique source index of `referral_commissions`.
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
    const referral = await this.db.referral.findUnique({ where: { referredUserId: src.friendUserId } });
    if (!referral) return { result: 'skipped', reason: 'no_referral' };

    const key = src.source === 'task' ? `referral:task:${src.submissionId}` : `referral:deposit:${src.depositId}`;
    const existing = await this.db.referralCommission.findFirst({
      where: src.source === 'task' ? { submissionId: src.submissionId } : { depositId: src.depositId },
      select: { id: true },
    });
    if (existing) return { result: 'skipped', reason: 'duplicate' };

    const rateKey = src.source === 'task' ? 'referral_task_rate' : 'referral_deposit_rate';
    const rate = new Decimal(String(await this.settings.get(rateKey, '0.05')));
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
      submissionId: src.source === 'task' ? src.submissionId : null,
      depositId: src.source === 'deposit' ? src.depositId : null,
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

      if (src.source === 'deposit') {
        // Deposit commissions notify now; task commissions roll into the weekly digest (Doc 08 §9.3).
        await this.core.notify({
          userId: referral.referrerUserId,
          audience: 'worker',
          category: 'referrals',
          type: 'referral_commission',
          title: `Referral commission · +$${amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`,
          body: `5% of a deposit by ${out.masked}.`,
          linkPath: '/worker/referral',
          dedupeKey: `referral-deposit:${src.depositId}`,
        });
      }
      return { result: 'credited', amount: amount.toFixed(6), ledgerTxId: out.t.id, commissionId: out.c.id };
    } catch (e) {
      // A concurrent run inserted the same source first: the unique index makes this a no-op.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { result: 'skipped', reason: 'duplicate' };
      this.log.error(`referral ${key} failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
}
