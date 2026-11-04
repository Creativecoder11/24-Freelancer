import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { ApiError } from '../../../common/api-error';
import { Paged } from '../../../common/envelope.interceptor';

export type Q = Record<string, string | undefined>;

export const dec = (v: Decimal.Value | Prisma.Decimal | null | undefined) => new Decimal(v === null || v === undefined ? 0 : v.toString());
/** Admin money strings: 2 dp for balances, 3 dp for rewards, 6 dp exact (Doc 09 §2.4 rule 4). */
export const m2 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
export const m3 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toDecimalPlaces(3, Decimal.ROUND_DOWN).toFixed(3);
export const m6 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toFixed(6);
export const m2n = (v: Decimal.Value | Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : m2(v));
export const pd = (v: Decimal.Value) => new Prisma.Decimal(new Decimal(v).toFixed(6));
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function paging(q: Q, fallback = 20) {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const raw = Math.floor(Number(q.per_page) || fallback);
  const perPage = [10, 20, 50, 100].includes(raw) ? raw : fallback;
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function paged<T>(data: T[], total: number, p: { page: number; perPage: number }, extra: Record<string, unknown> = {}) {
  const totalPages = Math.max(1, Math.ceil(total / p.perPage));
  return new Paged(data, { total, page: p.page, per_page: p.perPage, total_pages: totalPages, has_more: p.page < totalPages, ...extra });
}

export const bool = (v: string | undefined) => (v === undefined ? undefined : v === 'true' || v === '1');

/** Required reason (Doc 09 §5.4 rule 1). */
export function needReason(v: unknown, max = 500, field = 'reason'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new ApiError('REASON_REQUIRED', undefined, { [field]: ["Enter a reason. It's kept in the audit log."] });
  if (s.length > max) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [`Keep it to ${max} characters or fewer.`] });
  return s;
}

export function optText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ApiError('VALIDATION_FAILED', undefined, { [field]: ['Enter text.'] });
  const s = v.trim();
  if (s.length > max) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [`Keep it to ${max} characters or fewer.`] });
  return s || null;
}

export function needText(v: unknown, max: number, field: string, msg = 'This field is required.', min = 1): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [msg] });
  if (s.length > max) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [`Keep it to ${max} characters or fewer.`] });
  return s;
}

export function needEnum<T extends string>(v: unknown, values: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: ['Choose an option.'] });
  return v as T;
}

/** Positive USD amount with ≤ dp decimals. */
export function needMoney(v: unknown, field: string, dp = 2, allowNegative = false): Decimal {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  const re = allowNegative ? new RegExp(`^-?\\d+(\\.\\d{1,${dp}})?$`) : new RegExp(`^\\d+(\\.\\d{1,${dp}})?$`);
  if (!re.test(s)) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: [`Enter an amount with up to ${dp} decimals.`] });
  const d = new Decimal(s);
  if (d.isZero() || (!allowNegative && d.lte(0))) throw new ApiError('VALIDATION_FAILED', undefined, { [field]: ['Enter an amount above zero.'] });
  return d;
}

/** Idempotency-Key header (Doc 06 §1.10). Required on Money endpoints. */
export function idemKey(v: string | undefined): string {
  if (!v || !/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
  return v;
}

export function dateRange(q: Q, defDays?: number) {
  const parse = (s: string | undefined, end: boolean) => {
    if (!s) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T00:00:00+06:00`);
      return end ? new Date(d.getTime() + 86_400_000) : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  let from = parse(q.from, false);
  const to = parse(q.to, true);
  if (!from && defDays) from = new Date(Date.now() - defDays * 86_400_000);
  return { from, to };
}

/** CSV with formula-injection escaping and a UTF-8 BOM (Doc 09 §22.4). */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][], numericCols: number[] = []): string {
  const cell = (v: string | number | null | undefined, i: number) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (!numericCols.includes(i) && !/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export const startOfDhakaDay = (now = new Date(), daysAgo = 0) => {
  const local = new Date(now.getTime() + 6 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysAgo) - 6 * 3_600_000);
};

export const dhakaDateStr = (d: Date) => new Date(d.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);

/** Narrow a Prisma unique-violation. */
export const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function uuid7(tx: Prisma.TransactionClient | { $queryRaw: Prisma.TransactionClient['$queryRaw'] }) {
  return (await tx.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
}
