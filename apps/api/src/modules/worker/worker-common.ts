import { Prisma, type PrismaClient } from '@24f/db';
import { initials, SUBMISSION_EVENT_TYPE, type EmployerTrust, type SubmissionEventType } from '@24f/shared';
import Decimal from 'decimal.js';

/** Helpers shared by the worker, reservations, submissions and disputes modules. */

export type Tx = Prisma.TransactionClient | PrismaClient;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Rewards: 3 decimals (Doc 06 §1.5). */
export const reward3 = (v: Prisma.Decimal | Decimal.Value | null | undefined) => new Decimal((v ?? 0).toString()).toFixed(3, Decimal.ROUND_DOWN);

/** Balances and totals: truncated to 2 decimals (A-03, BR-095). */
export const usd2 = (v: Prisma.Decimal | Decimal.Value | null | undefined) => new Decimal((v ?? 0).toString()).toFixed(2, Decimal.ROUND_DOWN);

/** "$0.120" for notification copy. */
export const rewardLabel = (v: Prisma.Decimal | Decimal.Value | null | undefined) => `$${reward3(v)}`;

type EmployerProfileLite = {
  businessName: string;
  employerVerifiedAt: Date | null;
  approvalRatePct: number | null;
  avgReviewSeconds: number | null;
  jobsPostedCount: number;
} | null;

export function employerTrust(profile: EmployerProfileLite, fallbackName?: string | null): EmployerTrust {
  const name = profile?.businessName ?? fallbackName ?? 'Employer';
  return {
    business_name: name,
    initials: initials(name),
    employer_verified: !!profile?.employerVerifiedAt,
    since: profile?.employerVerifiedAt ? profile.employerVerifiedAt.toISOString().slice(0, 7) : null,
    approval_rate_pct: profile?.approvalRatePct ?? null,
    avg_review_hours: profile?.avgReviewSeconds ? Math.max(1, Math.round(profile.avgReviewSeconds / 3600)) : null,
    jobs_posted: profile?.jobsPostedCount ?? 0,
  };
}

/** Short employer name for rows ("Shelfwise" for "Shelfwise Ltd.", Figma 28:800). */
export function shortEmployerName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited|LLC|Inc\.?|PLC)$/i, '').trim() || name;
}

/** Activity labels for the Task details log (Figma 30:2305). */
export const EVENT_LABEL: Record<SubmissionEventType, string> = {
  ...(SUBMISSION_EVENT_TYPE.labels as Record<SubmissionEventType, string>),
  job_opened: 'Job opened',
  slot_reserved: 'Started job · slot reserved',
  submitted: 'Submitted for review',
  resubmitted: 'Resubmitted with a fix',
  approved: 'Approved by the employer',
  auto_approved: 'Approved automatically',
  needs_fix: 'Employer asked for a fix',
  rejected: 'Rejected by the employer',
  paid_to_balance: 'Paid to balance',
};

export async function recordEvent(
  tx: Tx,
  reservationId: string,
  submissionId: string | null,
  type: SubmissionEventType,
  actor: { type: 'user' | 'system' | 'admin'; userId?: string },
  data: Record<string, unknown> = {},
) {
  await tx.submissionEvent.create({
    data: {
      reservationId,
      submissionId,
      eventType: type,
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
      data: data as Prisma.InputJsonValue,
    },
  });
}

/** Start of the current and previous Asia/Dhaka calendar months, as UTC instants (A-04). */
export function dhakaMonthBounds(now = new Date()) {
  const offset = 6 * 3600_000;
  const local = new Date(now.getTime() + offset);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - offset);
  const prevStart = new Date(Date.UTC(y, m - 1, 1) - offset);
  return { start, prevStart };
}

/** "+18%" trend; null when last month was 0 (A-49). */
export function trendPercent(current: Decimal, previous: Decimal): number | null {
  if (previous.isZero()) return null;
  return current.minus(previous).div(previous).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
