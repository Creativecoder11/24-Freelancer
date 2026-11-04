import { Body, Controller, Get, Headers, HttpCode, Injectable, Param, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { SettingsService } from '../../settings/settings.service';
import { LedgerService } from '../../ledger/ledger.service';
import { WithdrawalsService } from '../../withdrawals/withdrawals.service';
import { decryptPii } from '../../payout-methods/pii.crypto';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { DualControlService, pendingResponse } from '../core/dual-control';
import { bool, dec, idemKey, iso, m2, needEnum, needReason, needText, paged, paging, parseCsv, toCsv, type Q } from '../core/helpers';

const REJECT_CODES = ['invalid_account', 'name_mismatch', 'kyc_issue', 'suspected_fraud', 'duplicate_request', 'other'] as const;
const METHODS = ['bkash', 'nagad', 'rocket', 'usdt_trc20'] as const;
const OBJ = 'withdrawal';

/**
 * Withdrawal queue (Doc 06 §6.10, Doc 09 SCR-ADM-12, §14). State changes go through the
 * withdrawals module's admin methods; this layer adds roles, dual control, batches and audit.
 */
@Injectable()
export class AdminWithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly wd: WithdrawalsService,
    private readonly dual: DualControlService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private async find(ref: string) {
    const w = await this.db.withdrawal.findUnique({ where: { publicRef: ref.toUpperCase() }, include: { user: { select: { id: true, publicId: true, fullName: true, kycStatus: true, createdAt: true, workerProfile: true } } } });
    if (!w) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    return w;
  }

  private async isFirst(userId: string, wdId: string) {
    const prior = await this.db.withdrawal.count({ where: { userId, status: 'paid', id: { not: wdId } } });
    return prior === 0;
  }

  private async needsSecond(w: { id: string; userId: string; amountUsd: Prisma.Decimal }) {
    const threshold = new Decimal(String(await this.settings.get('payout_dual_approval_threshold_usd', '100.00')));
    return dec(w.amountUsd).gte(threshold) || (await this.isFirst(w.userId, w.id));
  }

  private riskAcked = (events: { data: Prisma.JsonValue }[]) => events.some((e) => (e.data as Record<string, unknown> | null)?.risk_acknowledged === true);

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const now = new Date();
    const where: Prisma.WithdrawalWhereInput = {};
    const and: Prisma.WithdrawalWhereInput[] = [];
    const term = (q.q ?? '').trim().toUpperCase();
    if (term) and.push({ OR: [{ publicRef: term }, { user: { publicId: term } }, { providerTrxId: term }] });
    if (q.ref) and.push({ publicRef: q.ref.toUpperCase() });
    if (q.status) and.push({ status: q.status as Prisma.EnumWithdrawalStatusFilter['equals'] });
    if (q.method) and.push({ method: q.method as (typeof METHODS)[number] });
    if (q.batch) and.push({ batchId: q.batch });
    const unacked: Prisma.WithdrawalWhereInput = { riskFlags: { isEmpty: false }, withdrawalEvents: { none: { data: { path: ['risk_acknowledged'], equals: true } } } };
    if (bool(q.held) === true) and.push({ OR: [{ holdUntil: { gt: now } }, unacked] });
    if (bool(q.held) === false) and.push({ OR: [{ holdUntil: null }, { holdUntil: { lte: now } }] });
    if (bool(q.risk) === false) and.push({ NOT: unacked });
    if (bool(q.risk) === true) and.push({ riskFlags: { isEmpty: false } });
    if (bool(q.pending_approval)) {
      const open = await this.db.adminPendingAction.findMany({ where: { objectType: OBJ, status: 'pending', createdByAdminId: { not: ctx.id } }, select: { objectId: true } });
      and.push({ id: { in: open.map((o) => o.objectId) } });
    }
    if (and.length) where.AND = and;
    const orderBy: Prisma.WithdrawalOrderByWithRelationInput = q.sort === '-requested_at' ? { requestedAt: 'desc' } : { requestedAt: 'asc' };
    const [rows, total, requested, processing, held, waiting] = await Promise.all([
      this.db.withdrawal.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { user: { select: { publicId: true, fullName: true, kycStatus: true } }, withdrawalEvents: { select: { data: true } } } }),
      this.db.withdrawal.count({ where }),
      this.db.withdrawal.count({ where: { status: 'requested' } }),
      this.db.withdrawal.count({ where: { status: 'processing' } }),
      this.db.withdrawal.count({ where: { status: 'requested', OR: [{ holdUntil: { gt: now } }, unacked] } }),
      this.db.adminPendingAction.count({ where: { objectType: OBJ, status: 'pending' } }),
    ]);
    const oldest = await this.db.withdrawal.findFirst({ where: { status: 'requested' }, orderBy: { requestedAt: 'asc' }, select: { requestedAt: true } });
    const pend = await this.dual.openMany(OBJ, rows.map((r) => r.id));
    const paidCounts = rows.length ? await this.db.withdrawal.groupBy({ by: ['userId'], where: { userId: { in: rows.map((r) => r.userId) }, status: 'paid' }, _count: { _all: true } }) : [];
    return paged(
      rows.map((w) => ({
        ref: w.publicRef,
        user_public_id: w.user.publicId,
        name_masked: maskName(w.user.fullName),
        kyc_status: w.user.kycStatus,
        method: w.method,
        destination_masked: w.destinationMasked,
        amount_usd: m2(w.amountUsd),
        fee_usd: m2(w.feeUsd),
        fx_rate: dec(w.fxRate).toFixed(2),
        payout_amount: w.payoutCurrency === 'BDT' ? dec(w.payoutAmount).toFixed(0) : dec(w.payoutAmount).toFixed(2),
        payout_currency: w.payoutCurrency,
        status: w.status,
        risk_flags: w.riskFlags,
        risk_acknowledged: this.riskAcked(w.withdrawalEvents),
        hold_until: w.holdUntil && w.holdUntil > now ? iso(w.holdUntil) : null,
        first_withdrawal: (paidCounts.find((c) => c.userId === w.userId)?._count._all ?? 0) === 0 && w.status !== 'paid',
        requested_at: iso(w.requestedAt),
        pending_approval: DualControlService.dto(pend.get(w.id) ?? null, ctx),
      })),
      total,
      p,
      { counts: { requested, processing, held, pending_approval: waiting }, oldest_requested_at: iso(oldest?.requestedAt) },
    );
  }

  async detail(ctx: AdminCtx, ref: string) {
    const w = await this.db.withdrawal.findUnique({
      where: { publicRef: ref.toUpperCase() },
      include: {
        user: { select: { id: true, publicId: true, fullName: true, kycStatus: true, createdAt: true, workerProfile: true, kycVerifications: { where: { status: 'verified' }, select: { nameOnDocument: true }, take: 1 } } },
        withdrawalEvents: { orderBy: { occurredAt: 'asc' }, include: { actorAdmin: { select: { fullName: true } } } },
        requestLedgerTx: { select: { publicRef: true } },
        settleLedgerTx: { select: { publicRef: true } },
        reversalLedgerTx: { select: { publicRef: true } },
        batch: { select: { id: true } },
      },
    });
    if (!w) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    const full = ctx.hasAny('withdrawals.read_account') || ctx.roles.some((r) => r === 'finance_admin' || r === 'super_admin');
    const destination = full ? decryptPii(w.destinationEncrypted) : null;
    if (full) await this.audit.safe(ctx, { action: 'withdrawal.view_account', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef });
    const pend = await this.dual.open(OBJ, w.id);
    const first = await this.isFirst(w.userId, w.id);
    return {
      ref: w.publicRef,
      status: w.status,
      user: { public_id: w.user.publicId, kyc_name: full ? (w.user.kycVerifications[0]?.nameOnDocument ?? w.user.fullName) : maskName(w.user.fullName), kyc_status: w.user.kycStatus, approval_rate_pct: w.user.workerProfile?.approvalRatePct ?? null, account_created_at: iso(w.user.createdAt) },
      first_withdrawal: first,
      method: w.method,
      destination: full ? (destination ?? null) : null,
      destination_masked: w.destinationMasked,
      destination_unavailable: full && !destination,
      amount_usd: m2(w.amountUsd),
      fee_usd: m2(w.feeUsd),
      net_usd: m2(dec(w.amountUsd).minus(dec(w.feeUsd))),
      fx_rate: dec(w.fxRate).toFixed(2),
      payout_amount: w.payoutCurrency === 'BDT' ? dec(w.payoutAmount).toFixed(0) : dec(w.payoutAmount).toFixed(2),
      payout_currency: w.payoutCurrency,
      risk_flags: w.riskFlags,
      hold_until: iso(w.holdUntil),
      requested_at: iso(w.requestedAt),
      processing_at: iso(w.processingAt),
      paid_at: iso(w.paidAt),
      provider_trx_id: w.providerTrxId,
      reject_reason_code: w.rejectReasonCode,
      reject_reason_text: w.rejectReasonText,
      batch_id: w.batch?.id ?? null,
      request_ledger_ref: w.requestLedgerTx.publicRef,
      settle_ledger_ref: w.settleLedgerTx?.publicRef ?? null,
      reversal_ledger_ref: w.reversalLedgerTx?.publicRef ?? null,
      events: w.withdrawalEvents.map((e) => ({ from_status: e.fromStatus, to_status: e.toStatus, actor_type: e.actorType, actor: e.actorAdmin?.fullName ?? null, note: e.note, occurred_at: iso(e.occurredAt) })),
      requires_second_approval: await this.needsSecond(w),
      pending_approval: DualControlService.dto(pend, ctx),
    };
  }

  async process(ctx: AdminCtx, ref: string) {
    const w = await this.find(ref);
    const acked = await this.db.withdrawalEvent.findFirst({ where: { withdrawalId: w.id, data: { path: ['risk_acknowledged'], equals: true } } });
    if (w.riskFlags.length && !acked && w.status === 'requested') throw new ApiError('WITHDRAWAL_ON_HOLD', 'This withdrawal has risk flags. Release the hold after review first.');
    const r = await this.wd.adminStartProcessing(w.publicRef, ctx.id);
    await this.audit.record(ctx, { action: 'withdrawal.mark_processing', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, before: { status: w.status }, after: { status: r.status } });
    return { ref: w.publicRef, status: r.status, processing_at: iso(r.processingAt) };
  }

  async releaseHold(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const w = await this.find(ref);
    if (w.status !== 'requested') throw new ApiError('INVALID_STATE');
    await this.wd.adminReleaseHold(w.publicRef, ctx.id);
    await this.db.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'requested', toStatus: 'requested', actorType: 'admin', actorAdminId: ctx.id, note: reason.slice(0, 300), data: { risk_acknowledged: true, flags: w.riskFlags } } });
    await this.audit.record(ctx, { action: 'withdrawal.release_hold', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, reason, before: { hold_until: w.holdUntil }, after: { hold_until: null, flags_acknowledged: w.riskFlags } });
    return { ref: w.publicRef, hold_until: null };
  }

  private validTrx(method: string, v: unknown) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (method === 'usdt_trc20') {
      if (!/^[0-9a-f]{64}$/i.test(s)) throw new ApiError('VALIDATION_FAILED', undefined, { provider_trx_id: ['Enter the 64-character transaction hash.'] });
      return s.toLowerCase();
    }
    const up = s.toUpperCase();
    if (!/^[A-Z0-9]{8,12}$/.test(up)) throw new ApiError('VALIDATION_FAILED', undefined, { provider_trx_id: ['Enter the TrxID: 8 to 12 letters and digits.'] });
    return up;
  }

  private async execMarkPaid(ctx: AdminCtx, ref: string, trx: string, paidAt: Date | undefined) {
    const r = await this.wd.adminMarkPaid(ref, ctx.id, { providerTrxId: trx, paidAt });
    const t = r.settleLedgerTxId ? await this.db.ledgerTransaction.findUnique({ where: { id: r.settleLedgerTxId }, select: { publicRef: true } }) : null;
    return { r, ledgerRef: t?.publicRef ?? null };
  }

  private async execReturn(ctx: AdminCtx, ref: string, to: 'rejected' | 'failed', code: string, text: string) {
    if (to === 'rejected') {
      const r = await this.wd.adminReject(ref, ctx.id, { reasonCode: code, reasonText: text });
      const t = r.reversalLedgerTxId ? await this.db.ledgerTransaction.findUnique({ where: { id: r.reversalLedgerTxId }, select: { publicRef: true } }) : null;
      return { r, ledgerRef: t?.publicRef ?? null };
    }
    // Failed: `withdrawal_reversal` with the same key the withdrawals module uses (one reversal per row).
    const w = await this.db.$transaction(async (tx) => {
      const w0 = await tx.withdrawal.findUniqueOrThrow({ where: { publicRef: ref } });
      await tx.$queryRaw`SELECT id FROM withdrawals WHERE id = ${w0.id}::uuid FOR UPDATE`;
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id: w0.id } });
      if (w.status !== 'processing') throw new ApiError('INVALID_STATE', undefined, undefined, { status: w.status });
      const acc = await this.ledger.userAccount(w.userId, 'worker_earnings', tx);
      const clearing = await this.ledger.systemAccount('payout_clearing', tx);
      const amount = dec(w.amountUsd);
      const t = await this.ledger.post({ type: 'withdrawal_reversal', idempotencyKey: `withdrawal:${w.id}:reverse`, actor: 'admin', adminId: ctx.id, description: { cause: 'failed', method: w.method, masked: `••${w.destinationMasked.slice(-3)}`, wd_ref: w.publicRef }, refs: { withdrawalId: w.id }, lines: [ { accountId: clearing.id, amount: amount.neg().toFixed(6) }, { accountId: acc.id, amount: amount.toFixed(6) } ] }, tx);
      const now = new Date();
      const upd = await tx.withdrawal.update({ where: { id: w.id }, data: { status: 'failed', failedAt: now, rejectReasonCode: 'other', rejectReasonText: text.slice(0, 300), reversalLedgerTxId: t.id } });
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'processing', toStatus: 'failed', actorType: 'admin', actorAdminId: ctx.id, note: text.slice(0, 300) } });
      return { upd, ref: t.publicRef };
    });
    await this.notify.user(w.upd.userId, { type: 'withdrawal_failed', audience: 'worker', category: 'payments', title: `Withdrawal failed and refunded · $${m2(w.upd.amountUsd)}`, body: `${text} The amount is back in your balance.`, linkPath: `/worker/wallet/withdrawals/${w.upd.publicRef}`, mandatory: true });
    return { r: w.upd, ledgerRef: w.ref };
  }

  async markPaid(ctx: AdminCtx, ref: string, b: Record<string, unknown>, res: Response, key: string) {
    const w = await this.find(ref);
    if (w.status !== 'processing') throw new ApiError('INVALID_STATE', 'Only processing withdrawals can be marked paid.');
    const trx = this.validTrx(w.method, b.provider_trx_id);
    let paidAt: Date | undefined;
    if (b.paid_at) {
      paidAt = new Date(String(b.paid_at));
      if (Number.isNaN(paidAt.getTime()) || paidAt > new Date() || (w.processingAt && paidAt < w.processingAt)) throw new ApiError('VALIDATION_FAILED', undefined, { paid_at: ['Choose a time between when processing started and now.'] });
    }
    const dup = await this.db.withdrawal.findFirst({ where: { providerTrxId: trx, id: { not: w.id } }, select: { publicRef: true } });
    if (dup) throw new ApiError('DUPLICATE_PROVIDER_TXN', undefined, { provider_trx_id: ['This TrxID is already recorded on another withdrawal.'] }, { withdrawal_ref: dup.publicRef });
    if (await this.needsSecond(w)) {
      await this.db.$transaction(async (tx) => {
        await this.dual.create(tx, ctx, { action: 'withdrawal.mark_paid', objectType: OBJ, objectId: w.id, payload: { provider_trx_id: trx, paid_at: paidAt?.toISOString() ?? null, receipt_upload_id: b.receipt_upload_id ?? null }, reason: `Mark paid with TrxID ${trx}`, idempotencyKey: key });
        await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: w.status, toStatus: w.status, actorType: 'admin', actorAdminId: ctx.id, note: 'Mark paid sent for second approval', data: { pending: 'mark_paid', provider_trx_id: trx } } });
        await this.audit.record(ctx, { action: 'withdrawal.mark_paid.pending_approval', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, after: { provider_trx_id: trx, paid_at: paidAt ?? null } }, tx);
      });
      res.status(202);
      return pendingResponse('withdrawal.mark_paid', ctx.shortName, `/admin/withdrawals/${w.publicRef}/approve`);
    }
    const { r, ledgerRef } = await this.execMarkPaid(ctx, w.publicRef, trx, paidAt);
    await this.audit.record(ctx, { action: 'withdrawal.mark_paid', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, before: { status: 'processing' }, after: { status: 'paid', provider_trx_id: trx, ledger_ref: ledgerRef, maker: ctx.fullName } });
    return { ref: w.publicRef, status: r.status, paid_at: iso(r.paidAt), provider_trx_id: trx, ledger_ref: ledgerRef };
  }

  async reject(ctx: AdminCtx, ref: string, b: Record<string, unknown>, res: Response, key: string) {
    const code = needEnum(b.reason_code, REJECT_CODES, 'reason_code');
    const text = needText(b.reason_text, 300, 'reason_text', 'Enter a reason. The worker sees it.');
    const w = await this.find(ref);
    if (w.status !== 'requested' && w.status !== 'processing') throw new ApiError('INVALID_STATE');
    if (await this.needsSecond(w)) {
      await this.db.$transaction(async (tx) => {
        await this.dual.create(tx, ctx, { action: 'withdrawal.reject', objectType: OBJ, objectId: w.id, payload: { reason_code: code, reason_text: text, from_status: w.status }, reason: text, idempotencyKey: key });
        await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: w.status, toStatus: w.status, actorType: 'admin', actorAdminId: ctx.id, note: 'Reject sent for second approval', data: { pending: 'reject', reason_code: code } } });
        await this.audit.record(ctx, { action: 'withdrawal.reject.pending_approval', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, reason: text, after: { reason_code: code, reason_text: text } }, tx);
      });
      res.status(202);
      return pendingResponse('withdrawal.reject', ctx.shortName, `/admin/withdrawals/${w.publicRef}/approve`);
    }
    const { r, ledgerRef } = await this.execReturn(ctx, w.publicRef, 'rejected', code, text);
    await this.audit.record(ctx, { action: 'withdrawal.reject', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, reason: text, before: { status: w.status }, after: { status: 'rejected', reason_code: code, ledger_ref: ledgerRef } });
    return { ref: w.publicRef, status: r.status, reject_reason_code: code, reject_reason_text: text, ledger_ref: ledgerRef };
  }

  async markFailed(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const text = needText(b.reason_text, 300, 'reason_text', 'Enter the provider error.');
    const w = await this.find(ref);
    if (w.status !== 'processing') throw new ApiError('INVALID_STATE');
    const { r, ledgerRef } = await this.execReturn(ctx, w.publicRef, 'failed', 'other', text);
    await this.voidPending(ctx, w.id);
    await this.audit.record(ctx, { action: 'withdrawal.fail', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, reason: text, before: { status: 'processing' }, after: { status: 'failed', ledger_ref: ledgerRef } });
    return { ref: w.publicRef, status: r.status, ledger_ref: ledgerRef };
  }

  private async voidPending(ctx: AdminCtx, id: string) {
    await this.db.$transaction(async (tx) => {
      const p = await this.dual.open(OBJ, id, tx);
      if (p) await this.dual.close(tx, ctx, p.id, 'void');
    });
  }

  async approve(ctx: AdminCtx, ref: string) {
    const w = await this.find(ref);
    const p = await this.db.$transaction((tx) => this.dual.forDecision(tx, ctx, OBJ, w.id));
    const payload = p.payload as Record<string, string | null>;
    const fromStatus = payload.from_status;
    const valid = p.action === 'withdrawal.mark_paid' ? w.status === 'processing' : w.status === fromStatus || w.status === 'requested' || w.status === 'processing';
    if (!valid) {
      await this.db.$transaction((tx) => this.dual.close(tx, ctx, p.id, 'void'));
      throw new ApiError('INVALID_STATE', 'This withdrawal changed since the request, so the pending action was voided.');
    }
    let result: { r: { status: string }; ledgerRef: string | null };
    if (p.action === 'withdrawal.mark_paid') {
      const dup = await this.db.withdrawal.findFirst({ where: { providerTrxId: payload.provider_trx_id!, id: { not: w.id } }, select: { publicRef: true } });
      if (dup) throw new ApiError('DUPLICATE_PROVIDER_TXN', undefined, undefined, { withdrawal_ref: dup.publicRef });
      result = await this.execMarkPaid(ctx, w.publicRef, payload.provider_trx_id!, payload.paid_at ? new Date(payload.paid_at) : undefined);
    } else {
      result = await this.execReturn(ctx, w.publicRef, 'rejected', payload.reason_code!, payload.reason_text!);
    }
    const maker = await this.db.adminUser.findUnique({ where: { id: p.createdByAdminId }, select: { fullName: true } });
    await this.db.$transaction(async (tx) => {
      await this.dual.close(tx, ctx, p.id, 'approved');
      await this.audit.record(ctx, { action: 'withdrawal.approve', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, after: { approved_action: p.action, maker: maker?.fullName, approver: ctx.fullName, ledger_ref: result.ledgerRef } }, tx);
      await this.audit.record(ctx, { action: p.action, entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, after: { status: result.r.status, ...payload, maker: maker?.fullName, approver: ctx.fullName, ledger_ref: result.ledgerRef } }, tx);
    });
    return { ref: w.publicRef, status: result.r.status, approved_by: ctx.shortName, ledger_ref: result.ledgerRef };
  }

  async decline(ctx: AdminCtx, ref: string, b: Record<string, unknown>) {
    const note = needReason(b.decision_note, 500, 'decision_note');
    const w = await this.find(ref);
    const p = await this.db.$transaction(async (tx) => {
      const p = await this.dual.forDecision(tx, ctx, OBJ, w.id);
      await this.dual.close(tx, ctx, p.id, 'declined', note);
      await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: w.status, toStatus: w.status, actorType: 'admin', actorAdminId: ctx.id, note: `Second approval declined: ${note}`.slice(0, 300) } });
      await this.audit.record(ctx, { action: 'withdrawal.decline', entityType: 'withdrawal', entityId: w.id, entityRef: w.publicRef, reason: note, after: { declined_action: p.action } }, tx);
      return p;
    });
    return { ref: w.publicRef, status: w.status, pending_action: { id: p.id, status: 'declined' } };
  }

  // ------------------------------------------------------------------ batches

  async batches(q: Q) {
    const p = paging(q);
    const where: Prisma.WithdrawalBatcheWhereInput = q.method ? { method: q.method as (typeof METHODS)[number] } : {};
    const [rows, total] = await Promise.all([
      this.db.withdrawalBatche.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { createdByAdmin: { select: { fullName: true } }, _count: { select: { withdrawals: { where: { status: 'processing' } } } } } }),
      this.db.withdrawalBatche.count({ where }),
    ]);
    return paged(
      rows.map((b) => ({ id: b.id, method: b.method, count: b.rowCount, total_usd: m2(b.totalAmountUsd), status: b._count.withdrawals === 0 && b.status !== 'exported' ? 'closed' : b.status, created_by: b.createdByAdmin.fullName, created_at: iso(b.createdAt), checksum: b.exportSha256 ? Buffer.from(b.exportSha256).toString('hex') : null, imported_at: iso(b.importedAt), import_result: b.importResult, still_processing: b._count.withdrawals })),
      total,
      p,
    );
  }

  private eligibleWhere(method: string, min?: Decimal, max?: Decimal): Prisma.WithdrawalWhereInput {
    const now = new Date();
    return {
      status: 'requested',
      method: method as (typeof METHODS)[number],
      OR: [{ holdUntil: null }, { holdUntil: { lte: now } }],
      NOT: { riskFlags: { isEmpty: false }, withdrawalEvents: { none: { data: { path: ['risk_acknowledged'], equals: true } } } },
      ...(min || max ? { amountUsd: { ...(min ? { gte: min.toFixed(2) } : {}), ...(max ? { lte: max.toFixed(2) } : {}) } } : {}),
    };
  }

  private batchParams(b: Record<string, unknown>) {
    const method = needEnum(b.method, METHODS, 'method');
    const maxRows = Math.min(500, Math.max(1, Math.floor(Number(b.max_rows ?? 100) || 100)));
    const min = b.min_amount_usd ? new Decimal(String(b.min_amount_usd)) : undefined;
    const max = b.max_amount_usd ? new Decimal(String(b.max_amount_usd)) : undefined;
    return { method, maxRows, min, max };
  }

  async batchPreview(q: Q) {
    const { method, maxRows, min, max } = this.batchParams(q as Record<string, unknown>);
    const rows = await this.db.withdrawal.findMany({ where: this.eligibleWhere(method, min, max), orderBy: { requestedAt: 'asc' }, take: maxRows, select: { amountUsd: true } });
    return { count: rows.length, total_usd: m2(rows.reduce((a, r) => a.plus(dec(r.amountUsd)), new Decimal(0))) };
  }

  async createBatch(ctx: AdminCtx, b: Record<string, unknown>, res: Response) {
    const { method, maxRows, min, max } = this.batchParams(b);
    const rows = await this.db.withdrawal.findMany({ where: this.eligibleWhere(method, min, max), orderBy: { requestedAt: 'asc' }, take: maxRows, include: { user: { select: { publicId: true, fullName: true, kycVerifications: { where: { status: 'verified' }, select: { nameOnDocument: true }, take: 1 } } } } });
    if (!rows.length) throw new ApiError('INVALID_STATE', 'No withdrawals qualify for this batch.');
    const total = rows.reduce((a, r) => a.plus(dec(r.amountUsd)), new Decimal(0));
    const batch = await this.db.withdrawalBatche.create({ data: { method, rowCount: rows.length, totalAmountUsd: total.toFixed(6), createdByAdminId: ctx.id } });
    const done: typeof rows = [];
    for (const r of rows) {
      try {
        await this.wd.adminStartProcessing(r.publicRef, ctx.id, { batchId: batch.id });
        done.push(r);
      } catch {
        /* cancelled by the worker in the meantime: skipped */
      }
    }
    const csv = toCsv(
      ['reference', 'requested_at', 'user_public_id', 'kyc_name', 'method', 'account_number', 'amount_usd', 'fee_usd', 'net_usd', 'fx_rate', 'payout_amount', 'payout_currency', 'risk_flags'],
      done.map((w) => [w.publicRef, iso(w.requestedAt), w.user.publicId, w.user.kycVerifications[0]?.nameOnDocument ?? w.user.fullName, w.method, decryptPii(w.destinationEncrypted) ?? w.destinationMasked, m2(w.amountUsd), m2(w.feeUsd), m2(dec(w.amountUsd).minus(dec(w.feeUsd))), dec(w.fxRate).toFixed(2), w.payoutCurrency === 'BDT' ? dec(w.payoutAmount).toFixed(0) : dec(w.payoutAmount).toFixed(2), w.payoutCurrency, w.riskFlags.join(' ')]),
      [6, 7, 8, 9, 10],
    );
    const sha = createHash('sha256').update(csv).digest();
    const doneTotal = done.reduce((a, r) => a.plus(dec(r.amountUsd)), new Decimal(0));
    await this.db.withdrawalBatche.update({ where: { id: batch.id }, data: { exportSha256: new Uint8Array(sha), rowCount: done.length, totalAmountUsd: doneTotal.toFixed(6) } });
    await this.audit.record(ctx, { action: 'withdrawal.export', entityType: 'withdrawal_batch', entityId: batch.id, after: { rows: done.length, total_usd: doneTotal.toFixed(2), sha256: sha.toString('hex'), method } });
    const stamp = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    res.status(201);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payout-batch-${method}-${stamp}.csv"`);
    res.setHeader('X-Batch-Id', batch.id);
    res.setHeader('X-Checksum-SHA256', sha.toString('hex'));
    res.setHeader('Access-Control-Expose-Headers', 'X-Batch-Id, X-Checksum-SHA256, Content-Disposition');
    res.send(csv);
  }

  /** Import paid results. Accepts the CSV text directly (`csv`) — admin uploads have no presign route yet. */
  async importBatch(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const batch = await this.db.withdrawalBatche.findUnique({ where: { id } });
    if (!batch) throw new ApiError('NOT_FOUND');
    const text = typeof b.csv === 'string' ? b.csv : '';
    if (!text.trim()) throw new ApiError('UPLOAD_NOT_READY', 'Choose the results file first.');
    const rows = parseCsv(text);
    const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = (n: string) => head.indexOf(n);
    if (col('reference') < 0 || col('status') < 0) throw new ApiError('VALIDATION_FAILED', undefined, { csv: ['Columns must be reference,provider_trx_id,paid_at,status,reason.'] });
    const out = { batch_id: id, paid: 0, rejected: 0, failed: 0, pending_approval: 0, errors: [] as { reference: string; code: string }[] };
    for (const r of rows) {
      const ref = (r[col('reference')] ?? '').trim().toUpperCase();
      const status = (r[col('status')] ?? '').trim().toLowerCase();
      const fakeRes = { status: (_: number) => fakeRes } as unknown as Response;
      try {
        const w = await this.db.withdrawal.findUnique({ where: { publicRef: ref }, select: { batchId: true } });
        if (!w || w.batchId !== id) throw new ApiError('NOT_FOUND');
        let res: { status: string };
        if (status === 'paid') res = (await this.markPaid(ctx, ref, { provider_trx_id: r[col('provider_trx_id')], paid_at: r[col('paid_at')] || undefined }, fakeRes, `import-${id}-${ref}`)) as { status: string };
        else if (status === 'rejected') res = (await this.reject(ctx, ref, { reason_code: 'other', reason_text: r[col('reason')] || 'Payment could not be completed.' }, fakeRes, `import-${id}-${ref}`)) as { status: string };
        else if (status === 'failed') res = await this.markFailed(ctx, ref, { reason_text: r[col('reason')] || 'Provider error' });
        else throw new ApiError('VALIDATION_FAILED');
        if (res.status === 'pending_approval') out.pending_approval++;
        else if (res.status === 'paid') out.paid++;
        else if (res.status === 'rejected') out.rejected++;
        else if (res.status === 'failed') out.failed++;
      } catch (e) {
        out.errors.push({ reference: ref || '(blank)', code: e instanceof ApiError ? e.code : 'INTERNAL_ERROR' });
      }
    }
    await this.db.withdrawalBatche.update({ where: { id }, data: { status: 'imported', importedAt: new Date(), importResult: out as unknown as Prisma.InputJsonValue } });
    ctx.audited = false;
    await this.audit.record(ctx, { action: 'withdrawal.import', entityType: 'withdrawal_batch', entityId: id, after: { paid: out.paid, rejected: out.rejected, failed: out.failed, pending_approval: out.pending_approval, errors: out.errors.length } });
    return out;
  }
}

