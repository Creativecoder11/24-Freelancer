import { Body, Controller, Get, Headers, HttpCode, Injectable, Param, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { SettingsService } from '../../settings/settings.service';
import { EmployerCore } from '../../employer/employer-common';
import { invalidateUserStatus } from '../../auth/jwt-auth.guard';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { DualControlService, pendingResponse } from '../core/dual-control';
import { bool, dateRange, dec, idemKey, iso, m2, m6, needMoney, needReason, needText, paged, paging, pd, type Q } from '../core/helpers';

const OBJ = 'deposit';
const CLEARING: Record<string, string> = { bkash: 'gateway_clearing:bkash_checkout', nowpayments: 'gateway_clearing:nowpayments', crypto: 'gateway_clearing:nowpayments', sslcommerz: 'gateway_clearing:sslcommerz', card: 'gateway_clearing:sslcommerz', mock: 'gateway_clearing:mock' };
const TREASURY: Record<string, string> = { mobile_wallet: 'treasury:bkash_merchant', crypto: 'treasury:usdt_hot_wallet', card: 'treasury:bank_main' };

/** Deposits (Doc 06 §6.9, Doc 09 SCR-ADM-11, §13). Ledger postings per Doc 08 §4, §11.7–11.8. */
@Injectable()
export class AdminDepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly core: EmployerCore,
    private readonly dual: DualControlService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async find(ref: string) {
    const d = await this.db.deposit.findUnique({ where: { publicRef: ref.toUpperCase() } });
    if (!d) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    return d;
  }

  private async sysAcc(tx: Prisma.TransactionClient, code: string, kind: 'gateway_clearing' | 'treasury') {
    const a = await tx.walletAccount.findUnique({ where: { systemCode: code } });
    return a ?? tx.walletAccount.create({ data: { kind, systemCode: code, allowNegative: true } });
  }

  private methodLabel(d: { method: string; provider: string; providerAsset: string | null }) {
    if (d.method === 'mobile_wallet') return `Mobile wallet · ${d.providerAsset === 'nagad' ? 'Nagad' : 'bKash'}`;
    if (d.method === 'card') return `Card · ${d.provider}`;
    return 'Crypto · USDT';
  }

  private async refundable(d: { creditedAmountUsd: Prisma.Decimal | null; refundedAmountUsd: Prisma.Decimal; employerUserId: string; status: string }) {
    if (d.status !== 'completed') return new Decimal(0);
    const { available } = await this.core.balances(d.employerUserId);
    return Decimal.max(0, Decimal.min(dec(d.creditedAmountUsd).minus(dec(d.refundedAmountUsd)), available));
  }

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const and: Prisma.DepositWhereInput[] = [];
    const term = (q.q ?? '').trim();
    if (term) and.push({ OR: [{ publicRef: term.toUpperCase() }, { employerUser: { publicId: term } }, { providerPaymentId: term }] });
    if (q.ref) and.push({ publicRef: q.ref.toUpperCase() });
    if (q.status) and.push({ status: q.status as Prisma.EnumDepositStatusFilter['equals'] });
    if (q.method) and.push({ method: q.method as 'card' });
    if (q.provider) and.push({ provider: q.provider });
    if (bool(q.needs_review)) and.push({ needsReview: true });
    const { from, to } = dateRange(q);
    if (from || to) and.push({ initiatedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } });
    if (bool(q.pending_approval)) {
      const open = await this.db.adminPendingAction.findMany({ where: { objectType: OBJ, status: 'pending', createdByAdminId: { not: ctx.id } }, select: { objectId: true } });
      and.push({ id: { in: open.map((o) => o.objectId) } });
    }
    const where: Prisma.DepositWhereInput = and.length ? { AND: and } : {};
    const masked = !ctx.has('deposits.read');
    const [rows, total, pending, needsReview, waiting] = await Promise.all([
      this.db.deposit.findMany({ where, orderBy: q.status === 'pending' ? { initiatedAt: 'asc' } : { initiatedAt: 'desc' }, skip: p.skip, take: p.take, include: { employerUser: { select: { publicId: true, employerProfile: { select: { businessName: true } } } } } }),
      this.db.deposit.count({ where }),
      this.db.deposit.count({ where: { status: { in: ['initiated', 'pending'] } } }),
      this.db.deposit.count({ where: { needsReview: true } }),
      this.db.adminPendingAction.count({ where: { objectType: OBJ, status: 'pending' } }),
    ]);
    const pend = await this.dual.openMany(OBJ, rows.map((r) => r.id));
    return paged(
      rows.map((d) => ({
        ref: d.publicRef,
        employer_public_id: d.employerUser.publicId,
        business_name: masked ? null : (d.employerUser.employerProfile?.businessName ?? null),
        method: d.method,
        method_label: this.methodLabel(d),
        provider: d.provider,
        amount_usd: m2(d.amountUsd),
        credited_amount_usd: d.creditedAmountUsd ? m2(d.creditedAmountUsd) : null,
        refunded_amount_usd: m2(d.refundedAmountUsd),
        status: d.status,
        needs_review: d.needsReview,
        initiated_at: iso(d.initiatedAt),
        pending_approval: DualControlService.dto(pend.get(d.id) ?? null, ctx),
      })),
      total,
      p,
      { counts: { pending, needs_review: needsReview, pending_approval: waiting }, masked },
    );
  }

  async detail(ctx: AdminCtx, ref: string) {
    const d = await this.db.deposit.findUnique({ where: { publicRef: ref.toUpperCase() }, include: { employerUser: { select: { publicId: true, employerProfile: { select: { businessName: true } } } }, paymentWebhookEvents: { orderBy: { receivedAt: 'asc' } }, creditLedgerTx: { select: { publicRef: true } }, refundLedgerTx: { select: { publicRef: true } } } });
    if (!d) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    const days = await this.settings.number('deposit_refund_window_days', 30);
    const windowEnds = d.completedAt ? new Date(d.completedAt.getTime() + days * 86_400_000) : null;
    const pend = await this.dual.open(OBJ, d.id);
    return {
      ref: d.publicRef,
      status: d.status,
      needs_review: d.needsReview,
      employer: { public_id: d.employerUser.publicId, business_name: d.employerUser.employerProfile?.businessName ?? null },
      method: d.method,
      method_label: this.methodLabel(d),
      provider: d.provider,
      provider_payment_id: d.providerPaymentId,
      amount_usd: m2(d.amountUsd),
      amount_received_usd: d.amountReceivedUsd ? m2(d.amountReceivedUsd) : null,
      credited_amount_usd: d.creditedAmountUsd ? m2(d.creditedAmountUsd) : null,
      refunded_amount_usd: m2(d.refundedAmountUsd),
      provider_fee_exact: d.providerFee ? m6(d.providerFee) : null,
      charge_amount_bdt: d.chargeAmountBdt ? dec(d.chargeAmountBdt).toFixed(2) : null,
      fx_rate: d.fxRate ? dec(d.fxRate).toFixed(2) : null,
      pay_currency: d.payCurrency,
      tx_hash: d.txHash,
      confirmations: d.confirmations,
      failure_reason: d.failureReason,
      initiated_at: iso(d.initiatedAt),
      completed_at: iso(d.completedAt),
      credit_ledger_ref: d.creditLedgerTx?.publicRef ?? null,
      refund_ledger_ref: d.refundLedgerTx?.publicRef ?? null,
      refundable_usd: m2(await this.refundable(d)),
      refund_window_ends_at: iso(windowEnds),
      refund_window_open: !!windowEnds && windowEnds > new Date(),
      requery_supported: d.provider === 'mock',
      webhook_events: d.paymentWebhookEvents.map((e) => ({ id: e.id, event_type: e.eventType, signature_valid: e.signatureValid, processing_result: e.processingResult, received_at: iso(e.receivedAt) })),
      pending_approval: DualControlService.dto(pend, ctx),
    };
  }

  /** Posts `deposit` (gateway_clearing → employer_available) exactly once (key shared with the webhook path). */
  private async credit(ctx: AdminCtx, depositId: string, amount: Decimal, providerRef: string | null) {
    const r = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${depositId}::uuid FOR UPDATE`;
      const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
      if (!['initiated', 'pending', 'expired', 'failed'].includes(d.status)) throw new ApiError('INVALID_STATE', 'This deposit is already settled.');
      const clearing = await this.sysAcc(tx, CLEARING[d.provider] ?? `gateway_clearing:${d.provider}`, 'gateway_clearing');
      const avail = await this.core.ledger.userAccount(d.employerUserId, 'employer_available', tx);
      await this.core.ledger.userAccount(d.employerUserId, 'employer_reserved', tx);
      const t = await this.core.ledger.post({ type: 'deposit', idempotencyKey: `deposit:${d.publicRef}:complete`, actor: 'admin', adminId: ctx.id, description: { method: d.method, manual: true }, refs: { depositId: d.id }, lines: [ { accountId: clearing.id, amount: amount.neg().toFixed(6) }, { accountId: avail.id, amount: amount.toFixed(6) } ] }, tx);
      await tx.deposit.update({ where: { id: d.id }, data: { status: 'completed', completedAt: new Date(), amountReceivedUsd: pd(amount), creditedAmountUsd: pd(amount), creditLedgerTxId: t.id, needsReview: false, providerPaymentId: d.providerPaymentId ?? providerRef } });
      return { d, t };
    });
    await this.notify.user(r.d.employerUserId, { type: 'deposit_completed', audience: 'employer', category: 'payments', title: `Deposit completed · $${m2(amount)}`, body: `$${m2(amount)} was added to your balance.`, linkPath: `/employer/wallet/deposits/${r.d.publicRef}`, mandatory: true });
    return r;
  }

  async requery(ctx: AdminCtx, ref: string) {
    const d = await this.find(ref);
    if (d.provider !== 'mock' || !d.providerPaymentId) throw new ApiError('PROVIDER_UNAVAILABLE');
    const raw = await this.redis.client.get(`mockpay:${d.providerPaymentId}`).catch(() => null);
    const st = raw ? (JSON.parse(raw) as { status: string }).status : 'unknown';
    let credited = false;
    if (st === 'paid' && ['initiated', 'pending', 'expired'].includes(d.status)) {
      await this.credit(ctx, d.id, dec(d.amountUsd), null);
      credited = true;
    }
    const fresh = await this.find(ref);
    await this.audit.record(ctx, { action: 'deposit.requery', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, after: { provider_status: st, credited } });
    return { ref: d.publicRef, provider_status: st === 'paid' ? 'paid' : 'unpaid', status: fresh.status, credited, amount_usd: m2(d.amountUsd) };
  }

  async manualComplete(ctx: AdminCtx, ref: string, b: Record<string, unknown>, key: string, res: Response) {
    const providerRef = needText(b.provider_reference, 120, 'provider_reference', 'Enter the provider reference.');
    const amount = needMoney(b.amount_usd, 'amount_usd');
    const reason = needReason(b.reason);
    const d = await this.find(ref);
    if (!['initiated', 'pending', 'expired', 'failed'].includes(d.status)) throw new ApiError('INVALID_STATE', 'This deposit is already settled.');
    await this.db.$transaction(async (tx) => {
      await this.dual.create(tx, ctx, { action: 'deposit.manual_complete', objectType: OBJ, objectId: d.id, payload: { provider_reference: providerRef, amount_usd: amount.toFixed(2) }, reason, idempotencyKey: key });
      await this.audit.record(ctx, { action: 'deposit.manual_complete.pending_approval', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, after: { provider_reference: providerRef, amount_usd: amount.toFixed(2) } }, tx);
    });
    res.status(202);
    return pendingResponse('deposit.manual_complete', ctx.shortName, `/admin/deposits/${d.publicRef}/approve-manual`);
  }

  async approveManual(ctx: AdminCtx, ref: string) {
    const d = await this.find(ref);
    const p = await this.db.$transaction((tx) => this.dual.forDecision(tx, ctx, OBJ, d.id));
    if (p.action !== 'deposit.manual_complete') throw new ApiError('INVALID_STATE');
    const payload = p.payload as { provider_reference: string; amount_usd: string };
    const r = await this.credit(ctx, d.id, new Decimal(payload.amount_usd), payload.provider_reference);
    await this.db.$transaction(async (tx) => {
      await this.dual.close(tx, ctx, p.id, 'approved');
      await this.audit.record(ctx, { action: 'deposit.manual_complete', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason: p.reason, after: { status: 'completed', credited_amount_usd: payload.amount_usd, ledger_ref: r.t.publicRef, maker: p.createdByAdminId } }, tx);
    });
    return { ref: d.publicRef, status: 'completed', credited_amount_usd: payload.amount_usd, ledger_ref: r.t.publicRef };
  }

  async approve(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const d = await this.find(ref);
    if (!['initiated', 'pending', 'expired'].includes(d.status)) throw new ApiError('INVALID_STATE', 'This deposit cannot be approved.');
    const amount = b.amount_usd ? needMoney(b.amount_usd, 'amount_usd') : dec(d.amountUsd);
    const providerRef = (b.provider_reference ? String(b.provider_reference).trim() : null) || d.txHash || d.providerPaymentId || d.publicRef;
    const r = await this.credit(ctx, d.id, amount, providerRef);
    await this.audit.record(ctx, { action: 'deposit.approve', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, after: { status: 'completed', amount_usd: amount.toFixed(2), ledger_ref: r.t.publicRef, maker: ctx.fullName } });
    return { ref: d.publicRef, status: 'completed', credited_amount_usd: m2(amount), ledger_ref: r.t.publicRef };
  }

  async decline(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const reason = needText(b.reason ?? b.failure_reason, 300, 'reason', 'Enter a reason for declining.');
    const d = await this.find(ref);
    if (!['initiated', 'pending', 'expired'].includes(d.status)) throw new ApiError('INVALID_STATE', 'This deposit cannot be declined.');
    await this.db.$transaction(async (tx) => {
      await tx.deposit.update({ where: { id: d.id }, data: { status: 'failed', failedAt: new Date(), failureReason: reason } });
      await this.audit.record(ctx, { action: 'deposit.decline', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, before: { status: d.status }, after: { status: 'failed' } }, tx);
    });
    await this.notify.user(d.employerUserId, { type: 'deposit_failed', audience: 'employer', category: 'payments', title: 'Deposit declined', body: `Deposit ${d.publicRef} was declined: ${reason}`, linkPath: `/employer/wallet/deposits/${d.publicRef}`, mandatory: true });
    return { ref: d.publicRef, status: 'failed', failure_reason: reason };
  }

  async declinePending(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const note = needReason(b.decision_note, 500, 'decision_note');
    const d = await this.find(ref);
    const p = await this.db.$transaction(async (tx) => {
      const p = await this.dual.forDecision(tx, ctx, OBJ, d.id);
      await this.dual.close(tx, ctx, p.id, 'declined', note);
      await this.audit.record(ctx, { action: 'deposit.decline_pending', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason: note, after: { declined_action: p.action } }, tx);
      return p;
    });
    return { ref: d.publicRef, pending_action: { id: p.id, status: 'declined' } };
  }

  async markFailed(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason, 300);
    const d = await this.find(ref);
    if (!['initiated', 'pending', 'expired'].includes(d.status)) throw new ApiError('INVALID_STATE');
    await this.db.$transaction(async (tx) => {
      await tx.deposit.update({ where: { id: d.id }, data: { status: 'failed', failedAt: new Date(), failureReason: reason } });
      await this.audit.record(ctx, { action: 'deposit.mark_failed', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, before: { status: d.status }, after: { status: 'failed' } }, tx);
    });
    await this.notify.user(d.employerUserId, { type: 'deposit_failed', audience: 'employer', category: 'payments', title: 'Deposit failed', body: `Deposit ${d.publicRef} failed: ${reason}`, linkPath: `/employer/wallet/deposits/${d.publicRef}` });
    return { ref: d.publicRef, status: 'failed', failure_reason: reason };
  }

  private async execRefund(ctx: AdminCtx, depositId: string, amount: Decimal, fee: Decimal, reason: string) {
    const out = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${depositId}::uuid FOR UPDATE`;
      const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
      const acc = await this.core.lockAccounts(d.employerUserId, tx);
      const max = Decimal.max(0, Decimal.min(dec(d.creditedAmountUsd).minus(dec(d.refundedAmountUsd)), acc.availableBal));
      if (d.status !== 'completed') throw new ApiError('INVALID_STATE');
      if (amount.gt(max)) throw new ApiError('REFUND_EXCEEDS_AVAILABLE', `You can refund up to $${m2(max)}. The rest is reserved or spent.`, { amount_usd: [`You can refund up to $${m2(max)}.`] });
      const treasury = await this.sysAcc(tx, TREASURY[d.method] ?? 'treasury:bank_main', 'treasury');
      const lines = [ { accountId: acc.available.id, amount: amount.neg().toFixed(6) }, { accountId: treasury.id, amount: amount.minus(fee).toFixed(6) } ];
      if (fee.gt(0)) lines.push({ accountId: (await this.core.ledger.systemAccount('gateway_fees', tx)).id, amount: fee.toFixed(6) });
      const n = await tx.ledgerTransaction.count({ where: { idempotencyKey: { startsWith: `deposit:${d.publicRef}:refund:` } } });
      const t = await this.core.ledger.post({ type: 'deposit_refund', idempotencyKey: `deposit:${d.publicRef}:refund:${n + 1}`, actor: 'admin', adminId: ctx.id, reason, description: { reason: 'refund', fee: fee.toFixed(6) }, refs: { depositId: d.id }, lines }, tx);
      const refunded = dec(d.refundedAmountUsd).plus(amount);
      const full = refunded.gte(dec(d.creditedAmountUsd));
      await tx.deposit.update({ where: { id: d.id }, data: { refundedAmountUsd: pd(refunded), refundedAt: new Date(), refundLedgerTxId: t.id, status: full ? 'refunded' : 'completed' } });
      // Proportional referral reversal (Doc 09 §13.5).
      let reversed = new Decimal(0);
      const comms = await tx.referralCommission.findMany({ where: { depositId: d.id, status: 'credited' } });
      for (const c of comms) {
        const part = dec(c.rate).mul(amount).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        if (part.lte(0)) continue;
        const ref = await this.core.ledger.userAccount(c.referrerUserId, 'worker_earnings', tx);
        const exp = await this.core.ledger.systemAccount('referral_expense', tx);
        await this.core.ledger.post({ type: 'adjustment', idempotencyKey: `referral:${c.id}:refund:${t.id}`, actor: 'admin', adminId: ctx.id, reason: 'Referred deposit refunded', reasonCode: 'referral_reversal', description: { visible_text: 'Referral reversed' }, refs: { referralCommissionId: c.id, depositId: d.id }, lines: [ { accountId: ref.id, amount: part.neg().toFixed(6) }, { accountId: exp.id, amount: part.toFixed(6) } ] }, tx);
        reversed = reversed.plus(part);
        if (full) await tx.referralCommission.update({ where: { id: c.id }, data: { status: 'reversed', reversedAt: new Date(), statusReason: 'Deposit refunded' } });
      }
      return { d, t, full, reversed };
    });
    await this.notify.user(out.d.employerUserId, { type: 'deposit_refunded', audience: 'employer', category: 'payments', title: `Deposit refund · $${m2(amount)}`, body: `$${m2(amount.minus(fee))} is on its way to your original payment method.`, linkPath: `/employer/wallet/deposits/${out.d.publicRef}` });
    return out;
  }

  private refundInput(b: Record<string, unknown>, d: { providerFee: Prisma.Decimal | null }) {
    const amount = needMoney(b.amount_usd, 'amount_usd');
    const fee = b.provider_fee_usd !== undefined && b.provider_fee_usd !== '' ? new Decimal(String(b.provider_fee_usd)) : dec(d.providerFee);
    if (fee.lt(0) || fee.gte(amount)) throw new ApiError('VALIDATION_FAILED', undefined, { provider_fee_usd: ['The fee must be below the refund amount.'] });
    return { amount, fee: fee.toDecimalPlaces(6) };
  }

  async refund(ctx: AdminCtx, ref: string, b: Record<string, unknown>, key: string, res: Response) {
    const reason = needReason(b.reason);
    const d = await this.find(ref);
    if (d.status !== 'completed') throw new ApiError('INVALID_STATE');
    const { amount, fee } = this.refundInput(b, d);
    const days = await this.settings.number('deposit_refund_window_days', 30);
    const closed = !d.completedAt || d.completedAt.getTime() + days * 86_400_000 < Date.now();
    if (closed && !ctx.isSuper) throw new ApiError('REFUND_WINDOW_CLOSED');
    const max = await this.refundable(d);
    if (amount.gt(max)) throw new ApiError('REFUND_EXCEEDS_AVAILABLE', `You can refund up to $${m2(max)}. The rest is reserved or spent.`, { amount_usd: [`You can refund up to $${m2(max)}.`] });
    const threshold = new Decimal(String(await this.settings.get('payout_dual_approval_threshold_usd', '100.00')));
    if (amount.gte(threshold)) {
      await this.db.$transaction(async (tx) => {
        await this.dual.create(tx, ctx, { action: 'deposit.refund', objectType: OBJ, objectId: d.id, payload: { amount_usd: amount.toFixed(2), provider_fee_usd: fee.toFixed(6), window_override: closed }, reason, idempotencyKey: key });
        await this.audit.record(ctx, { action: 'deposit.refund.pending_approval', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, after: { amount_usd: amount.toFixed(2) } }, tx);
      });
      res.status(202);
      return pendingResponse('deposit.refund', ctx.shortName, `/admin/deposits/${d.publicRef}/approve-refund`);
    }
    const o = await this.execRefund(ctx, d.id, amount, fee, reason);
    await this.audit.record(ctx, { action: 'deposit.refund', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, after: { refunded_amount_usd: amount.toFixed(2), net: amount.minus(fee).toFixed(2), ledger_ref: o.t.publicRef, commission_reversed: o.reversed.toFixed(6), window_override: closed } });
    return { ref: d.publicRef, status: o.full ? 'refunded' : 'completed', refunded_amount_usd: m2(amount), net_refund_usd: m2(amount.minus(fee)), ledger_ref: o.t.publicRef, commission_reversed_usd: m2(o.reversed) };
  }

  async approveRefund(ctx: AdminCtx, ref: string) {
    const d = await this.find(ref);
    const p = await this.db.$transaction((tx) => this.dual.forDecision(tx, ctx, OBJ, d.id));
    if (p.action !== 'deposit.refund') throw new ApiError('INVALID_STATE');
    const pl = p.payload as { amount_usd: string; provider_fee_usd: string };
    const o = await this.execRefund(ctx, d.id, new Decimal(pl.amount_usd), new Decimal(pl.provider_fee_usd), p.reason);
    await this.db.$transaction(async (tx) => {
      await this.dual.close(tx, ctx, p.id, 'approved');
      await this.audit.record(ctx, { action: 'deposit.refund', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason: p.reason, after: { refunded_amount_usd: pl.amount_usd, ledger_ref: o.t.publicRef, approver: ctx.fullName } }, tx);
    });
    return { ref: d.publicRef, status: o.full ? 'refunded' : 'completed', refunded_amount_usd: m2(pl.amount_usd), ledger_ref: o.t.publicRef };
  }

  /** Chargeback (Doc 08 §11.8). The part beyond the balance posts as an adjustment, since only adjustments may go negative. */
  async chargeback(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const amount = needMoney(b.amount_usd, 'amount_usd');
    const fee = b.fee_usd ? needMoney(b.fee_usd, 'fee_usd') : new Decimal(0);
    const reason = needReason(b.reason, 300);
    const d = await this.find(ref);
    if (d.status !== 'completed' && d.status !== 'refunded') throw new ApiError('INVALID_STATE');
    const out = await this.db.$transaction(async (tx) => {
      const acc = await this.core.lockAccounts(d.employerUserId, tx);
      const clearing = await this.sysAcc(tx, CLEARING[d.provider] ?? `gateway_clearing:${d.provider}`, 'gateway_clearing');
      const covered = Decimal.max(0, Decimal.min(amount, acc.availableBal));
      const rest = amount.minus(covered);
      let ref1: string | null = null;
      if (covered.gt(0)) {
        const t = await this.core.ledger.post({ type: 'deposit_refund', idempotencyKey: `deposit:${d.publicRef}:chargeback`, actor: 'admin', adminId: ctx.id, reason, description: { reason: 'chargeback' }, refs: { depositId: d.id }, lines: [ { accountId: acc.available.id, amount: covered.neg().toFixed(6) }, { accountId: clearing.id, amount: covered.toFixed(6) } ] }, tx);
        ref1 = t.publicRef;
      }
      if (rest.gt(0)) {
        await this.core.ledger.post({ type: 'adjustment', idempotencyKey: `deposit:${d.publicRef}:chargeback:shortfall`, actor: 'admin', adminId: ctx.id, reason: `Chargeback ${reason}`.slice(0, 300), reasonCode: 'other', description: { reason: 'chargeback', visible_text: 'Chargeback on a deposit' }, refs: { depositId: d.id }, lines: [ { accountId: acc.available.id, amount: rest.neg().toFixed(6) }, { accountId: clearing.id, amount: rest.toFixed(6) } ] }, tx);
      }
      if (fee.gt(0)) {
        const gf = await this.core.ledger.systemAccount('gateway_fees', tx);
        await this.core.ledger.post({ type: 'adjustment', idempotencyKey: `deposit:${d.publicRef}:chargeback:fee`, actor: 'admin', adminId: ctx.id, reason: 'Chargeback fee', reasonCode: 'other', description: { reason: 'chargeback_fee' }, refs: { depositId: d.id }, lines: [ { accountId: gf.id, amount: fee.neg().toFixed(6) }, { accountId: clearing.id, amount: fee.toFixed(6) } ] }, tx);
      }
      const jobs = await tx.job.updateMany({ where: { employerUserId: d.employerUserId, status: 'running' }, data: { status: 'paused', pauseReason: 'admin', pausedAt: new Date() } });
      const u = await tx.user.findUniqueOrThrow({ where: { id: d.employerUserId } });
      if (u.status === 'active') {
        await tx.accountRestriction.create({ data: { userId: u.id, kind: 'restricted', reasonCode: 'chargeback', internalNote: reason, publicMessage: 'A payment on your account was disputed with the provider.', createdByAdminId: ctx.id } });
        await tx.user.update({ where: { id: u.id }, data: { status: 'restricted' } });
      }
      await tx.deposit.update({ where: { id: d.id }, data: { status: 'refunded', refundedAmountUsd: pd(dec(d.refundedAmountUsd).plus(amount)), refundedAt: new Date() } });
      const bal = await this.core.balances(d.employerUserId, tx);
      await this.audit.record(ctx, { action: 'deposit.chargeback', entityType: 'deposit', entityId: d.id, entityRef: d.publicRef, reason, after: { amount: amount.toFixed(2), balance: bal.available.toFixed(2), jobs_paused: jobs.count, status: 'refunded' } }, tx);
      return { jobs: jobs.count, bal: bal.available, ref1, userStatus: u.status === 'active' ? 'restricted' : u.status };
    });
    await invalidateUserStatus(this.redis, d.employerUserId);
    return { ref: d.publicRef, status: 'refunded', employer_available_usd: out.bal.toFixed(2), jobs_paused: out.jobs, user_status: out.userStatus, ledger_ref: out.ref1 };
  }
}

