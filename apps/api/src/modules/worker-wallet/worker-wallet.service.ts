import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Prisma } from '@24f/db';
import { formatBdt, formatSigned, type PayoutMethodType, type WithdrawalStatus } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { LedgerService } from '../ledger/ledger.service';
import { FxService } from '../fx/fx.service';
import { PayoutMethodsService } from '../payout-methods/payout-methods.service';
import { METHOD_SHORT } from '../payout-methods/payout-account';

const D = (v: Prisma.Decimal | Decimal.Value | null | undefined) => new Decimal((v ?? 0).toString());
const m2 = (v: Prisma.Decimal | Decimal.Value | null | undefined) => D(v).toFixed(2, Decimal.ROUND_DOWN);
const OFFSET = 6 * 3_600_000;
const dhakaDate = (d: Date) => new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type LedgerFilterType = 'all' | 'task_reward' | 'referral_commission' | 'withdrawal' | 'withdrawal_reversal' | 'adjustment';
export type LedgerRange = 'last_7_days' | 'last_30_days' | 'last_90_days' | 'this_month' | 'this_year' | 'all' | 'custom';

export interface WalletTxRow {
  ref: string;
  occurred_at: string;
  type: 'task_reward' | 'referral_commission' | 'withdrawal' | 'withdrawal_reversal' | 'adjustment';
  type_label: string;
  detail: string;
  amount_usd: string;
  amount_exact: string;
  amount_label: string;
  amount_style: 'credit' | 'debit';
  balance_after_usd: string | null;
  display_status: 'Added' | 'Processing' | 'Paid' | 'Refunded' | 'Cancelled' | 'Deducted';
  status_tone: 'success' | 'info' | 'danger' | 'neutral';
  withdrawal_ref: string | null;
  link_path: string | null;
}

/** Monday of the ISO week (Dhaka calendar) as YYYY-MM-DD. */
function isoWeekStart(d: Date): string {
  const local = new Date(d.getTime() + OFFSET);
  const day = (local.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day)).toISOString().slice(0, 10);
}

