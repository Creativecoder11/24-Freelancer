import type { Tone } from '../types';

export type BadgeEnum =
  | 'job_status'
  | 'reservation_status'
  | 'submission_status'
  | 'submission_status_employer'
  | 'dispute_status'
  | 'withdrawal_status'
  | 'deposit_status'
  | 'ledger_display'
  | 'kyc_status'
  | 'referral_status'
  | 'account_status';

type Entry = readonly [label: string, tone: Tone];

/**
 * Complete tone map (Doc 02 §5.18). Single lookup so tones never drift.
 * NOTE: Doc 03 places the canonical map in @24f/shared/enums; until that exists this is the source.
 */
export const BADGE_MAP: Record<BadgeEnum, Record<string, Entry>> = {
  job_status: {
    draft: ['Draft', 'neutral'],
    running: ['Running', 'success'],
    paused: ['Paused', 'warning'],
    completed: ['Completed', 'neutral'],
    cancelled: ['Cancelled', 'neutral'],
    suspended: ['Suspended by admin', 'danger'],
  },
  reservation_status: {
    active: ['In progress', 'warning'],
    expired: ['Slot expired', 'neutral'],
    released: ['Released', 'neutral'],
  },
  submission_status: {
    in_review: ['In review', 'warning'],
    approved: ['Approved', 'success'],
    needs_fix: ['Needs fix', 'danger'],
    rejected: ['Rejected', 'danger'],
  },
  submission_status_employer: {
    in_review: ['In review', 'warning'],
    approved: ['Approved', 'success'],
    needs_fix: ['Fix requested', 'danger'],
    rejected: ['Final', 'danger'],
  },
  dispute_status: {
    open: ['Dispute open', 'info'],
    under_review: ['Under review', 'info'],
    resolved_worker: ['Overturned', 'success'],
    resolved_employer: ['Upheld', 'neutral'],
    withdrawn: ['Withdrawn', 'neutral'],
  },
  withdrawal_status: {
    requested: ['Requested', 'warning'],
    processing: ['Processing', 'info'],
    paid: ['Paid', 'success'],
    rejected: ['Rejected', 'danger'],
    cancelled: ['Cancelled', 'neutral'],
    failed: ['Failed', 'danger'],
  },
  deposit_status: {
    initiated: ['Started', 'neutral'],
    pending: ['Pending', 'warning'],
    completed: ['Completed', 'success'],
    failed: ['Failed', 'danger'],
    cancelled: ['Cancelled', 'neutral'],
    expired: ['Expired', 'neutral'],
    refunded: ['Refunded', 'info'],
  },
  ledger_display: {
    added: ['Added', 'success'],
    processing: ['Processing', 'info'],
    paid: ['Paid', 'success'],
    refunded: ['Refunded', 'danger'],
  },
  kyc_status: {
    not_submitted: ['Not verified', 'neutral'],
    pending: ['Under review', 'warning'],
    verified: ['Identity verified', 'success'],
    rejected: ['Rejected', 'danger'],
  },
  referral_status: {
    not_started: ['Not started', 'neutral'],
    active: ['Active', 'success'],
    ineligible: ['Not eligible', 'neutral'],
  },
  account_status: {
    active: ['Active', 'success'],
    restricted: ['Restricted', 'warning'],
    suspended: ['Suspended', 'danger'],
    closed: ['Closed', 'neutral'],
  },
};

function humanise(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Looks up label + tone. Unknown codes render humanised in Neutral and never throw. */
export function badgeTone(enumName: BadgeEnum, code: string): { label: string; tone: Tone; known: boolean } {
  const hit = BADGE_MAP[enumName]?.[code];
  if (hit) return { label: hit[0], tone: hit[1], known: true };
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn(`[StatusBadge] unknown ${enumName} code "${code}"`);
  }
  return { label: humanise(code), tone: 'neutral', known: false };
}