@Controller('admin/deposits')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminDepositsController {
  constructor(private readonly svc: AdminDepositsService) {}

  @Get()
  @Perms('deposits.read_masked', 'deposits.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get(':ref')
  @Perms('deposits.read')
  detail(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.detail(ctx, ref);
  }

  @Post(':ref/requery')
  @HttpCode(200)
  @Perms('deposits.write')
  requery(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.requery(ctx, ref);
  }

  @Post(':ref/manual-complete')
  @HttpCode(200)
  @Perms('deposits.write')
  @Reauth()
  manual(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') k?: string) {
    return this.svc.manualComplete(ctx, ref, b ?? {}, idemKey(k), res);
  }

  @Post(':ref/approve-manual')
  @HttpCode(200)
  @Perms('deposits.approve')
  @Reauth()
  approveManual(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.approveManual(ctx, ref);
  }

  @Post(':ref/decline-pending')
  @HttpCode(200)
  @Perms('deposits.approve')
  @Reauth()
  declinePendingAction(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.declinePending(ctx, ref, b ?? {});
  }

  @Post(':ref/mark-failed')
  @HttpCode(200)
  @Perms('deposits.write')
  markFailed(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.markFailed(ctx, ref, b ?? {});
  }

  @Post(':ref/approve')
  @HttpCode(200)
  @Perms('deposits.write')
  approve(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.approve(ctx, ref, b ?? {});
  }

  @Post(':ref/decline')
  @HttpCode(200)
  @Perms('deposits.write')
  declineDeposit(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.decline(ctx, ref, b ?? {});
  }

  @Post(':ref/refund')
  @HttpCode(200)
  @Perms('deposits.write')
  @Reauth()
  refund(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') k?: string) {
    return this.svc.refund(ctx, ref, b ?? {}, idemKey(k), res);
  }

  @Post(':ref/approve-refund')
  @HttpCode(200)
  @Perms('deposits.approve')
  @Reauth()
  approveRefund(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.approveRefund(ctx, ref);
  }

  @Post(':ref/chargeback')
  @HttpCode(200)
  @Perms('deposits.write')
  @Reauth()
  chargeback(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.chargeback(ctx, ref, b ?? {});
  }
}
