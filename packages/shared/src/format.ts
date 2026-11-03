/**
 * Display formatters (Canonical §5, Doc 03 §9, Doc 08 §3.1).
 *
 * Money is a decimal string in and a string out. Never a JS float. Balances truncate
 * toward zero (A-03): the UI never shows money the user does not have. Negative values
 * use the Unicode minus "−" (U+2212). Dates display in Asia/Dhaka (A-04).
 */
import Big from 'big.js';

export const MINUS = '−';
export const EM_DASH = '—';
export const DISPLAY_TZ = 'Asia/Dhaka';

export type MoneyInput = string | number | null | undefined;

function isEmpty(v: MoneyInput): v is null | undefined | '' {
  return v === null || v === undefined || v === '';
}

function toBig(v: string | number): Big {
  return new Big(typeof v === 'number' ? String(v) : v.trim());
}

/** Adds thousands separators to the integer part of a plain decimal string. */
export function groupThousands(fixed: string): string {
  const [int = '0', frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** Truncate toward zero to `dp` decimals (A-03, RND-02). */
export function truncateDecimal(v: string | number, dp: number): string {
  return toBig(v).round(dp, Big.roundDown).toFixed(dp);
}

function usd(abs: Big, dp: number): string {
  return `$${groupThousands(abs.toFixed(dp))}`;
}

/** Reward, 3 dp: "$0.180" (RND-03). */
export function formatReward(v: MoneyInput): string {
  if (isEmpty(v)) return EM_DASH;
  return usd(toBig(v).abs().round(3, Big.roundDown), 3);
}

/** Balance or total, 2 dp, truncated: "$12.48", "$12,480.50", "−$10.00" (RND-02, RND-14). */
export function formatMoney(v: MoneyInput): string {
  if (isEmpty(v)) return EM_DASH;
  const t = toBig(v).round(2, Big.roundDown);
  const text = usd(t.abs(), 2);
  return t.lt(0) ? `${MINUS}${text}` : text;
}

/** Signed ledger amount. `reward` keeps 3 dp ("+$0.120"); default 2 dp ("−$10.00"). Zero has no sign. */
export function formatSigned(v: MoneyInput, kind: 'reward' | 'money' = 'money'): string {
  if (isEmpty(v)) return EM_DASH;
  const big = toBig(v);
  const dp = kind === 'reward' ? 3 : 2;
  const abs = big.abs().round(dp, Big.roundDown);
  const text = usd(abs, dp);
  if (abs.eq(0)) return text;
  return big.lt(0) ? `${MINUS}${text}` : `+${text}`;
}

/** "+$0.120" / "+$12.48". */
export function formatCredit(v: MoneyInput, kind: 'reward' | 'money' = 'money'): string {
  if (isEmpty(v)) return EM_DASH;
  return `+${kind === 'reward' ? formatReward(toBig(v).abs().toString()) : formatMoney(toBig(v).abs().toString())}`;
}

/** "−$10.00". */
export function formatDebit(v: MoneyInput): string {
  if (isEmpty(v)) return EM_DASH;
  return `${MINUS}${usd(toBig(v).abs().round(2, Big.roundDown), 2)}`;
}

/** Referral commission in lists: "+$0.18" (RND-04). */
export function formatCommission(v: MoneyInput): string {
  return formatCredit(v, 'money');
}

/** BDT, whole taka, thousands separator: "৳1,215". `estimate` → "≈ ৳1,516" (RND-08, RND-09). */
export function formatBdt(v: MoneyInput, opts: { estimate?: boolean } = {}): string {
  if (isEmpty(v)) return EM_DASH;
  const text = `৳${groupThousands(toBig(v).round(0, Big.roundDown).toFixed(0))}`;
  return opts.estimate ? `≈ ${text}` : text;
}

/** "10.00 USDT" (RND-11). */
export function formatUsdt(v: MoneyInput): string {
  if (isEmpty(v)) return EM_DASH;
  return `${groupThousands(toBig(v).round(2, Big.roundDown).toFixed(2))} USDT`;
}

/** "1 USD = ৳121.50". Prefer the API's `fx_rate_label` when present. */
export function formatRate(rate: MoneyInput): string {
  if (isEmpty(rate)) return EM_DASH;
  return `1 USD = ৳${groupThousands(toBig(rate).toFixed(2))}`;
}

/** "All" quick amount: floor to whole cents (RND-05). Returns a request-ready string. */
export function floorToCents(v: string | number): string {
  return toBig(v).round(2, Big.roundDown).toFixed(2);
}

/** BDT payout amount: floor((usd − fee) × rate) to whole taka (RND-08). */
export function bdtPayout(usdAmount: string, feeUsd: string, rate: string): string {
  return new Big(usdAmount).minus(feeUsd).times(rate).round(0, Big.roundDown).toFixed(0);
}

// ---------------------------------------------------------------------------
// Dates (Asia/Dhaka, A-04)
// ---------------------------------------------------------------------------

const dhakaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

type DateParts = Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'weekday', string>;

function partsOf(d: Date): DateParts {
  const map: Record<string, string> = {};
  for (const p of dhakaParts.formatToParts(d)) map[p.type] = p.value;
  return map as DateParts;
}

const DHAKA_OFFSET_MS = 6 * 3_600_000; // UTC+6, no DST

/** Calendar day number on the Dhaka calendar. */
export function dhakaDayNumber(d: Date): number {
  return Math.floor((d.getTime() + DHAKA_OFFSET_MS) / 86_400_000);
}

export type DateInput = string | Date | null | undefined;

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** "Oct 26, 10:15". Adds the year when it differs from the current one: "Oct 26, 2025, 10:15". */
export function formatDateTime(v: DateInput, now: number = Date.now()): string {
  if (!v) return EM_DASH;
  const p = partsOf(toDate(v));
  const thisYear = partsOf(new Date(now)).year;
  const date = p.year === thisYear ? `${p.month} ${p.day}` : `${p.month} ${p.day}, ${p.year}`;
  return `${date}, ${p.hour}:${p.minute}`;
}

/** "Oct 26", or "Oct 26, 2025" in another year. */
export function formatDate(v: DateInput, now: number = Date.now()): string {
  if (!v) return EM_DASH;
  const p = partsOf(toDate(v));
  return p.year === partsOf(new Date(now)).year ? `${p.month} ${p.day}` : `${p.month} ${p.day}, ${p.year}`;
}

/** "10:15" in Dhaka time. */
export function formatTime(v: DateInput): string {
  if (!v) return EM_DASH;
  const p = partsOf(toDate(v));
  return `${p.hour}:${p.minute}`;
}

/** "2024-03" → "Mar 2024" (employer "since"). */
export function formatYearMonth(v: string | null | undefined): string {
  if (!v) return EM_DASH;
  const [y, m] = v.split('-');
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(y), Number(m) - 1, 1)),
  );
  return `${label} ${y}`;
}

