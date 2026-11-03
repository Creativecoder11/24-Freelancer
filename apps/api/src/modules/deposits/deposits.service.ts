import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { ApiError } from '../../common/api-error';
import { Paged } from '../../common/envelope.interceptor';
import { RedisService } from '../../common/redis.service';
import { SettingsService } from '../settings/settings.service';
import { EmployerCore, dec, usd2 } from '../employer/employer-common';
import { EmployerWalletService, METHOD_LABEL } from '../employer-wallet/employer-wallet.service';
import { JobsService } from '../jobs/jobs.service';
import { MockPaymentProvider, canonicalJson, mockSign, type PaymentProviderAdapter } from './payment-provider';

const PROVIDER_SLOTS = ['bkash', 'nagad', 'aggregator', 'crypto', 'mock'] as const;

export function paymentsMockEnabled() {
  const env = process.env.APP_ENV ?? 'local';
  return (process.env.PAYMENTS_MODE ?? 'mock') === 'mock' && ['local', 'dev', 'test'].includes(env);
}

/** Deposits (Doc 06 §5.13, Doc 08 §5) and the payment webhook pipeline (Doc 06 §7, WH-1…WH-11). */
@Injectable()
export class DepositsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Deposits');
  private readonly adapters = new Map<string, PaymentProviderAdapter>();
  private timer: NodeJS.Timeout | null = null;
  readonly mock: MockPaymentProvider;

  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
    private readonly wallet: EmployerWalletService,
    private readonly jobs: JobsService,
    private readonly redis: RedisService,
  ) {
    this.mock = new MockPaymentProvider(redis);
    if (paymentsMockEnabled()) this.adapters.set('mock', this.mock);
  }

  private get db() {
    return this.core.db;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.expireSweep().catch((e) => this.log.error(String(e))), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Adapter for a deposit method. Real gateways plug in here once procured (D-06). */
  private adapterFor(_method: string): PaymentProviderAdapter {
    const a = this.adapters.get('mock');
    if (!a) throw new ApiError('METHOD_UNAVAILABLE', 'Payments aren’t connected yet. Try again later.');
    return a;
  }

  // ----------------------------------------------------------------- create

  async create(userId: string, b: { method: string; sub_provider?: string; amount_usd: string; return_to?: string }, webOrigin: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) throw new ApiError('VERIFICATION_REQUIRED');
    if (user.status !== 'active') throw new ApiError('ACCOUNT_RESTRICTED', 'Deposits are paused on your account. Contact support.');
    if (await this.settings.get<boolean>('deposits_paused', false)) throw new ApiError('FEATURE_DISABLED', 'Deposits are paused right now. Try again later.');
    const ctx = await this.wallet.addFundsContext(userId);
    if (!ctx.methods.some((m) => m.method === b.method)) throw new ApiError('METHOD_UNAVAILABLE', undefined, undefined, { method: b.method });
    if (!/^\d+(\.\d{1,2})?$/.test(b.amount_usd)) {
      if (/^\d+\.\d{3,}$/.test(b.amount_usd)) throw new ApiError('AMOUNT_PRECISION', undefined, { amount_usd: ['Use at most 2 decimal places.'] });
      throw new ApiError('VALIDATION_FAILED', undefined, { amount_usd: ['Enter an amount.'] });
    }
    const amount = new Decimal(b.amount_usd);
    if (amount.lt(ctx.min_usd)) throw new ApiError('AMOUNT_BELOW_MINIMUM', `The minimum deposit is $${ctx.min_usd}.`, { amount_usd: [`The minimum deposit is $${ctx.min_usd}.`] }, { min_usd: ctx.min_usd });
    if (amount.gt(ctx.max_usd))
      throw new ApiError('AMOUNT_ABOVE_MAXIMUM', `The maximum per deposit is $${new Decimal(ctx.max_usd).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.`, undefined, { max_usd: ctx.max_usd });
    if (amount.gt(ctx.remaining_daily_usd))
      throw new ApiError('DAILY_LIMIT_EXCEEDED', "You've reached today's deposit limit of $3,000.00. Try again tomorrow or contact support.", undefined, { remaining_usd: ctx.remaining_daily_usd });
    if (b.method === 'card') {
      const firstCard = await this.db.deposit.findFirst({ where: { employerUserId: userId, method: 'card', status: 'completed' }, orderBy: { completedAt: 'asc' } });
      const newCustomer = !firstCard || Date.now() - (firstCard.completedAt ?? firstCard.initiatedAt).getTime() < 30 * 86_400_000;
      if (newCustomer && amount.gt(ctx.card_max_usd))
        throw new ApiError('AMOUNT_ABOVE_MAXIMUM', `Card deposits are limited to $${ctx.card_max_usd} for your first 30 days.`, undefined, { max_usd: ctx.card_max_usd });
    }
    const rate = b.method === 'crypto' ? null : await this.wallet.depositRate();
    if (b.method !== 'crypto' && !rate) throw new ApiError('FX_RATE_STALE');
    const charge = rate ? amount.mul(rate).toDecimalPlaces(2, Decimal.ROUND_UP) : null;
    const minutes = await this.settings.number(`deposit_expiry_minutes_${b.method}`, b.method === 'crypto' ? 60 : 30);
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const adapter = this.adapterFor(b.method);
    const returnTo = b.return_to && /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(b.return_to) && !b.return_to.startsWith('//') ? b.return_to : null;

    const dep = await this.db.deposit.create({
      data: {
        employerUserId: userId,
        method: b.method as 'crypto' | 'mobile_wallet' | 'card',
        provider: adapter.slot,
        providerAsset: b.sub_provider ?? null,
        amountUsd: new Prisma.Decimal(amount.toFixed(6)),
        fxRate: rate ? new Prisma.Decimal(rate.toFixed(6)) : null,
        chargeAmountBdt: charge ? new Prisma.Decimal(charge.toFixed(2)) : null,
        expiresAt,
      },
    });
    try {
      const session = await adapter.createPayment({ ref: dep.publicRef, amountUsd: amount.toFixed(2), chargeAmountBdt: charge?.toFixed(2) ?? null, method: dep.method, webOrigin, expiresAt });
      await this.db.deposit.update({ where: { id: dep.id }, data: { providerPaymentId: session.providerPaymentId, checkoutUrl: session.checkoutUrl } });
      if (returnTo) await this.redis.client.set(`deposit:return:${dep.publicRef}`, returnTo, 'EX', 86_400).catch(() => undefined);
      const bal = await this.core.balances(userId);
      return {
        ref: dep.publicRef,
        status: dep.status,
        method: dep.method,
        amount_usd: amount.toFixed(2),
        charge_amount_bdt: charge?.toFixed(2) ?? null,
        fx_rate: rate?.toFixed(2) ?? null,
        checkout_url: session.checkoutUrl,
        expires_at: expiresAt.toISOString(),
        balance_after_usd: usd2(bal.total.plus(amount)),
      };
    } catch (e) {
      await this.db.deposit.update({ where: { id: dep.id }, data: { status: 'failed', failedAt: new Date(), failureReason: 'provider_unavailable' } });
      if (e instanceof ApiError) throw e;
      throw new ApiError('PROVIDER_UNAVAILABLE');
    }
  }

  // ----------------------------------------------------------------- reads

  private methodLabel(d: { method: string; providerAsset: string | null }) {
    const asset = d.providerAsset ? { bkash: 'bKash', nagad: 'Nagad', usdt: 'USDT' }[d.providerAsset] ?? d.providerAsset : null;
    return `${METHOD_LABEL[d.method] ?? d.method}${asset ? ` · ${asset}` : ''}`;
  }

  async list(userId: string, q: { status?: string; page: number; per_page: number }) {
    const where: Prisma.DepositWhereInput = { employerUserId: userId, ...(q.status ? { status: q.status as never } : {}) };
    const [total, rows] = await Promise.all([
      this.db.deposit.count({ where }),
      this.db.deposit.findMany({ where, orderBy: { initiatedAt: 'desc' }, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    return new Paged(
      rows.map((d) => ({
        ref: d.publicRef,
        created_at: d.initiatedAt.toISOString(),
        method: d.method,
        method_label: this.methodLabel(d),
        amount_usd: usd2(d.amountUsd),
        credited_amount_usd: d.creditedAmountUsd ? usd2(d.creditedAmountUsd) : null,
        status: d.status,
      })),
      { total, page: q.page, per_page: q.per_page, total_pages: totalPages, has_more: q.page < totalPages },
    );
  }

  async get(userId: string, ref: string) {
    const d = await this.db.deposit.findFirst({ where: { publicRef: ref, employerUserId: userId } });
    if (!d) throw new ApiError('NOT_FOUND', "We can't find that deposit.");
    const bal = await this.core.balances(userId);
    let key: string = d.status;
    if (d.status === 'completed' && d.creditedAmountUsd && !dec(d.creditedAmountUsd).eq(dec(d.amountUsd))) key = dec(d.creditedAmountUsd).lt(dec(d.amountUsd)) ? 'underpaid' : 'overpaid';
    const returnTo = await this.redis.client.get(`deposit:return:${d.publicRef}`).catch(() => null);
    return {
      ref: d.publicRef,
      status: d.status,
      method: d.method,
      method_label: this.methodLabel(d),
      amount_usd: usd2(d.amountUsd),
      amount_received_usd: d.amountReceivedUsd ? usd2(d.amountReceivedUsd) : null,
      credited_amount_usd: d.creditedAmountUsd ? usd2(d.creditedAmountUsd) : null,
      charge_amount_bdt: d.chargeAmountBdt ? dec(d.chargeAmountBdt).toFixed(2) : null,
      message_key: key,
      failure_reason: d.status === 'failed' ? (d.failureReason === 'provider_declined' ? 'The payment provider declined the payment' : null) : null,
      return_to: returnTo,
      balance: { deposit_balance_usd: usd2(bal.total), available_usd: usd2(bal.available) },
      created_at: d.initiatedAt.toISOString(),
      completed_at: d.completedAt?.toISOString() ?? null,
      refunded_at: d.refundedAt?.toISOString() ?? null,
      expires_at: d.expiresAt?.toISOString() ?? null,
      checkout_url: d.status === 'initiated' ? d.checkoutUrl : null,
      retry_url: ['failed', 'cancelled', 'expired'].includes(d.status) ? `/employer/wallet?add=${usd2(d.amountUsd)}&method=${d.method}` : null,
    };
  }

  // ----------------------------------------------------------------- webhooks

  /** Stores the event, checks the signature, dedupes, then processes (Doc 08 §5.5). */
  async handleWebhook(provider: string, headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>) {
    if (!(PROVIDER_SLOTS as readonly string[]).includes(provider)) throw new ApiError('UNKNOWN_PROVIDER');
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new ApiError('UNKNOWN_PROVIDER');
    const canonical = canonicalJson(body ?? {});
    const raw = Buffer.from(canonical, 'utf8');
    const eventId = adapter.eventId(body) ?? createHash('sha256').update(raw).digest('hex');
    const valid = adapter.verifySignature(headers, canonical);
    const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => !/signature|authorization|cookie/i.test(k)));
    let event;
    try {
      event = await this.db.paymentWebhookEvent.create({
        data: {
          provider,
          direction: 'in',
          providerEventId: eventId,
          eventType: typeof body.event_type === 'string' ? body.event_type : null,
          signatureValid: valid,
          rawBody: raw,
          payload: body as Prisma.InputJsonValue,
          headers: safeHeaders as Prisma.InputJsonValue,
          attempts: 1,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    if (!valid) {
      this.log.warn(`webhook signature invalid provider=${provider} event=${eventId}`);
      await this.db.paymentWebhookEvent.update({ where: { id: event.id }, data: { processingResult: 'error', errorMessage: 'signature_invalid', processedAt: new Date() } });
      throw new ApiError('SIGNATURE_INVALID');
    }
    try {
      const result = await this.processEvent(adapter, body);
      await this.db.paymentWebhookEvent.update({ where: { id: event.id }, data: { processingResult: result.result, depositId: result.depositId, processedAt: new Date() } });
    } catch (e) {
      this.log.error(`webhook processing failed ${eventId}: ${String(e)}`);
      await this.db.paymentWebhookEvent.update({ where: { id: event.id }, data: { processingResult: 'error', errorMessage: String(e).slice(0, 1000) } });
    }
    return { received: true };
  }

  private async processEvent(adapter: PaymentProviderAdapter, body: Record<string, unknown>): Promise<{ result: string; depositId: string | null }> {
    const orderId = String(body.order_id ?? '');
    const dep = await this.db.deposit.findUnique({ where: { publicRef: orderId } });
    if (!dep || dep.provider !== adapter.slot || !dep.providerPaymentId) return { result: 'amount_mismatch', depositId: dep?.id ?? null };
    // WH-3: the provider's status API is the truth.
    const truth = await adapter.queryPayment(dep.providerPaymentId);
    if (truth.orderId && truth.orderId !== dep.publicRef) return { result: 'amount_mismatch', depositId: dep.id };
    if (truth.status === 'paid') {
      if (!truth.amountUsd || !new Decimal(truth.amountUsd).eq(dec(dep.amountUsd).toDecimalPlaces(2)) || truth.currency !== 'USD') {
        this.log.error(`deposit ${dep.publicRef} amount mismatch: provider ${truth.amountUsd} ${truth.currency}`);
        return { result: 'amount_mismatch', depositId: dep.id };
      }
      const credited = await this.complete(dep.id, adapter, new Decimal(truth.amountUsd));
      return { result: credited ? 'credited' : 'ignored_state', depositId: dep.id };
    }
    if (truth.status === 'failed' || truth.status === 'cancelled') {
      const r = await this.db.deposit.updateMany({
        where: { id: dep.id, status: { in: ['initiated', 'pending'] } },
        data: truth.status === 'failed' ? { status: 'failed', failedAt: new Date(), failureReason: 'provider_declined' } : { status: 'cancelled', failedAt: new Date() },
      });
      return { result: r.count ? 'credited' : 'ignored_state', depositId: dep.id };
    }
    if (truth.status === 'pending') {
      await this.db.deposit.updateMany({ where: { id: dep.id, status: 'initiated' }, data: { status: 'pending' } });
      return { result: 'ignored_state', depositId: dep.id };
    }
    return { result: 'ignored_state', depositId: dep.id };
  }

  /** One transaction: lock deposit, post `deposit` (gateway_clearing → employer_available), set completed. */
  private async complete(depositId: string, adapter: PaymentProviderAdapter, received: Decimal) {
    const res = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${depositId}::uuid FOR UPDATE`;
      const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
      if (!['initiated', 'pending', 'expired'].includes(d.status)) return null; // WH-8 state guard
      const clearing = await this.clearingAccount(tx, adapter.systemCode);
      const avail = await this.core.ledger.userAccount(d.employerUserId, 'employer_available', tx);
      await this.core.ledger.userAccount(d.employerUserId, 'employer_reserved', tx);
      const amount = dec(d.amountUsd);
      const t = await this.core.ledger.post(
        {
          type: 'deposit',
          idempotencyKey: `deposit:${d.publicRef}:complete`,
          description: { method: d.method, asset: d.providerAsset ? ({ bkash: 'bKash', nagad: 'Nagad' } as Record<string, string>)[d.providerAsset] ?? d.providerAsset : d.method === 'card' ? 'Card' : d.method === 'crypto' ? 'USDT' : null },
          refs: { depositId: d.id },
          lines: [
            { accountId: clearing.id, amount: amount.neg().toFixed(6) },
            { accountId: avail.id, amount: amount.toFixed(6) },
          ],
        },
        tx,
      );
      const now = new Date();
      await tx.deposit.update({
        where: { id: d.id },
        data: { status: 'completed', completedAt: now, amountReceivedUsd: new Prisma.Decimal(received.toFixed(6)), creditedAmountUsd: new Prisma.Decimal(amount.toFixed(6)), creditLedgerTxId: t.id },
      });
      return { d, amount, ledgerRef: t.publicRef };
    });
    if (!res) return false;
    const { d, amount } = res;
    const bal = await this.core.balances(d.employerUserId);
    await this.core.notify({
      userId: d.employerUserId,
      audience: 'employer',
      category: 'payments',
      type: 'deposit_completed',
      title: `Deposit completed · $${usd2(amount)}`,
      body: `$${usd2(amount)} was added to your balance. Deposit balance: $${usd2(bal.total)}.`,
      linkPath: `/employer/wallet/deposits/${d.publicRef}`,
      data: { deposit_ref: d.publicRef, amount: amount.toFixed(6) },
      mandatory: true,
      dedupeKey: `deposit-completed:${d.publicRef}`,
    });
    await this.depositCommission(d.id).catch((e) => this.log.error(`deposit commission ${d.publicRef}: ${String(e)}`));
    await this.autoResume(d.employerUserId).catch((e) => this.log.error(`auto-resume ${d.publicRef}: ${String(e)}`));
    return true;
  }

  private async clearingAccount(tx: Prisma.TransactionClient, code: string) {
    const acc = await tx.walletAccount.findUnique({ where: { systemCode: code } });
    if (acc) return acc;
    return tx.walletAccount.create({ data: { kind: 'gateway_clearing', systemCode: code, allowNegative: true } });
  }

  /** BR-071: 5% of a referred employer's completed deposit to the referrer (Doc 08 §9). */
  private async depositCommission(depositId: string) {
    if (!(await this.settings.get<boolean>('referral_enabled', true))) return;
    const d = await this.db.deposit.findUniqueOrThrow({ where: { id: depositId }, include: { employerUser: { select: { fullName: true } } } });
    const referral = await this.db.referral.findUnique({ where: { referredUserId: d.employerUserId } });
    if (!referral || referral.status === 'ineligible') return;
    const key = `referral:deposit:${d.id}`;
    if (await this.db.ledgerTransaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return;
    const rate = new Decimal(String(await this.settings.get('referral_deposit_rate', '0.05')));
    const base = dec(d.creditedAmountUsd ?? d.amountUsd);
    const amount = base.mul(rate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) return;
    const first = (d.employerUser.fullName ?? '').split(/\s+/)[0] ?? '';
    const masked = first.length >= 3 ? `${first.slice(0, 2)}***${first.slice(-1)}` : `${first.slice(0, 1)}***`;
    await this.db.$transaction(async (tx) => {
      const c = await tx.referralCommission.create({
        data: {
          referralId: referral.id,
          referrerUserId: referral.referrerUserId,
          referredUserId: d.employerUserId,
          sourceType: 'deposit',
          depositId: d.id,
          baseAmount: new Prisma.Decimal(base.toFixed(6)),
          rate: new Prisma.Decimal(rate.toFixed(6)),
          amount: new Prisma.Decimal(amount.toFixed(6)),
          status: 'credited',
          creditedAt: new Date(),
        },
      });
      const expense = await this.core.ledger.systemAccount('referral_expense', tx);
      const earnings = await this.core.ledger.userAccount(referral.referrerUserId, 'worker_earnings', tx);
      const t = await this.core.ledger.post(
        {
          type: 'referral_commission',
          idempotencyKey: key,
          description: { friend: masked, source: 'deposit' },
          refs: { depositId: d.id, referralCommissionId: c.id },
          lines: [
            { accountId: expense.id, amount: amount.neg().toFixed(6) },
            { accountId: earnings.id, amount: amount.toFixed(6) },
          ],
        },
        tx,
      );
      await tx.referralCommission.update({ where: { id: c.id }, data: { ledgerTxId: t.id } });
      await tx.referral.update({ where: { id: referral.id }, data: { status: 'active', activatedAt: referral.activatedAt ?? new Date(), eligibleAt: referral.eligibleAt ?? new Date(), lastActivityAt: new Date() } });
    });
  }

  /** BR-017: low-deposit paused jobs resume oldest first while funds cover them. */
  private async autoResume(userId: string) {
    const jobs = await this.db.job.findMany({ where: { employerUserId: userId, status: 'paused', pauseReason: 'low_deposit', deletedAt: null }, orderBy: { pausedAt: 'asc' } });
    for (const j of jobs) {
      try {
        await this.jobs.resume(userId, j.publicId, {});
        await this.core.notify({
          userId,
          audience: 'employer',
          category: 'tasks',
          type: 'employer_job_resumed',
          title: 'Job resumed',
          body: `“${j.title}” is running again now that your deposit covers it.`,
          linkPath: `/employer/jobs/${j.publicId}`,
        });
      } catch {
        break;
      }
    }
  }

  /** deposits.expire: initiated deposits past expires_at (Doc 08 §5.4). */
  async expireSweep() {
    await this.db.deposit.updateMany({ where: { status: 'initiated', expiresAt: { lt: new Date() } }, data: { status: 'expired' } });
  }

  // ----------------------------------------------------------------- dev mock gateway

  async mockInfo(ref: string) {
    if (!paymentsMockEnabled()) throw new ApiError('NOT_FOUND');
    const d = await this.db.deposit.findUnique({ where: { publicRef: ref }, include: { employerUser: { select: { employerProfile: { select: { businessName: true } } } } } });
    if (!d || d.provider !== 'mock') throw new ApiError('NOT_FOUND', "We can't find that payment session.");
    return {
      ref: d.publicRef,
      status: d.status,
      method: d.method,
      method_label: this.methodLabel(d),
      amount_usd: usd2(d.amountUsd),
      charge_amount_bdt: d.chargeAmountBdt ? dec(d.chargeAmountBdt).toFixed(2) : null,
      fx_rate: d.fxRate ? dec(d.fxRate).toFixed(2) : null,
      merchant: '24 Freelancing',
      payer: d.employerUser.employerProfile?.businessName ?? null,
      expires_at: d.expiresAt?.toISOString() ?? null,
      return_path: `/employer/wallet/deposits/${d.publicRef}`,
    };
  }

  /** The payer's choice on the mock page. Fires the same signed webhook a real gateway would. */
  async mockComplete(ref: string, outcome: 'paid' | 'failed' | 'cancelled') {
    if (!paymentsMockEnabled()) throw new ApiError('NOT_FOUND');
    const d = await this.db.deposit.findUnique({ where: { publicRef: ref } });
    if (!d || d.provider !== 'mock' || !d.providerPaymentId) throw new ApiError('NOT_FOUND', "We can't find that payment session.");
    await this.mock.setOutcome(d.providerPaymentId, outcome);
    const payload = {
      event_id: `evt_${randomUUID()}`,
      event_type: `payment.${outcome}`,
      payment_id: d.providerPaymentId,
      payment_status: outcome === 'paid' ? 'finished' : outcome,
      order_id: d.publicRef,
      price_amount: Number(dec(d.amountUsd).toFixed(2)),
      price_currency: 'usd',
      updated_at: Date.now(),
    };
    const sig = mockSign(canonicalJson(payload));
    await this.handleWebhook('mock', { 'x-mock-signature': sig, 'content-type': 'application/json' }, payload);
    return { ref: d.publicRef, outcome, return_path: `/employer/wallet/deposits/${d.publicRef}` };
  }
}
