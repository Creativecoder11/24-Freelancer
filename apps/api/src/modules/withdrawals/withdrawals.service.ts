import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@24f/db';
import { formatBdt, formatDateTime, formatMoney, formatUsdt, maskPhoneAuth, type ErrorCode, type PayoutMethodType, type WithdrawalStatus } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { getEnv } from '../../config/env';
import { SettingsService } from '../settings/settings.service';
import { LedgerService } from '../ledger/ledger.service';
import { PasswordService } from '../auth/password.service';
import { OtpService } from '../auth/otp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FxService } from '../fx/fx.service';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';
import { destinationLabel, maskTight, METHOD_SHORT } from '../payout-methods/payout-account';

type Tx = Prisma.TransactionClient;
type CfgRow = Prisma.PayoutMethodConfigGetPayload<object>;
type WdRow = Prisma.WithdrawalGetPayload<{ include: { payoutMethod: true } }>;

const D = (v: Prisma.Decimal | Decimal.Value | null | undefined) => new Decimal((v ?? 0).toString());
const m2 = (v: Prisma.Decimal | Decimal.Value | null | undefined) => D(v).toFixed(2, Decimal.ROUND_DOWN);
const ACTIVE: WithdrawalStatus[] = ['requested', 'processing', 'paid'];
const RETURNED: WithdrawalStatus[] = ['rejected', 'failed', 'cancelled'];

export type WithdrawalTab = 'all' | 'processing' | 'paid' | 'rejected';
const TAB_STATUSES: Record<WithdrawalTab, WithdrawalStatus[] | null> = {
  all: null,
  processing: ['requested', 'processing'],
  paid: ['paid'],
  rejected: ['rejected', 'failed', 'cancelled'],
};

export interface QuoteInput {
  payout_method_id?: string;
  method?: PayoutMethodType;
  account?: string;
  amount?: string;
}