function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Worker wallet (Doc 06 §5.11, Doc 08 §3.2, §4.3, §4.5). */
@Injectable()
export class WorkerWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly methods: PayoutMethodsService,
  ) {}

  /**
   * Builds display rows from the worker_earnings ledger. `collapse` folds each withdrawal
   * reversal into its withdrawal row (Recent transactions, C-01); the full ledger keeps both.
   */
  private async displayRows(userId: string, opts: { from?: Date; to?: Date; collapse: boolean }): Promise<WalletTxRow[]> {
    const acc = await this.ledger.userAccount(userId, 'worker_earnings');
    const entries = await this.prisma.db.ledgerEntry.findMany({
      where: { accountId: acc.id, ...(opts.from || opts.to ? { transaction: { occurredAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } } : {}) },
      include: { transaction: true },
      orderBy: [{ transaction: { occurredAt: 'desc' } }, { txSeq: 'desc' }],
      take: 5000,
    });
    const wdIds = [...new Set(entries.map((e) => e.transaction.withdrawalId).filter((x): x is string => !!x))];
    const wds = wdIds.length ? await this.prisma.db.withdrawal.findMany({ where: { id: { in: wdIds } }, select: { id: true, publicRef: true, status: true, method: true, destinationMasked: true } }) : [];
    const wdMap = new Map(wds.map((w) => [w.id, w]));

    const rows: WalletTxRow[] = [];
    const refGroups = new Map<string, WalletTxRow & { _sum: Decimal }>();
    const thisWeek = isoWeekStart(new Date());
    for (const e of entries) {
      const t = e.transaction;
      const p = (t.descriptionParams ?? {}) as Record<string, string>;
      const amt = D(e.amount);
      const at = t.occurredAt.toISOString();
      const bal = e.balanceAfter ? m2(e.balanceAfter) : null;
      const base = { ref: t.publicRef ?? t.id.slice(0, 8), occurred_at: at, amount_exact: amt.toFixed(6), balance_after_usd: bal, withdrawal_ref: null as string | null, link_path: null as string | null };
      const credit = amt.gte(0);

      if (e.displayType === 'task_reward' || t.type === 'task_reward') {
        rows.push({
          ...base,
          type: 'task_reward',
          type_label: 'Task reward',
          detail: [p.title, p.employer].filter(Boolean).join(' · ') || 'Task reward',
          amount_usd: amt.toFixed(3, Decimal.ROUND_DOWN),
          amount_label: formatSigned(amt.toFixed(6), 'reward'),
          amount_style: credit ? 'credit' : 'debit',
          display_status: 'Added',
          status_tone: 'success',
        });
        continue;
      }
      if (t.type === 'referral_commission') {
        const friend = p.friend ?? 'a friend';
        if (p.source === 'deposit') {
          rows.push({ ...base, type: 'referral_commission', type_label: 'Referral', detail: `5% of ${friend}’s deposit`, amount_usd: m2(amt), amount_label: formatSigned(amt.toFixed(6)), amount_style: 'credit', display_status: 'Added', status_tone: 'success', link_path: '/worker/referral' });
          continue;
        }
        // Task commissions group per (friend, ISO week) (BR-WLD-02).
        const wk = isoWeekStart(t.occurredAt);
        const key = `${friend}|${wk}`;
        const g = refGroups.get(key);
        if (g) {
          g._sum = g._sum.plus(amt);
          continue;
        }
        const wkDate = new Date(`${wk}T00:00:00Z`);
        const row = {
          ...base,
          type: 'referral_commission' as const,
          type_label: 'Referral',
          detail: wk === thisWeek ? `5% of ${friend}’s tasks this week` : `5% of ${friend}’s tasks · week of ${MONTHS[wkDate.getUTCMonth()]} ${wkDate.getUTCDate()}`,
          amount_usd: '',
          amount_label: '',
          amount_style: 'credit' as const,
          display_status: 'Added' as const,
          status_tone: 'success' as const,
          link_path: '/worker/referral',
          _sum: amt,
        };
        refGroups.set(key, row);
        rows.push(row);
        continue;
      }
      if (t.type === 'withdrawal' || t.type === 'withdrawal_reversal') {
        const w = t.withdrawalId ? wdMap.get(t.withdrawalId) : undefined;
        const method = (w?.method ?? p.method ?? 'bkash') as PayoutMethodType;
        const masked = w?.destinationMasked ?? p.masked ?? '';
        const dest = method === 'usdt_trc20' ? `USDT TRC20 · ${masked}` : `${METHOD_SHORT[method]} ••${masked.slice(-3)}`;
        const wdRef = w?.publicRef ?? p.wd_ref ?? null;
        const link = wdRef ? `/worker/wallet/withdrawals?ref=${wdRef}` : null;
        if (t.type === 'withdrawal_reversal') {
          if (opts.collapse) continue;
          rows.push({ ...base, type: 'withdrawal_reversal', type_label: 'Refunded', detail: `Withdrawal ${wdRef ?? ''} returned`.replace('  ', ' '), amount_usd: m2(amt), amount_label: formatSigned(amt.toFixed(6)), amount_style: 'credit', display_status: 'Added', status_tone: 'success', withdrawal_ref: wdRef, link_path: link });
          continue;
        }
        const st = (w?.status ?? 'processing') as WithdrawalStatus;
        const [label, tone]: [WalletTxRow['display_status'], WalletTxRow['status_tone']] =
          st === 'paid' ? ['Paid', 'success'] : st === 'requested' || st === 'processing' ? ['Processing', 'info'] : st === 'cancelled' ? ['Cancelled', 'neutral'] : ['Refunded', 'danger'];
        rows.push({ ...base, type: 'withdrawal', type_label: 'Withdrawal', detail: dest, amount_usd: m2(amt), amount_label: formatSigned(amt.toFixed(6)), amount_style: 'debit', display_status: label, status_tone: tone, withdrawal_ref: wdRef, link_path: link });
        continue;
      }
      // Adjustments (incl. referral reversals) and anything else.
      rows.push({
        ...base,
        type: 'adjustment',
        type_label: 'Adjustment',
        detail: p.label ?? p.visible_text ?? t.reason ?? (t.reasonCode === 'referral_reversal' ? `Referral reversed · ${p.friend ?? ''}` : 'Balance adjustment'),
        amount_usd: m2(amt),
        amount_label: formatSigned(amt.toFixed(6)),
        amount_style: credit ? 'credit' : 'debit',
        display_status: credit ? 'Added' : 'Deducted',
        status_tone: credit ? 'success' : 'neutral',
      });
    }
    for (const g of refGroups.values()) {
      g.amount_usd = g._sum.toFixed(2, Decimal.ROUND_DOWN);
      g.amount_exact = g._sum.toFixed(6);
      g.amount_label = formatSigned(g._sum.toFixed(6));
      delete (g as Partial<typeof g>)._sum;
    }
    return rows;
  }

  /** GET /worker/wallet. */
  async summary(userId: string) {
    const [available, pending, inFlight, latest, methods, configs, user, rows] = await Promise.all([
      this.ledger.balance(userId, 'worker_earnings'),
      this.prisma.db.submission.aggregate({ where: { workerUserId: userId, status: 'in_review' }, _sum: { rewardUsd: true }, _count: { _all: true } }),
      this.prisma.db.withdrawal.aggregate({ where: { userId, status: { in: ['requested', 'processing'] } }, _sum: { amountUsd: true }, _count: { _all: true } }),
      this.prisma.db.withdrawal.findMany({ where: { userId, status: { in: ['requested', 'processing'] } }, orderBy: { requestedAt: 'asc' }, select: { requestedAt: true, status: true } }),
      this.methods.listRows(userId),
      this.methods.configs(),
      this.prisma.db.user.findUnique({ where: { id: userId }, select: { kycStatus: true, status: true } }),
      this.displayRows(userId, { collapse: true }),
    ]);
    const def = methods.find((m) => m.isDefault);
    const currency = def && def.methodType !== 'usdt_trc20' ? def.methodTypeRef.payoutCurrency.trim() : 'BDT';
    const rate = await this.fx.current(currency);
    const enabled = configs.filter((c) => c.enabled);
    const minAll = enabled.length ? enabled.map((c) => new Decimal(c.min_usd)).reduce((a, b) => Decimal.min(a, b)) : null;
    return {
      available_usd: m2(available),
      available_bdt_estimate: rate && !rate.stale ? available.times(rate.rate).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0) : null,
      available_bdt_label: rate && !rate.stale ? formatBdt(available.times(rate.rate).toFixed(2), { estimate: true }) : null,
      fx_rate_label: rate ? FxService.label(currency, rate.rate) : null,
      pending_review_usd: m2(pending._sum.rewardUsd),
      pending_review_tasks: pending._count._all,
      in_flight_usd: m2(inFlight._sum.amountUsd),
      in_flight_count: inFlight._count._all,
      in_flight_latest: latest.length ? { requested_at: latest[latest.length - 1]!.requestedAt.toISOString(), status: latest[latest.length - 1]!.status, oldest_requested_at: latest[0]!.requestedAt.toISOString() } : null,
      min_withdrawal_usd: minAll ? minAll.toFixed(2) : null,
      can_withdraw: !!minAll && available.gte(minAll) && user?.status === 'active',
      kyc_status: user?.kycStatus ?? 'not_submitted',
      payout_methods: methods.map((m) => this.methods.dto(m)),
      recent_transactions: rows.slice(0, 6),
    };
  }

  /** GET /worker/wallet/earnings-chart: 14 Dhaka days of task rewards (commissions excluded). */
  async chart(userId: string) {
    const acc = await this.ledger.userAccount(userId, 'worker_earnings');
    const local = new Date(Date.now() + OFFSET);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 13) - OFFSET);
    const entries = await this.prisma.db.ledgerEntry.findMany({ where: { accountId: acc.id, displayType: 'task_reward', transaction: { occurredAt: { gte: start } } }, include: { transaction: { select: { occurredAt: true } } } });
    const today = dhakaDate(new Date());
    const bars = Array.from({ length: 14 }, (_, i) => {
      const d = dhakaDate(new Date(start.getTime() + OFFSET + i * 86_400_000 - OFFSET + 1));
      return { date: d, amount: new Decimal(0), tasks: 0, is_today: d === today };
    });
    for (const e of entries) {
      const d = dhakaDate(e.transaction.occurredAt);
      const b = bars.find((x) => x.date === d);
      if (!b) continue;
      b.amount = b.amount.plus(D(e.amount));
      b.tasks += D(e.amount).gt(0) ? 1 : 0;
    }
    const total = bars.reduce((s, b) => s.plus(b.amount), new Decimal(0));
    return {
      total_usd: total.toFixed(2, Decimal.ROUND_DOWN),
      total_tasks: bars.reduce((s, b) => s + b.tasks, 0),
      bars: bars.map((b) => ({ date: b.date, amount_usd: b.amount.toFixed(2, Decimal.ROUND_DOWN), tasks: b.tasks, is_today: b.is_today })),
    };
  }

  private bounds(range: LedgerRange, from?: string, to?: string) {
    const local = new Date(Date.now() + OFFSET);
    const dayStart = (daysAgo: number) => new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysAgo) - OFFSET);
    switch (range) {
      case 'last_7_days':
        return { from: dayStart(6) };
      case 'last_30_days':
        return { from: dayStart(29) };
      case 'last_90_days':
        return { from: dayStart(89) };
      case 'this_month':
        return { from: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET) };
      case 'this_year':
        return { from: new Date(Date.UTC(local.getUTCFullYear(), 0, 1) - OFFSET) };
      case 'custom': {
        if (!from || !to) throw new ApiError('VALIDATION_FAILED', undefined, { from: ['Choose a start and end date.'] });
        const f = new Date(Date.parse(`${from}T00:00:00Z`) - OFFSET);
        const t = new Date(Date.parse(`${to}T00:00:00Z`) - OFFSET + 86_400_000);
        if (t <= f) throw new ApiError('VALIDATION_FAILED', undefined, { to: ['The end date must be after the start date.'] });
        if (t.getTime() - f.getTime() > 367 * 86_400_000) throw new ApiError('EXPORT_TOO_LARGE', 'Choose a date range of up to 1 year.');
        return { from: f, to: t };
      }
      default:
        return {};
    }
  }

  private async filtered(userId: string, q: { type: LedgerFilterType; range: LedgerRange; from?: string; to?: string; q?: string }) {
    const b = this.bounds(q.range, q.from, q.to);
    let rows = await this.displayRows(userId, { ...b, collapse: false });
    if (q.type !== 'all') rows = rows.filter((r) => r.type === q.type);
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) => r.detail.toLowerCase().includes(needle) || r.ref.toLowerCase().includes(needle) || (r.withdrawal_ref ?? '').toLowerCase().includes(needle));
    }
    return rows;
  }

  /** GET /worker/wallet/transactions (SCR-WAL-ND1). */
  async transactions(userId: string, q: { type: LedgerFilterType; range: LedgerRange; from?: string; to?: string; q?: string; page: number; per_page: number }) {
    const rows = await this.filtered(userId, q);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    const credits = rows.filter((r) => r.type !== 'withdrawal' && D(r.amount_exact).gt(0)).reduce((s, r) => s.plus(D(r.amount_exact)), new Decimal(0));
    const debits = rows.filter((r) => r.type === 'withdrawal').reduce((s, r) => s.plus(D(r.amount_exact).abs()), new Decimal(0));
    return {
      data: rows.slice((q.page - 1) * q.per_page, q.page * q.per_page),
      meta: { total, page: q.page, per_page: q.per_page, total_pages: totalPages, has_more: q.page < totalPages, summary: { credited_usd: credits.toFixed(2, Decimal.ROUND_DOWN), withdrawn_usd: debits.toFixed(2, Decimal.ROUND_DOWN) } },
    };
  }

  /** `format=csv` (Doc 08 §15.5): same filters, all rows, formula-safe cells. */
  async csv(userId: string, q: { type: LedgerFilterType; range: LedgerRange; from?: string; to?: string; q?: string }) {
    const rows = await this.filtered(userId, q);
    if (rows.length > 50_000) throw new ApiError('EXPORT_TOO_LARGE');
    const lines = ['date_utc,date_dhaka,type,detail,amount_usd,balance_usd,status,reference,withdrawal_ref'];
    for (const r of rows) {
      const d = new Date(r.occurred_at);
      const dh = new Date(d.getTime() + OFFSET).toISOString().replace('T', ' ').slice(0, 16);
      lines.push([r.occurred_at, dh, r.type, csvCell(r.detail), r.amount_exact, r.balance_after_usd ?? '', r.display_status, r.ref, r.withdrawal_ref ?? ''].join(','));
    }
    return { filename: `24freelancing-wallet-${dhakaDate(new Date()).replace(/-/g, '')}.csv`, body: `${lines.join('\n')}\n` };
  }
}
