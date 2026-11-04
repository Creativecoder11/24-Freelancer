import { formatBdt, formatDate, formatDateTime, formatMoney, formatRelative, formatReward, MINUS } from '@24f/shared';

/** Canonical §5 formats for the panel (Asia/Dhaka). Money arrives as strings; never parsed for maths. */
export const usd = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v).startsWith('-') ? `${MINUS}${formatMoney(String(v).slice(1))}` : formatMoney(v));
export const reward = (v: string | null | undefined) => (v ? formatReward(v) : '—');
export const exact = (v: string | null | undefined) => (v === null || v === undefined ? '—' : v.startsWith('-') ? `${MINUS}${v.slice(1)}` : `+${v}`);
export const dt = (v: string | null | undefined) => (v ? formatDateTime(v) : '—');
export const d = (v: string | null | undefined) => (v ? formatDate(v) : '—');
export const rel = (v: string | null | undefined) => (v ? formatRelative(v) : '—');
export const bdt = (v: string | null | undefined) => (v ? formatBdt(v) : '—');
export const payout = (amount: string, currency: string) => (currency === 'BDT' ? formatBdt(amount) : `${amount} USDT`);

/** "Oct 27, 12:00:04" (audit log, exact to the second). */
export function dtSec(v: string | null | undefined) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(v));
}

/** SLA treatment (Doc 09 §5.2). */
export function sla(due: string | null | undefined, now = Date.now()): { label: string; tone: 'danger' | 'warning' | null } {
  if (!due) return { label: '—', tone: null };
  const ms = new Date(due).getTime() - now;
  if (ms < 0) return { label: 'Overdue', tone: 'danger' };
  if (ms < 6 * 3600_000) return { label: `Due in ${Math.max(1, Math.round(ms / 3600_000))} h`, tone: 'warning' };
  return { label: `Due ${formatDateTime(due)}`, tone: null };
}

export const humanize = (s: string | null | undefined) => (s ? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ') : '—');
