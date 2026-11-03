import { Injectable } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { ApiError } from '../../common/api-error';
import { Paged } from '../../common/envelope.interceptor';
import { SettingsService } from '../settings/settings.service';
import { EmployerCore, dec, dhakaDate, dhakaMonthStart, shortTitle, usd2 } from '../employer/employer-common';
import { EmployerService } from '../employer/employer.service';

export const METHOD_LABEL: Record<string, string> = { crypto: 'Crypto', mobile_wallet: 'Mobile wallet', card: 'Card' };
const METHOD_SUB: Record<string, string> = { crypto: 'USDT · BTC · others', mobile_wallet: 'bKash · Nagad', card: 'Visa · Mastercard' };
const TYPE_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  job_reserve: 'Reserve',
  job_spend: 'Job spend',
  task_reward: 'Job spend',
  job_release: 'Refund',
  platform_fee: 'Platform fee',
  deposit_refund: 'Deposit refund',
  adjustment: 'Adjustment',
};

interface TxRow {
  id: string;
  public_ref: string;
  seq: bigint;
  type: string;
  occurred_at: Date;
  job_id: string | null;
  job_public_id: string | null;
  job_title: string | null;
  description_params: Record<string, unknown>;
  net_available: Prisma.Decimal | null;
  net_reserved: Prisma.Decimal | null;
  deposit_ref: string | null;
  deposit_method: string | null;
}

export interface StatementRow {
  ref: string;
  occurred_at: string;
  type: string;
  type_label: string;
  description: string;
  amount_usd: string;
  amount_label: string;
  amount_style: 'credit' | 'debit' | 'neutral';
  balance_usd: string;
  balance_exact: string;
  amount_exact: string;
  job_public_id: string | null;
  grouped_count: number;
  grouped_refs: string[];
}

export interface StatementQuery {
  type: string;
  range: string;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  per_page: number;
}

/** Employer wallet summary and statement (Doc 06 §5.13, Doc 08 §3.4, §3.6, §4.4 D-26). */
@Injectable()
export class EmployerWalletService {
  constructor(
    private readonly core: EmployerCore,
    private readonly settings: SettingsService,
    private readonly employer: EmployerService,
  ) {}

  private get db() {
    return this.core.db;
  }