/** Withdrawals (Doc 06 §5.12, Doc 08 §6). Admin processing methods are at the bottom. */
@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger('Withdrawals');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationsService,
    private readonly fx: FxService,
    private readonly methods: PayoutMethodsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Limits and amount checks (shared by quote and request)
  // ---------------------------------------------------------------------------

  private async usage(userId: string, tx: Tx | Prisma.DefaultPrismaClient = this.prisma.db) {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const local = new Date(Date.now() + 6 * 3_600_000);
    const monthStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 6 * 3_600_000);
    const [day, dayCount, month] = await Promise.all([
      tx.withdrawal.aggregate({ where: { userId, requestedAt: { gte: dayAgo }, status: { in: ACTIVE } }, _sum: { amountUsd: true } }),
      // Cancelled requests still count toward the daily count (BR-WDC-03).
      tx.withdrawal.count({ where: { userId, requestedAt: { gte: dayAgo } } }),
      tx.withdrawal.aggregate({ where: { userId, requestedAt: { gte: monthStart }, status: { in: ACTIVE } }, _sum: { amountUsd: true } }),
    ]);
    const [dailyMax, dailyCountMax, monthlyMax] = await Promise.all([
      this.settings.number('withdrawal_daily_max_usd', 500),
      this.settings.number('withdrawal_daily_count_max', 3),
      this.settings.number('withdrawal_monthly_max_usd', 3000),
    ]);
    const remainingDaily = Decimal.max(0, new Decimal(dailyMax).minus(D(day._sum.amountUsd)));
    const remainingMonthly = Decimal.max(0, new Decimal(monthlyMax).minus(D(month._sum.amountUsd)));
    return { dailyMax: new Decimal(dailyMax), monthlyMax: new Decimal(monthlyMax), dailyCount: dayCount, dailyCountMax, remainingDaily, remainingMonthly };
  }

  private fee(cfg: CfgRow, amount: Decimal) {
    return D(cfg.feeFixedUsd).plus(amount.times(D(cfg.feePercent)).div(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  private amountError(code: ErrorCode, message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError(code, message, { amount_usd: [message] }, details);
  }

  /** VR-054…VR-058, VR-062 and the balance check; returns fee and net. */
  private checkAmount(raw: string, cfg: CfgRow, available: Decimal, u: Awaited<ReturnType<WithdrawalsService['usage']>>, opts: { countCheck: boolean }) {
    if (!/^\d+(\.\d+)?$/.test(raw)) throw this.amountError('VALIDATION_FAILED', 'Enter an amount.');
    if (/\.\d{3,}$/.test(raw)) throw this.amountError('AMOUNT_PRECISION', 'Use at most 2 decimal places.');
    const amount = new Decimal(raw);
    const name = cfg.displayName;
    if (amount.lte(0)) throw this.amountError('VALIDATION_FAILED', 'Enter an amount.');
    if (amount.lt(D(cfg.minUsd))) throw this.amountError('AMOUNT_BELOW_MINIMUM', `The minimum for ${name} is ${formatMoney(m2(cfg.minUsd))}.`, { min_usd: m2(cfg.minUsd) });
    if (amount.gt(D(cfg.maxPerRequestUsd)))
      throw this.amountError('AMOUNT_ABOVE_MAXIMUM', `The maximum per withdrawal is ${formatMoney(m2(cfg.maxPerRequestUsd))}.`, { max_usd: m2(cfg.maxPerRequestUsd) });
    const fee = this.fee(cfg, amount);
    const net = amount.minus(fee);
    if (net.lte(0)) throw this.amountError('AMOUNT_BELOW_FEE', `The amount must be more than the ${formatMoney(fee.toFixed(2))} fee.`, { fee_usd: fee.toFixed(2) });
    if (amount.gt(available))
      throw new ApiError('INSUFFICIENT_BALANCE', `You have ${formatMoney(available.toFixed(2, Decimal.ROUND_DOWN))} available. Enter that amount or less.`, { amount_usd: [`You have ${formatMoney(available.toFixed(2, Decimal.ROUND_DOWN))} available. Enter that amount or less.`] }, {
        available_usd: m2(available),
        shortfall_usd: amount.minus(available).toFixed(2),
      });
    if (opts.countCheck && u.dailyCount >= u.dailyCountMax)
      throw this.amountError('DAILY_COUNT_EXCEEDED', `You’ve reached today’s ${u.dailyCountMax} withdrawal requests. Try again tomorrow.`, { limit: u.dailyCountMax });
    if (amount.gt(u.remainingDaily))
      throw this.amountError(
        'DAILY_LIMIT_EXCEEDED',
        u.remainingDaily.gt(0) ? `You can withdraw up to ${formatMoney(u.remainingDaily.toFixed(2))} more today.` : `This goes over the ${formatMoney(u.dailyMax.toFixed(2))} daily limit. Try a smaller amount or wait until tomorrow.`,
        { remaining_usd: u.remainingDaily.toFixed(2) },
      );
    if (amount.gt(u.remainingMonthly))
      throw this.amountError('MONTHLY_LIMIT_EXCEEDED', `You’ve reached this month’s limit of ${formatMoney(u.monthlyMax.toFixed(2))}.`, { remaining_usd: u.remainingMonthly.toFixed(2) });
    return { amount, fee, net };
  }

  private receiveLabel(currency: string, payout: Decimal.Value) {
    return currency === 'BDT' ? formatBdt(new Decimal(payout).toFixed(0)) : formatUsdt(new Decimal(payout).toFixed(2));
  }

  private async kycStatus(userId: string) {
    const u = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { kycStatus: true, status: true, createdAt: true, workerProfile: { select: { firstWithdrawalAt: true } } } });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    return u;
  }

  private async isFirstWithdrawal(userId: string, firstAt: Date | null | undefined) {
    if (firstAt) return false;
    return (await this.prisma.db.withdrawal.count({ where: { userId, status: { in: ACTIVE } } })) === 0;
  }

  // ---------------------------------------------------------------------------
  // GET /withdrawals/quote
  // ---------------------------------------------------------------------------

  async quote(userId: string, q: QuoteInput) {
    let methodType: PayoutMethodType;
    let methodLabel: string;
    let pmId: string | null = null;
    let usableFrom: Date | null = null;
    if (q.payout_method_id) {
      const pm = await this.prisma.db.payoutMethod.findFirst({ where: { id: q.payout_method_id, userId, deletedAt: null } });
      if (!pm) throw new ApiError('PAYOUT_METHOD_INVALID');
      methodType = pm.methodType as PayoutMethodType;
      methodLabel = destinationLabel(methodType, pm.accountMasked, pm.accountLast3);
      pmId = pm.id;
      usableFrom = pm.usableFrom;
    } else if (q.method) {
      methodType = q.method;
      const digits = (q.account ?? '').replace(/\D/g, '');
      methodLabel = q.account ? (methodType === 'usdt_trc20' ? `USDT TRC20 · ${q.account.slice(0, 3)}…${q.account.slice(-3)}` : `${METHOD_SHORT[methodType]} ••${digits.slice(-3)}`) : METHOD_SHORT[methodType];
    } else {
      throw new ApiError('PAYOUT_METHOD_INVALID', undefined, { payout_method_id: ['Choose where to send your money.'] });
    }
    const cfg = await this.methods.config(methodType);
    if (!cfg || !cfg.enabled) throw new ApiError('METHOD_UNAVAILABLE', undefined, undefined, { method: methodType });
    const currency = cfg.payoutCurrency.trim();
    const rate = await this.fx.require(currency);
    const available = await this.ledger.balance(userId, 'worker_earnings');
    const u = await this.usage(userId);
    const user = await this.kycStatus(userId);
    const capped = Decimal.min(available, u.remainingDaily, u.remainingMonthly, D(cfg.maxPerRequestUsd));
    const all = Decimal.max(0, capped).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const ttl = await this.settings.number('withdrawal_quote_ttl_seconds', 600);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const needsOtp = getEnv().AUTH_OTP_ENABLED && (await this.isFirstWithdrawal(userId, user.workerProfile?.firstWithdrawalAt));

    const base = {
      quote_id: null as string | null,
      method: methodType,
      method_label: methodLabel,
      payout_currency: currency,
      fx_rate: rate.rate.toFixed(2),
      fx_rate_label: FxService.label(currency, rate.rate),
      available_usd: m2(available),
      all_amount_usd: all.toFixed(2),
      min_usd: m2(cfg.minUsd),
      max_per_request_usd: m2(cfg.maxPerRequestUsd),
      remaining_daily_usd: Decimal.min(u.remainingDaily, u.remainingMonthly).toFixed(2),
      daily_requests_left: Math.max(0, u.dailyCountMax - u.dailyCount),
      eta_text: cfg.etaText,
      needs_otp: needsOtp,
      gates: { kyc_status: user.kycStatus, account_status: user.status, method_usable_from: usableFrom?.toISOString() ?? null },
      expires_at: expiresAt.toISOString(),
    };
    if (!q.amount) return { ...base, amount_usd: null, fee_usd: m2(cfg.feeFixedUsd), net_usd: null, receive_amount: null, receive_label: null, balance_after_usd: m2(available) };

    const { amount, fee, net } = this.checkAmount(q.amount, cfg, available, u, { countCheck: false });
    const payout = FxService.payout(currency, net, rate.rate);
    if (pmId) {
      const row = await this.prisma.db.withdrawalQuote.create({
        data: { userId, payoutMethodId: pmId, method: methodType, amountUsd: amount.toFixed(2), feeUsd: fee.toFixed(2), payoutCurrency: currency, exchangeRateId: rate.id, fxRate: rate.rate.toFixed(6), receiveAmount: payout.toFixed(6), expiresAt },
      });
      base.quote_id = row.id;
    }
    return {
      ...base,
      amount_usd: amount.toFixed(2),
      fee_usd: fee.toFixed(2),
      net_usd: net.toFixed(2),
      receive_amount: currency === 'BDT' ? payout.toFixed(0) : payout.toFixed(2),
      receive_label: this.receiveLabel(currency, payout),
      balance_after_usd: available.minus(amount).toFixed(2, Decimal.ROUND_DOWN),
    };
  }

  // ---------------------------------------------------------------------------
  // POST /withdrawals (Doc 08 §6.4.4 order)
  // ---------------------------------------------------------------------------

  async request(
    userId: string,
    dto: { payout_method_id: string; amount_usd: string; quote_id: string; password: string; otp_challenge_id?: string; otp_code?: string },
    ctx: { ip: string | null },
  ) {
    const user = await this.kycStatus(userId);
    if (user.status !== 'active') throw new ApiError('ACCOUNT_RESTRICTED', 'Withdrawals are paused on your account. Contact support.');
    if (await this.settings.get<boolean>('withdrawals_paused', false)) throw new ApiError('FEATURE_DISABLED', 'Withdrawals are paused for maintenance. Try again later.');

    await this.passwords.verifyForSensitiveAction(userId, dto.password, 'withdrawal', 'password');

    const kycRequired = await this.settings.get<boolean>('kyc_required_for_withdrawal', true);
    if (kycRequired && user.kycStatus !== 'verified') throw new ApiError('KYC_REQUIRED', 'Verify your identity before your first withdrawal.', undefined, { kyc_status: user.kycStatus });

    const first = await this.isFirstWithdrawal(userId, user.workerProfile?.firstWithdrawalAt);
    if (getEnv().AUTH_OTP_ENABLED && first) await this.checkOtp(userId, dto, ctx);

    const pm = await this.prisma.db.payoutMethod.findFirst({ where: { id: dto.payout_method_id, userId, deletedAt: null }, include: { methodTypeRef: true } });
    if (!pm || pm.status !== 'active') throw new ApiError('PAYOUT_METHOD_INVALID', undefined, { payout_method_id: ['Choose where to send your money.'] });
    const cfg = pm.methodTypeRef;
    if (!cfg.enabled) throw new ApiError('METHOD_UNAVAILABLE', undefined, undefined, { method: pm.methodType });
    if (pm.usableFrom.getTime() > Date.now())
      throw new ApiError('PAYOUT_METHOD_COOLDOWN', `You can use this number from ${formatDateTime(pm.usableFrom)}.`, { payout_method_id: [`You can use this number from ${formatDateTime(pm.usableFrom)}.`] }, { usable_from: pm.usableFrom.toISOString() });

    const methodType = pm.methodType as PayoutMethodType;
    const currency = cfg.payoutCurrency.trim();
    const available0 = await this.ledger.balance(userId, 'worker_earnings');
    const u0 = await this.usage(userId);
    const { amount, fee, net } = this.checkAmount(dto.amount_usd, cfg, available0, u0, { countCheck: true });

    // Risk hold (Doc 08 §12.5): first withdrawal, or a new account withdrawing ≥ $50.
    const holdH = await this.settings.number('first_withdrawal_hold_hours', 24);
    const riskFlags: string[] = [];
    if (first) riskFlags.push('first_withdrawal');
    if (Date.now() - user.createdAt.getTime() < 7 * 86_400_000 && amount.gte(50)) riskFlags.push('new_account_large');
    const holdUntil = riskFlags.length ? new Date(Date.now() + holdH * 3_600_000) : null;

    // Quote: rate locks from it (BR-WDQ-02).
    const quote = await this.prisma.db.withdrawalQuote.findFirst({ where: { id: dto.quote_id, userId } });
    if (!quote || quote.consumedAt || quote.payoutMethodId !== pm.id || !D(quote.amountUsd).eq(amount)) {
      throw new ApiError('QUOTE_EXPIRED', 'The rate changed. Check the new amount and confirm again.', undefined, { reason: 'quote_mismatch' });
    }
    let rateId = quote.exchangeRateId;
    let rate = D(quote.fxRate);
    if (quote.expiresAt.getTime() < Date.now()) {
      const current = await this.fx.require(currency);
      if (!current.rate.eq(rate)) {
        const fresh = await this.quote(userId, { payout_method_id: pm.id, amount: amount.toFixed(2) });
        throw new ApiError('QUOTE_EXPIRED', 'The rate changed. Check the new amount and confirm again.', undefined, { quote: fresh });
      }
      rateId = current.id;
      rate = current.rate;
    }
    const payout = FxService.payout(currency, net, rate);

    const result = await this.prisma.db.$transaction(async (tx) => {
      const acc = await this.ledger.userAccount(userId, 'worker_earnings', tx);
      await tx.$queryRaw`SELECT id FROM wallet_accounts WHERE id = ${acc.id}::uuid FOR UPDATE`;
      const locked = await tx.walletAccount.findUniqueOrThrow({ where: { id: acc.id } });
      const available = D(locked.balanceCached);
      // Re-check limits under the lock so two concurrent requests can't both pass.
      const u = await this.usage(userId, tx);
      this.checkAmount(amount.toFixed(2), cfg, available, u, { countCheck: true });
      const consumed = await tx.withdrawalQuote.updateMany({ where: { id: quote.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new ApiError('QUOTE_EXPIRED');

      const id = (await tx.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
      const clearing = await this.ledger.systemAccount('payout_clearing', tx);
      const short = methodType === 'usdt_trc20' ? pm.accountMasked : `••${pm.accountLast3}`;
      const ltx = await this.ledger.post(
        {
          type: 'withdrawal',
          idempotencyKey: `withdrawal:${id}:request`,
          actor: 'user',
          userId,
          description: { phase: 'request', method: methodType, masked: short },
          refs: { withdrawalId: id },
          lines: [
            { accountId: acc.id, amount: amount.negated().toFixed(6) },
            { accountId: clearing.id, amount: amount.toFixed(6) },
          ],
        },
        tx,
      );
      const wd = await tx.withdrawal.create({
        data: {
          id,
          userId,
          payoutMethodId: pm.id,
          quoteId: quote.id,
          method: methodType,
          destinationMasked: maskTight(pm.accountMasked),
          destinationEncrypted: pm.accountEncrypted,
          keyId: pm.keyId,
          amountUsd: amount.toFixed(2),
          feeUsd: fee.toFixed(2),
          payoutCurrency: currency,
          exchangeRateId: rateId,
          fxRate: rate.toFixed(6),
          payoutAmount: payout.toFixed(6),
          status: 'requested',
          holdUntil,
          riskFlags,
          requestLedgerTxId: ltx.id,
        },
      });
      await tx.withdrawalEvent.create({ data: { withdrawalId: id, fromStatus: null, toStatus: 'requested', actorType: 'user', actorUserId: userId, data: { ip: ctx.ip, quote_id: quote.id } } });
      await tx.payoutMethod.update({ where: { id: pm.id }, data: { lastUsedAt: new Date() } });
      if (first) await tx.workerProfile.updateMany({ where: { userId, firstWithdrawalAt: null }, data: { firstWithdrawalAt: new Date() } });
      const after = await tx.walletAccount.findUniqueOrThrow({ where: { id: acc.id }, select: { balanceCached: true } });
      return { wd, ltxRef: ltx.publicRef, balanceAfter: D(after.balanceCached) };
    });

    const dest = destinationLabel(methodType, pm.accountMasked, pm.accountLast3);
    void this.notifications.notify('withdrawal_requested', userId, { method: dest, wd_ref: result.wd.publicRef, amount: formatMoney(amount.toFixed(2)) });
    return {
      ref: result.wd.publicRef,
      status: 'requested' as const,
      method: methodType,
      destination_masked: dest,
      amount_usd: amount.toFixed(2),
      fee_usd: fee.toFixed(2),
      net_usd: net.toFixed(2),
      payout_currency: currency,
      fx_rate: rate.toFixed(2),
      fx_rate_label: FxService.label(currency, rate),
      payout_amount: currency === 'BDT' ? payout.toFixed(0) : payout.toFixed(2),
      receive_label: this.receiveLabel(currency, payout),
      balance_after_usd: result.balanceAfter.toFixed(2, Decimal.ROUND_DOWN),
      requested_at: result.wd.requestedAt.toISOString(),
      hold_until: holdUntil?.toISOString() ?? null,
      warning_code: holdUntil ? ('WITHDRAWAL_UNDER_REVIEW' as const) : null,
      eta_text: cfg.etaText,
      ledger_ref: result.ltxRef,
      cancellable: true,
    };
  }

  /** First-withdrawal OTP (Doc 08 §6.5). Only when AUTH_OTP_ENABLED. */
  private async checkOtp(userId: string, dto: { otp_challenge_id?: string; otp_code?: string }, ctx: { ip: string | null }) {
    if (dto.otp_challenge_id && dto.otp_code) {
      const c = await this.otp.verify(dto.otp_challenge_id, dto.otp_code);
      if (c.userId !== userId || c.purpose !== 'first_withdrawal') throw new ApiError('OTP_INVALID');
      return;
    }
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId }, select: { phoneE164: true, email: true } });
    const destination = u.phoneE164 ?? u.email!;
    const c = await this.otp.issue({ userId, purpose: 'first_withdrawal', destination, ip: ctx.ip });
    throw new ApiError('OTP_REQUIRED', 'Enter the code we sent you to continue.', {}, {
      challenge_id: c.id,
      purpose: 'first_withdrawal',
      destination_masked: u.phoneE164 ? maskPhoneAuth(u.phoneE164) : destination.replace(/^(.{2}).*(@.*)$/, '$1•••$2'),
      expires_at: c.expiresAt.toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // History, detail, cancel
  // ---------------------------------------------------------------------------

  private receivedLabel(w: { status: string; payoutCurrency: string; payoutAmount: Prisma.Decimal }) {
    if (RETURNED.includes(w.status as WithdrawalStatus)) return 'Refunded';
    return this.receiveLabel(w.payoutCurrency.trim(), D(w.payoutAmount));
  }

  private row(w: WdRow) {
    const method = w.method as PayoutMethodType;
    return {
      ref: w.publicRef,
      requested_at: w.requestedAt.toISOString(),
      method,
      method_label: METHOD_SHORT[method],
      destination_masked: maskTight(w.destinationMasked),
      amount_usd: m2(w.amountUsd),
      received_label: this.receivedLabel(w),
      status: w.status as WithdrawalStatus,
    };
  }

  async list(userId: string, q: { tab: WithdrawalTab; page: number; per_page: number }) {
    const statuses = TAB_STATUSES[q.tab];
    const where: Prisma.WithdrawalWhereInput = { userId, ...(statuses ? { status: { in: statuses } } : {}) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.db.withdrawal.findMany({ where, include: { payoutMethod: true }, orderBy: { requestedAt: 'desc' }, skip: (q.page - 1) * q.per_page, take: q.per_page }),
      this.prisma.db.withdrawal.count({ where }),
      this.prisma.db.withdrawal.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    ]);
    const n = (s: WithdrawalStatus[]) => grouped.filter((g) => s.includes(g.status as WithdrawalStatus)).reduce((a, g) => a + g._count._all, 0);
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    return {
      data: rows.map((r) => this.row(r)),
      meta: {
        total,
        page: q.page,
        per_page: q.per_page,
        total_pages: totalPages,
        has_more: q.page < totalPages,
        counts: { all: n(['requested', 'processing', 'paid', 'rejected', 'failed', 'cancelled']), processing: n(['requested', 'processing']), paid: n(['paid']), rejected: n(['rejected', 'failed', 'cancelled']) },
      },
    };
  }

  private async findOwned(userId: string, ref: string) {
    const w = await this.prisma.db.withdrawal.findFirst({ where: { publicRef: ref.toUpperCase(), userId }, include: { payoutMethod: true } });
    if (!w) throw new ApiError('NOT_FOUND', 'We couldn’t find that withdrawal.');
    return w;
  }

  async detail(userId: string, ref: string) {
    const w = await this.findOwned(userId, ref);
    const cfg = await this.methods.config(w.method as PayoutMethodType);
    const currency = w.payoutCurrency.trim();
    const status = w.status as WithdrawalStatus;
    const timeline: { status: string; label: string; at: string | null; note: string | null; state: 'done' | 'current' | 'todo' | 'failed' }[] = [
      { status: 'requested', label: 'Requested', at: w.requestedAt.toISOString(), note: null, state: 'done' },
    ];
    if (status === 'cancelled') {
      timeline.push({ status: 'cancelled', label: 'Cancelled', at: w.cancelledAt?.toISOString() ?? null, note: 'Cancelled by you', state: 'failed' });
    } else {
      if (w.processingAt || status === 'processing' || status === 'paid' || status === 'failed') {
        timeline.push({ status: 'processing', label: 'Processing', at: w.processingAt?.toISOString() ?? null, note: 'Started', state: status === 'processing' ? 'current' : 'done' });
      } else if (status === 'requested') {
        timeline.push({ status: 'processing', label: 'Processing', at: null, note: w.holdUntil && w.holdUntil > new Date() ? `On review hold until ${formatDateTime(w.holdUntil)}` : 'Waiting to be picked up', state: 'todo' });
      }
      if (status === 'rejected') timeline.push({ status: 'rejected', label: 'Rejected', at: w.rejectedAt?.toISOString() ?? null, note: w.rejectReasonText, state: 'failed' });
      else if (status === 'failed') timeline.push({ status: 'failed', label: 'Failed', at: w.failedAt?.toISOString() ?? null, note: w.rejectReasonText, state: 'failed' });
      else if (status === 'paid') timeline.push({ status: 'paid', label: 'Paid', at: w.paidAt?.toISOString() ?? null, note: null, state: 'done' });
      else {
        const late = status === 'processing' && w.processingAt && Date.now() - w.processingAt.getTime() > 48 * 3_600_000;
        timeline.push({ status: 'paid', label: 'Paid', at: null, note: late ? 'Taking longer than usual' : (cfg?.etaText ?? 'Usually within 24 h').replace('Usually arrives within 24 hours', 'Usually within 24 h'), state: 'todo' });
      }
    }
    const returnedAt = w.cancelledAt ?? w.rejectedAt ?? w.failedAt;
    return {
      ref: w.publicRef,
      status,
      amount_usd: m2(w.amountUsd),
      fee_usd: m2(w.feeUsd),
      net_usd: D(w.amountUsd).minus(D(w.feeUsd)).toFixed(2),
      method: w.method as PayoutMethodType,
      method_label: METHOD_SHORT[w.method as PayoutMethodType],
      destination_masked: maskTight(w.destinationMasked),
      payout_currency: currency,
      fx_rate: D(w.fxRate).toFixed(2),
      fx_rate_label: FxService.label(currency, D(w.fxRate)),
      payout_amount: currency === 'BDT' ? D(w.payoutAmount).toFixed(0) : D(w.payoutAmount).toFixed(2),
      receive_label: `${status === 'paid' ? '' : '≈ '}${this.receiveLabel(currency, D(w.payoutAmount))}`,
      timeline,
      provider_trx_id: w.providerTrxId,
      reason_text: w.rejectReasonText,
      refunded_at: RETURNED.includes(status) ? (returnedAt?.toISOString() ?? null) : null,
      hold_until: w.holdUntil?.toISOString() ?? null,
      requested_at: w.requestedAt.toISOString(),
      cancellable: status === 'requested',
    };
  }

  /** POST /withdrawals/{ref}/cancel (BR-WDC-01…03). */
  async cancel(userId: string, ref: string) {
    const w0 = await this.findOwned(userId, ref);
    const res = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM withdrawals WHERE id = ${w0.id}::uuid FOR UPDATE`;
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id: w0.id } });
      if (w.status !== 'requested') throw new ApiError('WITHDRAWAL_NOT_CANCELLABLE', w.status === 'processing' ? 'It’s already processing, so it can’t be cancelled.' : 'This request can no longer be cancelled.', undefined, { status: w.status });
      const ltx = await this.reverse(tx, w, 'cancelled', { actor: 'user', userId });
      const now = new Date();
      await tx.withdrawal.update({ where: { id: w.id }, data: { status: 'cancelled', cancelledAt: now, reversalLedgerTxId: ltx.id, updatedAt: now } });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'requested', toStatus: 'cancelled', actorType: 'user', actorUserId: userId, note: 'Cancelled by you' } });
      return { ltx, now };
    });
    const available = await this.ledger.balance(userId, 'worker_earnings');
    void this.notifications.notify('withdrawal_cancelled', userId, { amount: formatMoney(m2(w0.amountUsd)), wd_ref: w0.publicRef });
    return { ref: w0.publicRef, status: 'cancelled' as const, cancelled_at: res.now.toISOString(), amount_usd: m2(w0.amountUsd), available_usd: m2(available), ledger_ref: res.ltx.publicRef };
  }

  /** `withdrawal_reversal`: payout_clearing −amount, worker_earnings +amount. */
  private async reverse(tx: Tx, w: { id: string; userId: string; amountUsd: Prisma.Decimal; method: string; destinationMasked: string; publicRef: string }, cause: 'cancelled' | 'rejected' | 'failed', actor: { actor: 'user' | 'admin' | 'system'; userId?: string; adminId?: string }) {
    const acc = await this.ledger.userAccount(w.userId, 'worker_earnings', tx);
    const clearing = await this.ledger.systemAccount('payout_clearing', tx);
    const amount = D(w.amountUsd);
    const l3 = w.destinationMasked.slice(-3);
    return this.ledger.post(
      {
        type: 'withdrawal_reversal',
        idempotencyKey: `withdrawal:${w.id}:reverse`,
        actor: actor.actor,
        userId: actor.userId,
        adminId: actor.adminId,
        description: { cause, method: w.method, masked: w.method === 'usdt_trc20' ? w.destinationMasked : `••${l3}`, wd_ref: w.publicRef },
        refs: { withdrawalId: w.id },
        lines: [
          { accountId: clearing.id, amount: amount.negated().toFixed(6) },
          { accountId: acc.id, amount: amount.toFixed(6) },
        ],
      },
      tx,
    );
  }

  // ---------------------------------------------------------------------------
  // Admin processing (Doc 08 §6.7.1). Called by the admin module; it owns auth, roles,
  // dual control and audit logging. Each method is idempotent per state transition.
  // ---------------------------------------------------------------------------

  private async lockForAdmin(tx: Tx, ref: string) {
    const w0 = await tx.withdrawal.findUnique({ where: { publicRef: ref.toUpperCase() } });
    if (!w0) throw new ApiError('NOT_FOUND', 'We couldn’t find that withdrawal.');
    await tx.$queryRaw`SELECT id FROM withdrawals WHERE id = ${w0.id}::uuid FOR UPDATE`;
    return tx.withdrawal.findUniqueOrThrow({ where: { id: w0.id } });
  }

  /** `requested → processing` ("Start processing" / batch export). */
  async adminStartProcessing(ref: string, adminId: string, opts: { batchId?: string; ignoreHold?: boolean } = {}) {
    const w = await this.prisma.db.$transaction(async (tx) => {
      const w = await this.lockForAdmin(tx, ref);
      if (w.status === 'processing') return w;
      if (w.status !== 'requested') throw new ApiError('INVALID_STATE', 'Only requested withdrawals can start processing.', undefined, { status: w.status });
      if (!opts.ignoreHold && w.holdUntil && w.holdUntil > new Date()) throw new ApiError('WITHDRAWAL_ON_HOLD', `This withdrawal is on hold until ${formatDateTime(w.holdUntil)}.`, undefined, { hold_until: w.holdUntil.toISOString() });
      const now = new Date();
      const upd = await tx.withdrawal.update({ where: { id: w.id }, data: { status: 'processing', processingAt: now, processedByAdminId: adminId, batchId: opts.batchId ?? w.batchId, updatedAt: now } });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'requested', toStatus: 'processing', actorType: 'admin', actorAdminId: adminId } });
      return upd;
    });
    void this.notifications.notify('withdrawal_processing', w.userId, { amount: formatMoney(m2(w.amountUsd)), method: `${METHOD_SHORT[w.method as PayoutMethodType]} ••${w.destinationMasked.slice(-3)}`, wd_ref: w.publicRef });
    return w;
  }

  /** Release a first-withdrawal or risk hold early. */
  async adminReleaseHold(ref: string, adminId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const w = await this.lockForAdmin(tx, ref);
      const upd = await tx.withdrawal.update({ where: { id: w.id }, data: { holdUntil: null, updatedAt: new Date() } });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: w.status, toStatus: w.status, actorType: 'admin', actorAdminId: adminId, note: 'Hold released' } });
      return upd;
    });
  }

  /** `processing → paid` with the provider TrxID. Settlement: payout_clearing → treasury (+ fee to revenue). */
  async adminMarkPaid(ref: string, adminId: string, input: { providerTrxId: string; paidAt?: Date }) {
    const w = await this.prisma.db.$transaction(async (tx) => {
      const w = await this.lockForAdmin(tx, ref);
      if (w.status === 'paid') return w;
      if (w.status !== 'processing') throw new ApiError('INVALID_STATE', 'Only processing withdrawals can be marked paid.', undefined, { status: w.status });
      const dup = await tx.withdrawal.findFirst({ where: { providerTrxId: input.providerTrxId, id: { not: w.id } }, select: { publicRef: true } });
      if (dup) throw new ApiError('DUPLICATE_PROVIDER_TXN', undefined, undefined, { withdrawal_ref: dup.publicRef });
      const cfg = await tx.payoutMethodConfig.findUniqueOrThrow({ where: { methodType: w.method } });
      const amount = D(w.amountUsd);
      const fee = D(w.feeUsd);
      const clearing = await this.ledger.systemAccount('payout_clearing', tx);
      const treasury = await this.ledger.systemAccount(cfg.treasurySystemCode, tx);
      const lines = [
        { accountId: clearing.id, amount: amount.negated().toFixed(6) },
        { accountId: treasury.id, amount: amount.minus(fee).toFixed(6) },
      ];
      if (fee.gt(0)) lines.push({ accountId: (await this.ledger.systemAccount('platform_revenue', tx)).id, amount: fee.toFixed(6) });
      const ltx = await this.ledger.post(
        { type: 'withdrawal', idempotencyKey: `withdrawal:${w.id}:paid`, actor: 'admin', adminId, description: { phase: 'paid', method: w.method, wd_ref: w.publicRef }, refs: { withdrawalId: w.id }, lines },
        tx,
      );
      const now = input.paidAt ?? new Date();
      const upd = await tx.withdrawal.update({ where: { id: w.id }, data: { status: 'paid', paidAt: now, providerTrxId: input.providerTrxId, settleLedgerTxId: ltx.id, updatedAt: new Date() } });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'processing', toStatus: 'paid', actorType: 'admin', actorAdminId: adminId, data: { provider_trx_id: input.providerTrxId } } });
      return upd;
    });
    void this.notifications.notify('withdrawal_paid', w.userId, { amount: formatMoney(m2(w.amountUsd)), last3: w.destinationMasked.slice(-3), wd_ref: w.publicRef });
    return w;
  }

  /** `requested|processing → rejected` with a reason shown to the worker; refunds the balance. */
  async adminReject(ref: string, adminId: string, input: { reasonCode: string; reasonText: string }) {
    return this.adminReturn(ref, adminId, 'rejected', input);
  }

  /** `processing → failed` (provider failure after sending); refunds the balance. */
  async adminMarkFailed(ref: string, adminId: string, input: { reasonText: string }) {
    return this.adminReturn(ref, adminId, 'failed', { reasonCode: 'provider_failure', reasonText: input.reasonText });
  }

  private async adminReturn(ref: string, adminId: string, to: 'rejected' | 'failed', input: { reasonCode: string; reasonText: string }) {
    const w = await this.prisma.db.$transaction(async (tx) => {
      const w = await this.lockForAdmin(tx, ref);
      if (w.status === to) return w;
      const allowed: WithdrawalStatus[] = to === 'rejected' ? ['requested', 'processing'] : ['processing'];
      if (!allowed.includes(w.status as WithdrawalStatus)) throw new ApiError('INVALID_STATE', undefined, undefined, { status: w.status });
      const ltx = await this.reverse(tx, w, to, { actor: 'admin', adminId });
      const now = new Date();
      const upd = await tx.withdrawal.update({
        where: { id: w.id },
        data: { status: to, ...(to === 'rejected' ? { rejectedAt: now } : { failedAt: now }), rejectReasonCode: input.reasonCode, rejectReasonText: input.reasonText.slice(0, 300), reversalLedgerTxId: ltx.id, updatedAt: now },
      });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: w.status, toStatus: to, actorType: 'admin', actorAdminId: adminId, note: input.reasonText.slice(0, 300) } });
      return upd;
    });
    void this.notifications.notify(to === 'rejected' ? 'withdrawal_rejected' : 'withdrawal_failed', w.userId, { reason: input.reasonText, amount: formatMoney(m2(w.amountUsd)), wd_ref: w.publicRef });
    return w;
  }
}
