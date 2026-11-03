import { describe, expect, it } from 'vitest';
import {
  bdtPayout,
  floorToCents,
  formatBdt,
  formatCommission,
  formatCredit,
  formatDate,
  formatDateTime,
  formatDebit,
  formatHoursLeft,
  formatMinutes,
  formatMoney,
  formatMmSs,
  formatMSs,
  formatPercent,
  formatRate,
  formatRelative,
  formatReward,
  formatSigned,
  formatSlotsLeft,
  formatTrend,
  formatUsdt,
  formatYearMonth,
  greetingPart,
  notificationGroup,
  truncateDecimal,
} from '../index';

const MINUS = '−';

describe('money (Canonical §5, Doc 08 §3.1)', () => {
  it('formats rewards with 3 decimals', () => {
    expect(formatReward('0.18')).toBe('$0.180');
    expect(formatReward('0.180000')).toBe('$0.180');
    expect(formatReward('10')).toBe('$10.000');
    expect(formatReward(null)).toBe('—');
  });

  it('truncates balances to 2 decimals, never rounds up (AC-RND-1)', () => {
    expect(formatMoney('12.489999')).toBe('$12.48');
    expect(formatMoney('12.48')).toBe('$12.48');
    expect(formatMoney('0.009')).toBe('$0.00');
    expect(formatMoney('12480.5')).toBe('$12,480.50');
    expect(formatMoney('1234567.891')).toBe('$1,234,567.89');
  });

  it('uses the Unicode minus for negatives (RND-14)', () => {
    expect(formatMoney('-10.009')).toBe(`${MINUS}$10.00`);
    expect(formatDebit('10')).toBe(`${MINUS}$10.00`);
    expect(formatSigned('-10')).toBe(`${MINUS}$10.00`);
    expect(formatMoney('-10.009')).not.toContain('-');
  });

  it('signs credits', () => {
    expect(formatSigned('0.12', 'reward')).toBe('+$0.120');
    expect(formatSigned('1.2')).toBe('+$1.20');
    expect(formatSigned('0')).toBe('$0.00');
    expect(formatCredit('0.12', 'reward')).toBe('+$0.120');
  });

  it('formats referral commissions truncated to cents (RND-04, AC-RND-3)', () => {
    expect(formatCommission('0.189000')).toBe('+$0.18');
    expect(formatCommission('0.009000')).toBe('+$0.00');
  });

  it('formats BDT whole taka with separators (RND-08, RND-09)', () => {
    expect(formatBdt('1215')).toBe('৳1,215');
    expect(formatBdt('1516.32', { estimate: true })).toBe('≈ ৳1,516');
    expect(formatBdt('999.99')).toBe('৳999');
  });

  it('computes a BDT payout (AC-RND-2)', () => {
    expect(bdtPayout('10.00', '0', '121.50')).toBe('1215');
    expect(bdtPayout('12.48', '0', '121.50')).toBe('1516');
  });

  it('formats USDT and the FX label', () => {
    expect(formatUsdt('10')).toBe('10.00 USDT');
    expect(formatRate('121.5')).toBe('1 USD = ৳121.50');
  });

  it('floors to cents for the "All" chip (RND-05)', () => {
    expect(floorToCents('12.489')).toBe('12.48');
    expect(truncateDecimal('0.1999', 3)).toBe('0.199');
  });

  it('never uses binary floats', () => {
    expect(formatMoney('0.30000000000000004')).toBe('$0.30');
    expect(formatMoney(String(0.1 + 0.2))).toBe('$0.30');
  });
});

describe('dates in Asia/Dhaka (A-04)', () => {
  const now = Date.parse('2026-10-26T06:00:00Z'); // Oct 26, 12:00 Dhaka

  it('formats date-time in Dhaka, 24 h', () => {
    expect(formatDateTime('2026-10-26T04:15:00Z', now)).toBe('Oct 26, 10:15');
    expect(formatDateTime('2026-10-25T20:30:00Z', now)).toBe('Oct 26, 02:30');
  });

  it('adds the year when it differs', () => {
    expect(formatDateTime('2025-10-26T04:15:00Z', now)).toBe('Oct 26, 2025, 10:15');
    expect(formatDate('2025-03-01T04:15:00Z', now)).toBe('Mar 1, 2025');
    expect(formatDate('2026-03-01T04:15:00Z', now)).toBe('Mar 1');
  });

  it('formats "since" months', () => {
    expect(formatYearMonth('2024-03')).toBe('Mar 2024');
  });

  it('formats relative time', () => {
    expect(formatRelative(new Date(now - 20_000), now)).toBe('just now');
    expect(formatRelative(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
    expect(formatRelative(new Date(now - 2 * 3_600_000), now)).toBe('2 h ago');
    expect(formatRelative('2026-10-25T06:00:00Z', now)).toBe('Yesterday');
    expect(formatRelative('2026-10-24T06:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-10-24T06:00:00Z', now, { dayStyle: 'weekday' })).toBe('Sat');
    expect(formatRelative('2026-10-10T06:00:00Z', now)).toBe('Oct 10');
  });

  it('groups notifications by Dhaka day', () => {
    expect(notificationGroup('2026-10-26T00:30:00Z', now)).toBe('TODAY');
    expect(notificationGroup('2026-10-25T17:59:00Z', now)).toBe('YESTERDAY');
    expect(notificationGroup('2026-10-22T06:00:00Z', now)).toBe('EARLIER THIS WEEK');
    expect(notificationGroup('2026-10-01T06:00:00Z', now)).toBe('OLDER');
  });

  it('picks the greeting part in Dhaka', () => {
    expect(greetingPart(Date.parse('2026-10-26T03:00:00Z'))).toBe('morning');
    expect(greetingPart(Date.parse('2026-10-26T08:00:00Z'))).toBe('afternoon');
    expect(greetingPart(Date.parse('2026-10-26T14:00:00Z'))).toBe('evening');
  });
});

describe('durations, percent, slots', () => {
  it('formats countdowns', () => {
    expect(formatMmSs((48 * 60 + 12) * 1000)).toBe('48:12');
    expect(formatMSs(42_000)).toBe('0:42');
    expect(formatMmSs(-5)).toBe('00:00');
  });

  it('formats hours left and minutes', () => {
    expect(formatHoursLeft(18 * 3_600_000 + 5)).toBe('18 h');
    expect(formatHoursLeft(30 * 60_000)).toBe('30 min');
    expect(formatHoursLeft(10_000)).toBe('under a minute');
    expect(formatMinutes(6)).toBe('≈ 6 min');
  });

  it('formats percent and trend chips', () => {
    expect(formatPercent(94)).toBe('94%');
    expect(formatPercent(null)).toBe('—');
    expect(formatTrend(18)).toBe('+18%');
    expect(formatTrend(-12)).toBe(`${MINUS}12%`);
    expect(formatTrend(0)).toBe('—');
  });

  it('formats slots', () => {
    expect(formatSlotsLeft(1)).toBe('1 slot left');
    expect(formatSlotsLeft(26)).toBe('26 slots left');
  });
});