  async depositRate() {
    const r = await this.db.exchangeRate.findFirst({
      where: { quoteCurrency: 'BDT', direction: 'deposit', effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return r ? dec(r.rate) : null;
  }

  async addFundsContext(userId: string) {
    const enabled = await this.settings.get<string[]>('deposit_methods_enabled', ['mobile_wallet', 'card']);
    const rate = await this.depositRate();
    const presets = (await this.settings.get<(number | string)[]>('deposit_presets_usd', [10, 25, 50, 100])).map((p) => new Decimal(p).toFixed(2));
    const min = new Decimal(String(await this.settings.get('deposit_min_usd', '10.00')));
    const max = new Decimal(String(await this.settings.get('deposit_max_usd', '1000.00')));
    const daily = new Decimal(String(await this.settings.get('deposit_daily_max_usd', '3000.00')));
    const since = new Date(Date.now() - 86_400_000);
    const used = await this.db.deposit.aggregate({
      where: { employerUserId: userId, initiatedAt: { gte: since }, status: { in: ['initiated', 'pending', 'completed'] } },
      _sum: { amountUsd: true },
    });
    const last = await this.db.deposit.findFirst({ where: { employerUserId: userId, status: 'completed' }, orderBy: { completedAt: 'desc' }, select: { method: true } });
    const order = ['crypto', 'mobile_wallet', 'card'].filter((m) => enabled.includes(m));
    const defaultMethod = last && enabled.includes(last.method) ? last.method : enabled.includes('crypto') ? 'crypto' : (order[0] ?? null);
    return {
      methods: order.map((m) => ({
        method: m,
        label: METHOD_LABEL[m],
        sublabel: METHOD_SUB[m],
        sub_providers: m === 'mobile_wallet' ? ['bkash', 'nagad'] : [],
        charge_currency: m === 'crypto' ? 'USD' : 'BDT',
        deposit_fx_rate: m === 'crypto' || !rate ? null : rate.toFixed(2),
      })),
      default_method: defaultMethod,
      presets_usd: presets,
      default_amount_usd: presets.includes('25.00') ? '25.00' : (presets[0] ?? '25.00'),
      min_usd: min.toFixed(2),
      max_usd: max.toFixed(2),
      remaining_daily_usd: Decimal.max(0, daily.minus(dec(used._sum.amountUsd))).toFixed(2),
      card_max_usd: new Decimal(String(await this.settings.get('card_new_customer_max_usd', '200.00'))).toFixed(2),
      deposits_paused: await this.settings.get<boolean>('deposits_paused', false),
    };
  }

  async summary(userId: string) {
    await this.core.ensureProfile(userId);
    await this.core.accounts(userId);
    const bal = await this.core.balances(userId);
    const month = await this.employer.monthSpend(userId);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
    return {
      deposit_balance_usd: usd2(bal.total),
      reserved_usd: usd2(bal.reserved),
      available_usd: usd2(bal.available),
      available_state: bal.available.gte('0.01') ? 'ready' : 'add_funds',
      spent_this_month_usd: usd2(month.spent),
      spent_trend_percent: month.trend,
      approved_this_month_tasks: month.tasks,
      account_status: user.status,
      add_funds: await this.addFundsContext(userId),
    };
  }

  // ---------------------------------------------------------------- statement

  private describe(r: TxRow, count: number): string {
    const p = r.description_params ?? {};
    const title = shortTitle(String(p.title ?? p.job_title ?? r.job_title ?? 'Job'));
    switch (r.type) {
      case 'deposit': {
        const m = String(p.method ?? r.deposit_method ?? '');
        return `${METHOD_LABEL[m] ?? 'Deposit'}${p.asset ? ` · ${p.asset}` : ''}`;
      }
      case 'job_reserve': {
        const reward = p.reward ? `$${new Decimal(String(p.reward)).toFixed(3)}` : '';
        const n = p.added ?? p.slots;
        const plus = p.kind === 'add_slots' ? '+' : '';
        const fee = p.fee_percent && Number(p.fee_percent) > 0 ? ` + ${p.fee_percent}% fee` : '';
        return n !== undefined ? `${title} · ${plus}${n} × ${reward}${fee}` : title;
      }
      case 'job_spend':
      case 'task_reward':
        return `${title} · ${count} approval${count === 1 ? '' : 's'}`;
      case 'platform_fee':
        return `${title} · ${count} approval${count === 1 ? '' : 's'} · ${p.percent ?? ''}%`;
      case 'job_release':
        return `${title} · ${String(p.reason ?? 'budget released')}`;
      case 'deposit_refund':
        return `Refund to ${METHOD_LABEL[String(p.method ?? r.deposit_method ?? '')] ?? 'original method'} · ${r.deposit_ref ?? ''}`.trim();
      default:
        return String(p.label ?? p.reason ?? 'Adjustment');
    }
  }

  /** Full statement with D-26 running balance. `detailed` lists every approval separately. */
  async statement(userId: string, detailed = false): Promise<StatementRow[]> {
    const { available, reserved } = await this.core.accounts(userId);
    const rows = await this.db.$queryRaw<TxRow[]>`
      SELECT t.id, t.public_ref, t.seq, t.type::text AS type, t.occurred_at, t.job_id, j.public_id AS job_public_id, j.title AS job_title,
             t.description_params,
             SUM(e.amount) FILTER (WHERE e.account_id = ${available.id}::uuid) AS net_available,
             SUM(e.amount) FILTER (WHERE e.account_id = ${reserved.id}::uuid) AS net_reserved,
             d.public_ref AS deposit_ref, d.method::text AS deposit_method
      FROM ledger_transactions t
      JOIN ledger_entries e ON e.transaction_id = t.id
      LEFT JOIN jobs j ON j.id = t.job_id
      LEFT JOIN deposits d ON d.id = t.deposit_id
      WHERE e.account_id IN (${available.id}::uuid, ${reserved.id}::uuid)
      GROUP BY t.id, j.public_id, j.title, d.public_ref, d.method
      ORDER BY t.occurred_at ASC, t.seq ASC`;
    let running = new Decimal(0);
    type G = { key: string; rows: TxRow[]; amount: Decimal; balance: Decimal; last: TxRow };
    const groups: G[] = [];
    const open = new Map<string, G>();
    for (const r of rows) {
      const na = dec(r.net_available);
      const nr = dec(r.net_reserved);
      const total = na.plus(nr);
      running = running.plus(total);
      const isMove = r.type === 'job_reserve' || r.type === 'job_release';
      const amount = isMove ? na : total;
      const groupable = !detailed && (r.type === 'job_spend' || r.type === 'platform_fee') && r.job_id;
      const key = groupable ? `${r.type}:${r.job_id}:${dhakaDate(r.occurred_at)}` : r.public_ref;
      let g = groupable ? open.get(key) : undefined;
      if (!g) {
        g = { key, rows: [], amount: new Decimal(0), balance: running, last: r };
        groups.push(g);
        if (groupable) open.set(key, g);
      }
      g.rows.push(r);
      g.amount = g.amount.plus(amount);
      g.balance = running;
      g.last = r;
    }
    return groups
      .map((g) => {
        const r = g.last;
        const style: StatementRow['amount_style'] = r.type === 'job_reserve' || r.type === 'job_release' ? 'neutral' : g.amount.gt(0) ? 'credit' : 'debit';
        const abs = g.amount.abs();
        const sign = g.amount.lt(0) ? '−' : g.amount.gt(0) ? '+' : '';
        return {
          ref: r.public_ref,
          occurred_at: r.occurred_at.toISOString(),
          type: r.type === 'task_reward' ? 'job_spend' : r.type,
          type_label: TYPE_LABEL[r.type] ?? r.type,
          description: this.describe(r, g.rows.length),
          amount_usd: g.amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2),
          amount_label: `${sign}$${abs.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`,
          amount_style: style,
          balance_usd: usd2(g.balance),
          balance_exact: g.balance.toFixed(6),
          amount_exact: g.amount.toFixed(6),
          job_public_id: r.job_public_id,
          grouped_count: g.rows.length,
          grouped_refs: g.rows.map((x) => x.public_ref).reverse(),
        };
      })
      .reverse();
  }

  private rangeBounds(q: Pick<StatementQuery, 'range' | 'from' | 'to'>): { from: Date | null; to: Date | null } {
    const now = Date.now();
    const DAY = 86_400_000;
    switch (q.range) {
      case 'last_7_days':
        return { from: new Date(now - 7 * DAY), to: null };
      case 'last_90_days':
        return { from: new Date(now - 90 * DAY), to: null };
      case 'this_month':
        return { from: dhakaMonthStart(0), to: null };
      case 'this_year': {
        const y = new Date(now + 6 * 3_600_000).getUTCFullYear();
        return { from: new Date(Date.UTC(y, 0, 1) - 6 * 3_600_000), to: null };
      }
      case 'all':
        return { from: null, to: null };
      case 'custom': {
        const from = q.from ? new Date(`${q.from}T00:00:00+06:00`) : null;
        const to = q.to ? new Date(new Date(`${q.to}T00:00:00+06:00`).getTime() + DAY) : null;
        if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) throw new ApiError('VALIDATION_FAILED', undefined, { from: ['Choose a valid date range.'] });
        if (from && to && to.getTime() - from.getTime() > 367 * DAY) throw new ApiError('EXPORT_TOO_LARGE');
        return { from, to };
      }
      default:
        return { from: new Date(now - 30 * DAY), to: null };
    }
  }

  private filter(rows: StatementRow[], q: StatementQuery) {
    const { from, to } = this.rangeBounds(q);
    const needle = q.q?.trim().toLowerCase();
    return rows.filter((r) => {
      const at = new Date(r.occurred_at);
      if (from && at < from) return false;
      if (to && at >= to) return false;
      if (q.type && q.type !== 'all' && r.type !== q.type) return false;
      if (needle && !`${r.description} ${r.ref} ${r.job_public_id ?? ''} ${r.grouped_refs.join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }

  async transactions(userId: string, q: StatementQuery) {
    const all = await this.statement(userId);
    const rows = this.filter(all, q);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    const page = Math.min(q.page, totalPages);
    const monthStart = dhakaMonthStart(0);
    const month = all.filter((r) => new Date(r.occurred_at) >= monthStart);
    const sum = (t: string) => month.filter((r) => r.type === t).reduce((s, r) => s.plus(r.amount_exact), new Decimal(0));
    const spend = await this.employer.monthSpend(userId);
    return new Paged(
      rows.slice((page - 1) * q.per_page, page * q.per_page).map(({ balance_exact: _b, amount_exact: _a, ...r }) => r),
      {
        total,
        page,
        per_page: q.per_page,
        total_pages: totalPages,
        has_more: page < totalPages,
        summary: {
          deposited_this_month_usd: usd2(sum('deposit')),
          spent_on_approvals_usd: usd2(spend.spent),
          returned_to_deposit_usd: usd2(sum('job_release')),
        },
        types_present: [...new Set(all.map((r) => r.type))],
      },
    );
  }

  async exportCsv(userId: string, q: StatementQuery & { mode: 'summary' | 'detailed' }) {
    const rows = this.filter(await this.statement(userId, q.mode === 'detailed'), q);
    if (rows.length > 50_000) throw new ApiError('EXPORT_TOO_LARGE');
    const esc = (v: string) => {
      let s = v;
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dhaka = (iso: string) => new Date(new Date(iso).getTime() + 6 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    const lines = ['date_utc,date_dhaka,type,description,amount_usd,balance_usd,reference,job_public_id'];
    for (const r of rows)
      lines.push(
        [r.occurred_at.replace(/\.\d+Z$/, 'Z'), dhaka(r.occurred_at), r.type, esc(r.description), new Decimal(r.amount_exact).toFixed(6), r.balance_exact, r.ref, r.job_public_id ?? ''].join(','),
      );
    const stamp = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
    return { filename: `24freelancing-transactions-${stamp}.csv`, body: lines.join('\n') + '\n' };
  }
}