@Controller('admin/withdrawals')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminWithdrawalsController {
  constructor(private readonly svc: AdminWithdrawalsService) {}

  @Get()
  @Perms('withdrawals.read_masked', 'withdrawals.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('batches')
  @Perms('withdrawals.write')
  batches(@Query() q: Q) {
    return this.svc.batches(q);
  }

  @Get('batches/preview')
  @Perms('withdrawals.write')
  preview(@Query() q: Q) {
    return this.svc.batchPreview(q);
  }

  @Post('batches')
  @Perms('withdrawals.write')
  @Reauth()
  async create(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>, @Res() res: Response, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    await this.svc.createBatch(ctx, b ?? {}, res);
  }

  @Post('batches/:id/import')
  @HttpCode(200)
  @Perms('withdrawals.write')
  @Reauth()
  import(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.importBatch(ctx, id, b ?? {});
  }

  @Get(':ref')
  @Perms('withdrawals.read')
  detail(@Admin() ctx: AdminCtx, @Param('ref') ref: string) {
    return this.svc.detail(ctx, ref);
  }

  @Post(':ref/process')
  @HttpCode(200)
  @Perms('withdrawals.write')
  process(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.process(ctx, ref);
  }

  @Post(':ref/release-hold')
  @HttpCode(200)
  @Perms('withdrawals.write')
  @Reauth()
  release(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.releaseHold(ctx, ref, b ?? {});
  }

  @Post(':ref/mark-paid')
  @HttpCode(200)
  @Perms('withdrawals.write')
  @Reauth()
  markPaid(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') k?: string) {
    return this.svc.markPaid(ctx, ref, b ?? {}, res, idemKey(k));
  }

  @Post(':ref/reject')
  @HttpCode(200)
  @Perms('withdrawals.write')
  @Reauth()
  reject(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') k?: string) {
    return this.svc.reject(ctx, ref, b ?? {}, res, idemKey(k));
  }

  @Post(':ref/mark-failed')
  @HttpCode(200)
  @Perms('withdrawals.write')
  @Reauth()
  markFailed(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.markFailed(ctx, ref, b ?? {});
  }

  @Post(':ref/approve')
  @HttpCode(200)
  @Perms('withdrawals.approve')
  @Reauth()
  approve(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.approve(ctx, ref);
  }

  @Post(':ref/decline')
  @HttpCode(200)
  @Perms('withdrawals.approve')
  @Reauth()
  decline(@Admin() ctx: AdminCtx, @Param('ref') ref: string, @Body() b: Record<string, unknown>) {
    return this.svc.decline(ctx, ref, b ?? {});
  }
}

void bool;
