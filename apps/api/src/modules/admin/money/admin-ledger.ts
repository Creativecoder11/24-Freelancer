import { Body, Controller, Get, Headers, HttpCode, Injectable, Param, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { maskName } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { ApiError } from '../../../common/api-error';
import { LedgerService } from '../../ledger/ledger.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { bool, dateRange, dec, idemKey, iso, m2, m6, needEnum, needMoney, needReason, needText, paged, paging, parseCsv, type Q } from '../core/helpers';
import { AdminWorkService } from '../work/admin-work';

const ADJ_REASONS = ['correction', 'goodwill', 'fx_difference', 'referral_reversal', 'write_off', 'provider_settlement', 'other'] as const;
const USER_KINDS = ['worker_earnings', 'employer_available', 'employer_reserved'] as const;

/** Ledger, adjustments, reconciliation and referrals (Doc 06 §6.11–6.13; Doc 09 SCR-ADM-13/14). */
@Injectable()
export class AdminLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
    private readonly work: AdminWorkService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const aggregateOnly = !ctx.has('ledger.read');
    if (aggregateOnly && !bool(q.aggregate)) throw new ApiError('ADMIN_FORBIDDEN');
    const where: Prisma.LedgerTransactionWhereInput = {};
    const and: Prisma.LedgerTransactionWhereInput[] = [];
    if (q.q || q.ref) and.push({ publicRef: (q.q || q.ref)!.trim().toUpperCase() });
    if (q.type) and.push({ type: q.type as 'deposit' });
    if (q.user) and.push({ ledgerEntries: { some: { account: { ownerUser: { publicId: q.user } } } } });
    if (q.kind) and.push({ ledgerEntries: { some: { account: { kind: q.kind as 'treasury' } } } });
    if (q.job) and.push({ job: { publicId: q.job } });
    const { from, to } = dateRange(q);
    if (from || to) and.push({ occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } });
    if (and.length) where.AND = and;
    if (bool(q.aggregate)) {
      const rows = await this.db.$queryRaw<{ day: string; type: string; count: bigint; total: Prisma.Decimal }[]>`
        SELECT to_char(t.occurred_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day, t.type::text AS type, count(DISTINCT t.id) AS count,
               COALESCE(sum(e.amount) FILTER (WHERE e.amount > 0), 0) AS total
        FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
        WHERE t.occurred_at >= ${from ?? new Date(Date.now() - 30 * 86_400_000)} AND t.occurred_at < ${to ?? new Date(Date.now() + 86_400_000)}
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
      return paged(rows.map((r) => ({ day: r.day, type: r.type, count: Number(r.count), total_exact: m6(r.total) })), rows.length, { page: 1, perPage: Math.max(rows.length, 1) }, { aggregate: true });
    }
    const masked = !ctx.hasAny('ledger.adjust', 'users.read') || ctx.roles.every((r) => r === 'moderator' || r === 'support_agent');
    const [rows, total] = await Promise.all([
      this.db.ledgerTransaction.findMany({ where, orderBy: { seq: 'desc' }, skip: p.skip, take: p.take, include: { job: { select: { publicId: true } }, submission: { select: { publicRef: true } }, ledgerEntries: { include: { account: { select: { kind: true, systemCode: true, ownerUser: { select: { publicId: true } } } } } } } }),
      this.db.ledgerTransaction.count({ where }),
    ]);
    return paged(
      rows.map((t) => ({
        ref: t.publicRef,
        type: t.type,
        occurred_at: iso(t.occurredAt),
        job_public_id: t.job?.publicId ?? null,
        submission_ref: t.submission?.publicRef ?? null,
        created_by_actor: t.createdByActor,
        entries: t.ledgerEntries.map((e) => ({ account_kind: e.account.kind, system_code: e.account.systemCode, owner_public_id: e.account.ownerUser?.publicId ?? null, amount_exact: m6(e.amount), balance_after_exact: masked || e.balanceAfter === null ? null : m6(e.balanceAfter), display_type: e.displayType })),
      })),
      total,
      p,
      { masked },
    );
  }

  async detail(ref: string) {
    const t = await this.db.ledgerTransaction.findUnique({
      where: { publicRef: ref.toUpperCase() },
      include: { ledgerEntries: { include: { account: { select: { kind: true, systemCode: true, ownerUser: { select: { publicId: true } } } } } }, reversesTx: { select: { publicRef: true } }, job: { select: { publicId: true } }, submission: { select: { publicRef: true } }, deposit: { select: { publicRef: true } }, withdrawal: { select: { publicRef: true } }, dispute: { select: { publicRef: true } }, createdByAdmin: { select: { fullName: true } }, approvedByAdmin: { select: { fullName: true } } },
    });
    if (!t) throw new ApiError('NOT_FOUND', `We can't find ${ref}.`);
    return {
      ref: t.publicRef,
      type: t.type,
      occurred_at: iso(t.occurredAt),
      idempotency_key: t.idempotencyKey,
      description_params: t.descriptionParams,
      reason: t.reason,
      reason_code: t.reasonCode,
      reverses_ref: t.reversesTx?.publicRef ?? null,
      created_by_actor: t.createdByActor,
      created_by_admin: t.createdByAdmin?.fullName ?? null,
      approved_by_admin: t.approvedByAdmin?.fullName ?? null,
      links: { job: t.job?.publicId ?? null, submission: t.submission?.publicRef ?? null, deposit: t.deposit?.publicRef ?? null, withdrawal: t.withdrawal?.publicRef ?? null, dispute: t.dispute?.publicRef ?? null },
      entries: t.ledgerEntries.map((e) => ({ account_kind: e.account.kind, system_code: e.account.systemCode, owner_public_id: e.account.ownerUser?.publicId ?? null, amount_exact: m6(e.amount), balance_after_exact: e.balanceAfter === null ? null : m6(e.balanceAfter), display_type: e.displayType })),
    };
  }

  // ------------------------------------------------------------------ adjustments

  private async expireOld() {
    const old = await this.db.ledgerAdjustmentRequest.findMany({ where: { status: 'pending_approval', expiresAt: { lt: new Date() } }, select: { id: true } });
    for (const o of old) {
      await this.db.ledgerAdjustmentRequest.update({ where: { id: o.id }, data: { status: 'expired' } });
      await this.audit.safe(null, { action: 'ledger.adjust_expire', entityType: 'ledger_adjustment_request', entityId: o.id, actorType: 'system', after: { status: 'expired' } });
    }
  }

  async adjustments(ctx: AdminCtx, q: Q) {
    await this.expireOld();
    const p = paging(q);
    const where: Prisma.LedgerAdjustmentRequestWhereInput = {};
    if (q.view === 'mine') Object.assign(where, { status: 'pending_approval', createdByAdminId: ctx.id });
    else if (q.view === 'needs_me') Object.assign(where, { status: 'pending_approval', createdByAdminId: { not: ctx.id } });
    else if (q.status && q.status !== 'all') where.status = q.status;
    const [rows, total, pending] = await Promise.all([
      this.db.ledgerAdjustmentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { account: { include: { ownerUser: { select: { publicId: true } } } }, createdByAdmin: { select: { fullName: true } }, decidedByAdmin: { select: { fullName: true } }, ledgerTx: { select: { publicRef: true } } } }),
      this.db.ledgerAdjustmentRequest.count({ where }),
      this.db.ledgerAdjustmentRequest.count({ where: { status: 'pending_approval' } }),
    ]);
    return paged(
      rows.map((a) => ({
        id: a.id,
        account_kind: a.account.kind,
        owner_public_id: a.account.ownerUser?.publicId ?? null,
        amount_exact: m6(a.amount),
        current_balance_exact: m6(a.account.balanceCached),
        balance_after_exact: m6(dec(a.account.balanceCached).plus(dec(a.amount))),
        reason_code: a.reasonCode,
        internal_note: a.internalNote,
        visible_text: a.visibleText,
        status: a.status,
        created_by: a.createdByAdmin.fullName,
        created_by_me: a.createdByAdminId === ctx.id,
        decided_by: a.decidedByAdmin?.fullName ?? null,
        decision_note: a.decisionNote,
        ledger_ref: a.ledgerTx?.publicRef ?? null,
        created_at: iso(a.createdAt),
        expires_at: iso(a.expiresAt),
        approver_must_be_super_admin: dec(a.amount).abs().gt(500),
      })),
      total,
      p,
      { counts: { pending_approval: pending } },
    );
  }

  async propose(ctx: AdminCtx, b: Record<string, unknown>, res: Response) {
    const publicId = needText(b.user_public_id, 9, 'user_public_id', "We can't find that user.");
    const kind = needEnum(b.account_kind, USER_KINDS, 'account_kind');
    const amount = needMoney(b.amount, 'amount', 6, true);
    const reasonCode = needEnum(b.reason_code, ADJ_REASONS, 'reason_code');
    const note = needReason(b.internal_note, 1000, 'internal_note');
    const visible = needText(b.visible_text, 120, 'visible_text', 'Enter what the user sees.');
    const u = await this.db.user.findUnique({ where: { publicId } });
    if (!u) throw new ApiError('VALIDATION_FAILED', undefined, { user_public_id: ["We can't find that user."] });
    const acc = await this.ledger.userAccount(u.id, kind);
    const a = await this.db.$transaction(async (tx) => {
      const a = await tx.ledgerAdjustmentRequest.create({ data: { accountId: acc.id, amount: amount.toFixed(6), reasonCode, internalNote: note, visibleText: visible, evidenceUploadId: typeof b.evidence_upload_id === 'string' ? b.evidence_upload_id : null, createdByAdminId: ctx.id, expiresAt: new Date(Date.now() + 72 * 3600_000) } });
      await this.audit.record(ctx, { action: 'ledger.adjust_request', entityType: 'ledger_adjustment_request', entityId: a.id, entityRef: publicId, reason: note, after: { amount: amount.toFixed(6), account: kind, reason_code: reasonCode } }, tx);
      return a;
    });
    res.status(202);
    return { id: a.id, status: 'pending_approval', expires_at: iso(a.expiresAt), approver_must_be_super_admin: amount.abs().gt(500) };
  }

  async approve(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const note = typeof b.decision_note === 'string' && b.decision_note.trim() ? b.decision_note.trim().slice(0, 500) : null;
    const out = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ledger_adjustment_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.ledgerAdjustmentRequest.findUnique({ where: { id }, include: { account: { include: { ownerUser: { select: { id: true, publicId: true } } } } } });
      if (!a) throw new ApiError('NOT_FOUND');
      if (a.status !== 'pending_approval') throw new ApiError('ALREADY_DECIDED', 'This adjustment was already decided.');
      if (a.expiresAt < new Date()) throw new ApiError('ALREADY_DECIDED', 'This adjustment has expired.');
      if (a.createdByAdminId === ctx.id) throw new ApiError('SELF_APPROVAL_FORBIDDEN');
      if (dec(a.amount).abs().gt(500) && !ctx.isSuper) throw new ApiError('ADMIN_FORBIDDEN', 'Only a super admin can approve this.');
      const adj = await this.ledger.systemAccount('adjustments', tx);
      const amt = dec(a.amount);
      const t = await this.ledger.post({ type: 'adjustment', idempotencyKey: `adjustment:${a.id}`, actor: 'admin', adminId: a.createdByAdminId, reason: a.internalNote.slice(0, 300), reasonCode: a.reasonCode, description: { visible_text: a.visibleText, reason_code: a.reasonCode }, lines: [ { accountId: a.accountId, amount: amt.toFixed(6) }, { accountId: adj.id, amount: amt.neg().toFixed(6) } ] }, tx);
      await tx.ledgerAdjustmentRequest.update({ where: { id }, data: { status: 'approved', decidedByAdminId: ctx.id, decidedAt: new Date(), decisionNote: note, ledgerTxId: t.id } });
      const overturn = await tx.adminPendingAction.findFirst({ where: { objectType: 'ledger_adjustment', objectId: id, status: 'pending' } });
      if (overturn) {
        await this.work.completeOverturn(tx, ctx, overturn.payload as { submission_id: string; reason_code: string; reason: string });
        await tx.adminPendingAction.update({ where: { id: overturn.id }, data: { status: 'approved', decidedByAdminId: ctx.id, decidedAt: new Date() } });
      }
      const after = await tx.walletAccount.findUniqueOrThrow({ where: { id: a.accountId } });
      await this.audit.record(ctx, { action: 'ledger.adjust_approve', entityType: 'ledger_adjustment_request', entityId: id, entityRef: a.account.ownerUser?.publicId ?? null, reason: note, before: { balance: m6(dec(after.balanceCached).minus(amt)) }, after: { balance: m6(after.balanceCached), ledger_ref: t.publicRef } }, tx);
      return { a, t };
    });
    if (out.a.account.ownerUser) {
      const amt = dec(out.a.amount);
      await this.notify.user(out.a.account.ownerUser.id, { type: 'balance_adjusted', category: 'payments', title: `Balance adjusted · ${amt.isNeg() ? '−' : '+'}$${m2(amt.abs())}`, body: out.a.visibleText, audience: out.a.account.kind === 'worker_earnings' ? 'worker' : 'employer' });
    }
    return { id, status: 'approved', ledger_ref: out.t.publicRef };
  }

  async decline(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const note = needReason(b.decision_note, 500, 'decision_note');
    const a = await this.db.ledgerAdjustmentRequest.findUnique({ where: { id } });
    if (!a) throw new ApiError('NOT_FOUND');
    if (a.status !== 'pending_approval') throw new ApiError('ALREADY_DECIDED');
    if (a.createdByAdminId === ctx.id) throw new ApiError('SELF_APPROVAL_FORBIDDEN');
    await this.db.$transaction(async (tx) => {
      await tx.ledgerAdjustmentRequest.update({ where: { id }, data: { status: 'declined', decidedByAdminId: ctx.id, decidedAt: new Date(), decisionNote: note } });
      await tx.adminPendingAction.updateMany({ where: { objectType: 'ledger_adjustment', objectId: id, status: 'pending' }, data: { status: 'declined', decidedByAdminId: ctx.id, decidedAt: new Date(), decisionNote: note } });
      await this.audit.record(ctx, { action: 'ledger.adjust_decline', entityType: 'ledger_adjustment_request', entityId: id, reason: note, after: { status: 'declined' } }, tx);
    });
    return { id, status: 'declined' };
  }

  // ------------------------------------------------------------------ reconciliation

  async runs(q: Q) {
    const p = paging(q);
    const where: Prisma.ReconciliationRunWhereInput = {};
    if (q.job_name) where.jobName = q.job_name;
    if (q.status) where.status = q.status;
    const [rows, total] = await Promise.all([this.db.reconciliationRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: p.skip, take: p.take }), this.db.reconciliationRun.count({ where })]);
    return paged(rows.map((r) => ({ id: r.id, job_name: r.jobName, status: r.status, started_at: iso(r.startedAt), finished_at: iso(r.finishedAt), item_count: r.itemCount, summary: r.summary })), total, p);
  }

  async items(q: Q) {
    const p = paging(q);
    const where: Prisma.ReconciliationItemWhereInput = {};
    if (q.severity) where.severity = q.severity;
    if (q.check_code) where.checkCode = q.check_code;
    if (q.resolved !== undefined) where.resolvedAt = bool(q.resolved) ? { not: null } : null;
    const [rows, total, counts] = await Promise.all([
      this.db.reconciliationItem.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { resolvedByAdmin: { select: { fullName: true } } } }),
      this.db.reconciliationItem.count({ where }),
      this.db.reconciliationItem.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: { _all: true } }),
    ]);
    const c = (s: string) => counts.find((x) => x.severity === s)?._count._all ?? 0;
    return paged(
      rows.map((i) => ({ id: i.id, check_code: i.checkCode, severity: i.severity, entity_type: i.entityType, entity_ref: i.entityRef, detail: i.detail, created_at: iso(i.createdAt), resolved_at: iso(i.resolvedAt), resolved_by: i.resolvedByAdmin?.fullName ?? null, resolution_note: i.resolutionNote })),
      total,
      p,
      { counts: { critical: c('critical'), high: c('high'), medium: c('medium'), info: c('info') } },
    );
  }

  async resolveItem(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const note = needReason(b.resolution_note, 500, 'resolution_note');
    const i = await this.db.reconciliationItem.findUnique({ where: { id } });
    if (!i) throw new ApiError('NOT_FOUND');
    if (i.resolvedAt) throw new ApiError('ALREADY_DECIDED');
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.reconciliationItem.update({ where: { id }, data: { resolvedAt: now, resolvedByAdminId: ctx.id, resolutionNote: note } });
      await this.audit.record(ctx, { action: 'reconciliation.resolve', entityType: 'reconciliation_item', entityId: id, entityRef: i.entityRef, reason: note }, tx);
    });
    return { id, resolved_at: now.toISOString() };
  }

  /** Statement import (CSV text: provider_trx_id,direction,amount,currency,occurred_at,counterparty). Matches payouts by TrxID. */
  async importStatement(ctx: AdminCtx, b: Record<string, unknown>, res: Response) {
    const rail = needText(b.rail, 60, 'rail', 'Choose the account.');
    const text = typeof b.csv === 'string' ? b.csv : '';
    if (!text.trim()) throw new ApiError('UPLOAD_NOT_READY', 'Choose the statement file first.');
    const sha = createHash('sha256').update(text).digest();
    const rows = parseCsv(text);
    const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = (n: string) => head.indexOf(n);
    let lines = 0;
    let unmatched = 0;
    const run = await this.db.reconciliationRun.create({ data: { jobName: 'recon.payouts', status: 'running' } });
    for (const r of rows) {
      const trx = (r[col('provider_trx_id')] ?? '').trim();
      if (!trx) continue;
      try {
        await this.db.providerStatementLine.create({ data: { rail, providerTrxId: trx, direction: (r[col('direction')] ?? 'out').slice(0, 3), amount: new Decimal(r[col('amount')] || '0').toFixed(6), currency: (r[col('currency')] || 'BDT').slice(0, 10), counterparty: r[col('counterparty')] || null, occurredAt: new Date(r[col('occurred_at')] || Date.now()), importSha256: new Uint8Array(sha) } });
        lines++;
      } catch {
        continue; // already imported (pstl_line_uq)
      }
      const wd = await this.db.withdrawal.findFirst({ where: { providerTrxId: trx } });
      if (!wd) {
        unmatched++;
        await this.db.reconciliationItem.create({ data: { runId: run.id, checkCode: 'P2', severity: 'high', entityType: 'statement_line', entityRef: trx.slice(0, 40), detail: { rail, note: 'Statement line has no matching paid withdrawal' } } });
      }
    }
    await this.db.reconciliationRun.update({ where: { id: run.id }, data: { status: unmatched ? 'issues' : 'ok', finishedAt: new Date(), itemCount: unmatched, summary: { lines, unmatched } } });
    await this.audit.record(ctx, { action: 'reconciliation.import_statement', entityType: 'import', after: { rail, lines, import_sha256: sha.toString('hex') } });
    res.status(202);
    return { rail, status: 'processed', lines, unmatched };
  }

  async importSettlement(ctx: AdminCtx, b: Record<string, unknown>, res: Response) {
    const provider = needText(b.provider, 40, 'provider', 'Choose the provider.');
    const text = typeof b.csv === 'string' ? b.csv : '';
    if (!text.trim()) throw new ApiError('UPLOAD_NOT_READY', 'Choose the settlement file first.');
    const sha = createHash('sha256').update(text).digest();
    const rows = parseCsv(text);
    const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = (n: string) => head.indexOf(n);
    const settlementId = (await this.db.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
    const run = await this.db.reconciliationRun.create({ data: { jobName: 'recon.settlement', status: 'running' } });
    let lines = 0;
    let unmatched = 0;
    for (const r of rows) {
      const pid = (r[col('provider_payment_id')] ?? '').trim();
      if (!pid) continue;
      const dep = await this.db.deposit.findFirst({ where: { provider, providerPaymentId: pid } });
      try {
        const gross = new Decimal(r[col('gross_amount')] || '0');
        const fee = new Decimal(r[col('fee_amount')] || '0');
        await this.db.providerSettlementLine.create({ data: { settlementId, provider, providerPaymentId: pid, grossAmount: gross.toFixed(6), feeAmount: fee.toFixed(6), netAmount: gross.minus(fee).toFixed(6), currency: (r[col('currency')] || 'USD').slice(0, 10), settledOn: new Date(r[col('settled_on')] || Date.now()), depositId: dep?.id ?? null, matchStatus: dep ? 'matched' : 'unmatched' } });
        lines++;
      } catch {
        continue;
      }
      if (!dep) {
        unmatched++;
        await this.db.reconciliationItem.create({ data: { runId: run.id, checkCode: 'C4', severity: 'high', entityType: 'settlement_line', entityRef: pid.slice(0, 40), detail: { provider, note: 'Settlement line has no matching deposit' } } });
      }
    }
    await this.db.reconciliationRun.update({ where: { id: run.id }, data: { status: unmatched ? 'issues' : 'ok', finishedAt: new Date(), itemCount: unmatched, summary: { lines, unmatched } } });
    await this.audit.record(ctx, { action: 'reconciliation.import_settlement', entityType: 'import', after: { provider, lines, import_sha256: sha.toString('hex') } });
    res.status(202);
    return { settlement_id: settlementId, status: 'processed', lines, unmatched };
  }

  // ------------------------------------------------------------------ referrals

  private signals(r: { riskFlags: string[] }) {
    const f = new Set(r.riskFlags);
    return { same_device: f.has('same_device'), same_payout_account: f.has('same_payout_account'), same_kyc_document: f.has('same_kyc_document'), same_ip_subnet: f.has('same_ip_subnet'), same_phone_history: f.has('same_phone_history'), referrer_jobs: f.has('referrer_jobs'), signup_burst: f.has('signup_burst') };
  }

  private hardBlock(r: { riskFlags: string[] }) {
    return r.riskFlags.find((f) => ['same_payout_account', 'same_kyc_document', 'same_user', 'same_contact'].includes(f)) ?? null;
  }

  async referrals(ctx: AdminCtx, q: Q) {
    if (!ctx.has('referrals.read')) {
      const [byStatus, comm, deps] = await Promise.all([
        this.db.referral.groupBy({ by: ['status'], _count: { _all: true } }),
        this.db.referralCommission.groupBy({ by: ['status'], _sum: { amount: true } }),
        this.db.deposit.aggregate({ where: { status: { in: ['completed', 'refunded'] } }, _sum: { creditedAmountUsd: true } }),
      ]);
      const credited = dec(comm.find((c) => c.status === 'credited')?._sum.amount);
      const base = dec(deps._sum.creditedAmountUsd);
      return { aggregate: true, by_status: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), commissions: Object.fromEntries(comm.map((c) => [c.status, m6(c._sum.amount)])), percent_of_deposits: base.gt(0) ? credited.div(base).mul(100).toFixed(2) : '0.00' };
    }
    const p = paging(q);
    const where: Prisma.ReferralWhereInput = {};
    if (q.status) where.status = q.status as 'active';
    if (bool(q.flagged)) where.riskScore = { gte: 30 };
    if (q.referrer) where.referrerUser = { publicId: q.referrer };
    const orderBy: Prisma.ReferralOrderByWithRelationInput = bool(q.flagged) ? { riskScore: 'desc' } : { createdAt: 'desc' };
    const [rows, total, flagged] = await Promise.all([
      this.db.referral.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { referrerUser: { select: { publicId: true } }, referredUser: { select: { publicId: true } }, referralCommissions: { select: { amount: true, status: true } } } }),
      this.db.referral.count({ where }),
      this.db.referral.count({ where: { riskScore: { gte: 30 } } }),
    ]);
    return paged(
      rows.map((r) => ({ id: r.id, referrer_public_id: r.referrerUser.publicId, referred_public_id: r.referredUser.publicId, code_used: r.codeUsed, status: r.status, ineligible_reason: r.ineligibleReason, risk_flags: r.riskFlags, risk_score: r.riskScore ?? 0, commission_total_usd: m2(r.referralCommissions.filter((c) => c.status === 'credited').reduce((a, c) => a.plus(dec(c.amount)), new Decimal(0))), created_at: iso(r.createdAt) })),
      total,
      p,
      { counts: { flagged } },
    );
  }

  async referral(id: string) {
    const r = await this.db.referral.findUnique({ where: { id }, include: { referrerUser: { select: { publicId: true } }, referredUser: { select: { publicId: true, fullName: true } }, referralCommissions: { orderBy: { createdAt: 'desc' }, include: { submission: { select: { publicRef: true } }, deposit: { select: { publicRef: true } } } } } });
    if (!r) throw new ApiError('NOT_FOUND');
    return {
      id: r.id,
      status: r.status,
      referrer_public_id: r.referrerUser.publicId,
      referred_public_id: r.referredUser.publicId,
      referred_name_masked: maskName(r.referredUser.fullName),
      code_used: r.codeUsed,
      ineligible_reason: r.ineligibleReason,
      risk_score: r.riskScore ?? 0,
      risk_flags: r.riskFlags,
      signals: this.signals(r),
      hard_block: this.hardBlock(r),
      thresholds: { block: 60, flag: 30 },
      commissions: r.referralCommissions.map((c) => ({ id: c.id, source_type: c.sourceType, submission_ref: c.submission?.publicRef ?? null, deposit_ref: c.deposit?.publicRef ?? null, base_amount_exact: m6(c.baseAmount), rate: dec(c.rate).toFixed(6), amount_exact: m6(c.amount), status: c.status, credited_at: iso(c.creditedAt) })),
    };
  }

  private async reverseCommission(tx: Prisma.TransactionClient, ctx: AdminCtx, cId: string, reason: string) {
    const c = await tx.referralCommission.findUniqueOrThrow({ where: { id: cId } });
    if (c.status !== 'credited') throw new ApiError('INVALID_STATE', 'Only credited commissions can be reversed.');
    const acc = await this.ledger.userAccount(c.referrerUserId, 'worker_earnings', tx);
    const exp = await this.ledger.systemAccount('referral_expense', tx);
    const t = await this.ledger.post({ type: 'adjustment', idempotencyKey: `referral:${c.id}:reverse`, actor: 'admin', adminId: ctx.id, reason: reason.slice(0, 300), reasonCode: 'referral_reversal', description: { visible_text: 'Referral reversed', display_status: 'Deducted' }, refs: { referralCommissionId: c.id }, lines: [ { accountId: acc.id, amount: dec(c.amount).neg().toFixed(6) }, { accountId: exp.id, amount: dec(c.amount).toFixed(6) } ] }, tx);
    await tx.referralCommission.update({ where: { id: c.id }, data: { status: 'reversed', reversedAt: new Date(), reversalLedgerTxId: t.id, statusReason: reason.slice(0, 200) } });
    return t;
  }

  async markIneligible(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const rev = b.reverse_credited === true;
    if (rev && !ctx.has('referrals.reverse')) throw new ApiError('ADMIN_FORBIDDEN');
    const r = await this.db.referral.findUnique({ where: { id }, include: { referralCommissions: true } });
    if (!r) throw new ApiError('NOT_FOUND');
    if (r.status === 'ineligible') throw new ApiError('INVALID_STATE', 'This referral is already not eligible.');
    const n = await this.db.$transaction(async (tx) => {
      await tx.referral.update({ where: { id }, data: { status: 'ineligible', ineligibleReason: 'admin_review' } });
      await tx.referralCommission.updateMany({ where: { referralId: id, status: 'pending' }, data: { status: 'ineligible', statusReason: reason.slice(0, 200) } });
      let n = 0;
      if (rev) for (const c of r.referralCommissions.filter((x) => x.status === 'credited')) {
        await this.reverseCommission(tx, ctx, c.id, reason);
        n++;
      }
      await this.audit.record(ctx, { action: 'referral.review', entityType: 'referral', entityId: id, reason, before: { status: r.status }, after: { status: 'ineligible', commissions_reversed: n } }, tx);
      return n;
    });
    return { id, status: 'ineligible', commissions_reversed: n };
  }

  async clear(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const r = await this.db.referral.findUnique({ where: { id } });
    if (!r) throw new ApiError('NOT_FOUND');
    if (this.hardBlock(r)) throw new ApiError('INVALID_STATE', `Blocked by a hard rule: ${this.hardBlock(r)!.replace(/_/g, ' ')}.`);
    if (!r.riskFlags.length && !(r.riskScore ?? 0)) throw new ApiError('INVALID_STATE', 'This referral has no flag.');
    await this.db.$transaction(async (tx) => {
      await tx.referral.update({ where: { id }, data: { riskFlags: [], riskScore: 0, status: r.status === 'ineligible' ? 'not_started' : r.status, ineligibleReason: null } });
      await this.audit.record(ctx, { action: 'referral.clear', entityType: 'referral', entityId: id, reason, before: { risk_flags: r.riskFlags, risk_score: r.riskScore }, after: { risk_flags: [], risk_score: 0 } }, tx);
    });
    return { id, risk_score: 0, risk_flags: [], status: r.status === 'ineligible' ? 'not_started' : r.status };
  }

  async reverse(ctx: AdminCtx, cId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const t = await this.db.$transaction(async (tx) => {
      const t = await this.reverseCommission(tx, ctx, cId, reason);
      await this.audit.record(ctx, { action: 'referral.reverse', entityType: 'referral_commission', entityId: cId, reason, after: { status: 'reversed', ledger_ref: t.publicRef } }, tx);
      return t;
    });
    return { id: cId, status: 'reversed', ledger_ref: t.publicRef };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminLedgerController {
  constructor(private readonly svc: AdminLedgerService) {}

  @Get('ledger')
  @Perms('ledger.read', 'ledger.read_aggregate')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('ledger/adjustments')
  @Perms('ledger.adjust', 'ledger.approve')
  adjustments(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.adjustments(ctx, q);
  }

  @Post('ledger/adjustments')
  @HttpCode(202)
  @Perms('ledger.adjust')
  @Reauth()
  propose(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.propose(ctx, b ?? {}, res);
  }

  @Post('ledger/adjustments/:id/approve')
  @HttpCode(200)
  @Perms('ledger.approve')
  @Reauth()
  approve(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.approve(ctx, id, b ?? {});
  }

  @Post('ledger/adjustments/:id/decline')
  @HttpCode(200)
  @Perms('ledger.approve')
  @Reauth()
  decline(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.decline(ctx, id, b ?? {});
  }

  @Get('ledger/:ref')
  @Perms('ledger.read')
  detail(@Param('ref') ref: string) {
    return this.svc.detail(ref);
  }

  @Get('reconciliation/runs')
  @Perms('recon.read')
  runs(@Query() q: Q) {
    return this.svc.runs(q);
  }

  @Get('reconciliation/items')
  @Perms('recon.read')
  items(@Query() q: Q) {
    return this.svc.items(q);
  }

  @Post('reconciliation/items/:id/resolve')
  @HttpCode(200)
  @Perms('recon.write')
  resolve(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.resolveItem(ctx, id, b ?? {});
  }

  @Post('reconciliation/statements')
  @Perms('recon.write')
  @Reauth()
  statements(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.svc.importStatement(ctx, b ?? {}, res);
  }

  @Post('reconciliation/settlements')
  @Perms('recon.write')
  @Reauth()
  settlements(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    return this.svc.importSettlement(ctx, b ?? {}, res);
  }

  @Get('referrals')
  @Perms('referrals.read', 'referrals.read_aggregate')
  referrals(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.referrals(ctx, q);
  }

  @Get('referrals/:id')
  @Perms('referrals.read')
  referral(@Param('id') id: string) {
    return this.svc.referral(id);
  }

  @Post('referrals/:id/mark-ineligible')
  @HttpCode(200)
  @Perms('referrals.review')
  markIneligible(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.markIneligible(ctx, id, b ?? {});
  }

  @Post('referrals/:id/clear')
  @HttpCode(200)
  @Perms('referrals.review')
  clear(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.clear(ctx, id, b ?? {});
  }

  @Post('referrals/commissions/:id/reverse')
  @HttpCode(200)
  @Perms('referrals.reverse')
  @Reauth()
  reverse(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>, @Headers('idempotency-key') k?: string) {
    idemKey(k);
    return this.svc.reverse(ctx, id, b ?? {});
  }
}