/**
 * Relative time (Canonical §5): just now · 5 min ago · 2 h ago · Yesterday · 2 days ago (or Mon) · Oct 26.
 * `dayStyle: "weekday"` gives "Mon" for 2–6 days.
 */
export function formatRelative(v: DateInput, now: number = Date.now(), opts: { dayStyle?: 'days' | 'weekday' } = {}): string {
  if (!v) return EM_DASH;
  const d = toDate(v);
  const diffMin = Math.floor((now - d.getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  const dayGap = dhakaDayNumber(new Date(now)) - dhakaDayNumber(d);
  if (dayGap <= 0) return diffMin < 60 ? `${diffMin} min ago` : `${Math.floor(diffMin / 60)} h ago`;
  if (dayGap === 1) return diffMin < 60 ? `${diffMin} min ago` : 'Yesterday';
  if (dayGap < 7) return opts.dayStyle === 'weekday' ? partsOf(d).weekday : `${dayGap} days ago`;
  return formatDate(d, now);
}

export type NotificationGroup = 'TODAY' | 'YESTERDAY' | 'EARLIER THIS WEEK' | 'OLDER';

/** Notification list groups on the Dhaka calendar. */
export function notificationGroup(v: string | Date, now: number = Date.now()): NotificationGroup {
  const gap = dhakaDayNumber(new Date(now)) - dhakaDayNumber(toDate(v));
  if (gap <= 0) return 'TODAY';
  if (gap === 1) return 'YESTERDAY';
  return gap < 7 ? 'EARLIER THIS WEEK' : 'OLDER';
}

/** Greeting part for "Good evening, Nusrat" in Dhaka time. */
export function greetingPart(now: number = Date.now()): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(partsOf(new Date(now)).hour);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** Slot hold countdown "48:12" (mm:ss). */
export function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** OTP resend "0:42". */
export function formatMSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "18 h"; below 60 min "N min"; below 1 min "under a minute". */
export function formatHoursLeft(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const min = Math.floor(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
}

/** "9 h left". */
export function formatTimeLeft(ms: number): string {
  return `${formatHoursLeft(ms)} left`;
}

/** "≈ 6 min". */
export function formatMinutes(n: number): string {
  return `≈ ${n} min`;
}

/** "72 hours". */
export function formatWindow(h: number): string {
  return `${h} hours`;
}

// ---------------------------------------------------------------------------
// Percent and counts
// ---------------------------------------------------------------------------

/** Integer percent "94%"; null → em dash (A-20). */
export function formatPercent(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return EM_DASH;
  return `${Math.floor(Number(v))}%`;
}

/** Trend chip "+18%" / "−12%"; zero or null → em dash. */
export function formatTrend(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return EM_DASH;
  return v > 0 ? `+${v}%` : `${MINUS}${Math.abs(v)}%`;
}

export function formatCount(n: number): string {
  return groupThousands(String(Math.trunc(n)));
}

export const formatSlotsLeft = (n: number): string => `${n} ${n === 1 ? 'slot' : 'slots'} left`;
export const formatSlotsRatio = (filled: number, total: number): string => `${filled} / ${total}`;
export const formatSlotsFilled = (filled: number, total: number): string => `${filled} of ${total} slots filled`;
