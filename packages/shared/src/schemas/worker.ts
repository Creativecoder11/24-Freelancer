import { z } from 'zod';
import {

  JOB_REPORT_REASON,
  JOB_SORT,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PREF_KEY,
  PROOF_TYPE,
  PUBLIC_CATEGORY_SLUGS,
  TIME_BUCKET,
  type CategorySlug,
  type JobSort,
  type NotificationCategory,
  type ProofType,
  type TimeBucket,
} from '../enums';
import { queryList, queryPage, queryPerPage } from './common';

/**
 * Worker app request schemas (Doc 06 §5.6, §5.7, §5.15). The API validates with these; the
 * web forms reuse them so client and server show the same messages.
 */

const searchText = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().slice(0, 100));

function keepKnown<T extends string>(allowed: readonly T[]) {
  return (list: string[]) => list.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

/** Query boolean with a default (Doc 06 §1.4: 1/0 and true/false). */
const queryBoolDefault = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : typeof v === 'boolean' ? v : v === '1' || v === 'true'));

/** VR-127: $0.10 to $0.40 in $0.05 steps (the drawer allows $0.01 steps, C-17); max 0.40 = no upper limit. */
const rewardBound = z
  .string()
  .optional()
  .transform((v) => (v && /^\d+(\.\d{1,3})?$/.test(v) ? v : null));

// ---------------------------------------------------------------------------
// Worker jobs
// ---------------------------------------------------------------------------

export const WORKER_JOB_CHIPS = ['all', 'for_you', ...PUBLIC_CATEGORY_SLUGS] as const;
export type WorkerJobChip = 'all' | 'for_you' | Exclude<CategorySlug, 'other'>;

/** GET /worker/jobs. */
export const workerJobsQuerySchema = z.object({
  q: searchText,
  chip: z
    .string()
    .optional()
    .transform((v): WorkerJobChip => ((WORKER_JOB_CHIPS as readonly string[]).includes(v ?? '') ? (v as WorkerJobChip) : 'all')),
  category: queryList.transform(keepKnown(PUBLIC_CATEGORY_SLUGS)),
  reward_min: rewardBound,
  reward_max: rewardBound,
  time: queryList.transform(keepKnown<TimeBucket>(TIME_BUCKET.values)),
  proof: queryList.transform(keepKnown<ProofType>(PROOF_TYPE.values)),
  only_open: queryBoolDefault(true),
  hide_done: queryBoolDefault(true),
  sort: z
    .string()
    .optional()
    .transform((v): JobSort => ((JOB_SORT.values as readonly string[]).includes(v ?? '') ? (v as JobSort) : 'newest')),
  page: queryPage,
  per_page: queryPerPage(9),
  count_only: queryBoolDefault(false),
});
export type WorkerJobsQuery = z.output<typeof workerJobsQuerySchema>;
export type WorkerJobsQueryInput = z.input<typeof workerJobsQuerySchema>;

/** VR-094 link proof: https only, ≤ 2,000 characters. */
export const LINK_INVALID_MESSAGE = 'Paste the full link, starting with https://.';
export function isHttpsUrl(v: string): boolean {
  if (!/^https:\/\//i.test(v) || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null ? null : v.trim() || null))
    .refine((v) => v === null || [...v].length <= max, { message });

/** One proof value in a draft: format checks only (Doc 04 §6.2). */
export const draftProofItemSchema = z.object({
  proof_requirement_id: z.string().uuid(),
  link_url: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim().slice(0, 2000) : null)),
  text_value: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.slice(0, 2000) : null)),
  upload_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});
export type DraftProofItem = z.output<typeof draftProofItemSchema>;

export const NOTE_MESSAGE = 'Keep the note under 300 characters.';

/** PUT /worker/reservations/{id}/progress. */
export const reservationProgressSchema = z.object({
  steps_checked: z.array(z.number().int().min(1).max(10)).max(10).optional(),
  draft: z
    .object({
      proof_items: z.array(draftProofItemSchema).max(10).default([]),
      worker_note: optionalText(300, NOTE_MESSAGE),
      attestation: z.boolean().optional().default(false),
      /** Monotonic client revision; an older save never overwrites a newer one (Doc 04 §6.2). */
      rev: z.number().int().min(0).optional(),
    })
    .optional(),
});
export type ReservationProgressInput = z.input<typeof reservationProgressSchema>;

/** One proof value on submit or resubmit (VR-094…VR-097). Per-type requirements are checked by the API. */
export const proofItemSchema = z.object({
  proof_requirement_id: z.string({ required_error: 'Add this proof.' }).uuid('Add this proof.'),
  link_url: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim() : null))
    .refine((v) => v === null || isHttpsUrl(v), { message: LINK_INVALID_MESSAGE }),
  text_value: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim() : null))
    .refine((v) => v === null || [...v].length <= 2000, { message: 'Keep your answer under 2,000 characters.' }),
  upload_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});
export type ProofItemInput = z.input<typeof proofItemSchema>;

/** POST /worker/reservations/{id}/submit (VR-093…VR-100). */
export const submitProofSchema = z.object({
  steps_checked: z.array(z.number().int().min(1).max(10)).max(10),
  proof_items: z.array(proofItemSchema).min(1, 'Add your proof.').max(10),
  worker_note: optionalText(300, NOTE_MESSAGE),
  attestation: z.literal(true, { errorMap: () => ({ message: 'Confirm you did this work yourself.' }) }),
});
export type SubmitProofInput = z.input<typeof submitProofSchema>;

/** POST /worker/submissions/{ref}/resubmit (VR-101…VR-104). */
export const resubmitSchema = z.object({
  proof_items: z.array(proofItemSchema).min(1, 'Add your proof.').max(10),
  change_note: optionalText(300, NOTE_MESSAGE),
});
export type ResubmitInput = z.input<typeof resubmitSchema>;

/** POST /worker/submissions/{ref}/disputes (VR-105; up to 3 evidence files, Canonical §17). */
export const DISPUTE_STATEMENT_MESSAGE = 'Explain what is wrong in 20 to 1,000 characters.';
export const disputeCreateSchema = z.object({
  worker_statement: z
    .string({ required_error: DISPUTE_STATEMENT_MESSAGE })
    .transform((s) => s.trim())
    .refine((s) => [...s].length >= 20 && [...s].length <= 1000, { message: DISPUTE_STATEMENT_MESSAGE }),
  evidence_upload_ids: z.array(z.string().uuid()).max(3, 'Add up to 3 files.').optional().default([]),
});
export type DisputeCreateInput = z.input<typeof disputeCreateSchema>;

/** POST /jobs/{publicId}/reports (VR-107…VR-109). */
export const jobReportSchema = z
  .object({
    reason: z.enum(JOB_REPORT_REASON.values as unknown as [string, ...string[]], {
      errorMap: () => ({ message: 'Choose a reason.' }),
    }),
    details: optionalText(300, 'Keep the details under 300 characters.'),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'other' && !v.details)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['details'], message: 'Tell us what’s wrong.' });
  });
export type JobReportInput = z.input<typeof jobReportSchema>;

/** Worker-facing report reason labels (Doc 02 §6.4.4 Report job dialog). */
export const JOB_REPORT_REASON_WORKER_LABEL: Readonly<Record<string, string>> = Object.freeze({
  scam_or_payment: 'Scam or asks for payment',
  personal_data: 'Asks for personal or payment data',
  fake_engagement: 'Fake reviews or engagement',
  broken_materials: 'Task link or materials don’t work',
  misleading: 'Reward or details are misleading',
  other: 'Something else',
});

// ---------------------------------------------------------------------------
// Worker submissions
// ---------------------------------------------------------------------------

export const WORKER_TASK_TABS = ['all', 'in_review', 'approved', 'needs_fix', 'rejected'] as const;
export type WorkerTaskTab = (typeof WORKER_TASK_TABS)[number];
export const WORKER_TASK_RANGES = ['last_7_days', 'last_30_days', 'last_90_days', 'all_time'] as const;
export type WorkerTaskRange = (typeof WORKER_TASK_RANGES)[number];
export const WORKER_TASK_RANGE_LABEL: Readonly<Record<WorkerTaskRange, string>> = Object.freeze({
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  all_time: 'All time',
});

/** GET /worker/submissions. */
export const workerSubmissionsQuerySchema = z.object({
  tab: z
    .string()
    .optional()
    .transform((v): WorkerTaskTab => ((WORKER_TASK_TABS as readonly string[]).includes(v ?? '') ? (v as WorkerTaskTab) : 'all')),
  q: searchText,
  range: z
    .string()
    .optional()
    .transform((v): WorkerTaskRange => ((WORKER_TASK_RANGES as readonly string[]).includes(v ?? '') ? (v as WorkerTaskRange) : 'last_30_days')),
  page: queryPage,
  per_page: queryPerPage(9),
});
export type WorkerSubmissionsQuery = z.output<typeof workerSubmissionsQuerySchema>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_TABS = ['all', ...NOTIFICATION_CATEGORY.values] as const;
export type NotificationTab = 'all' | NotificationCategory;

/** GET /notifications. */
export const notificationsQuerySchema = z.object({
  audience: z.enum(['worker', 'employer']).optional(),
  category: z
    .string()
    .optional()
    .transform((v): NotificationTab => ((NOTIFICATION_TABS as readonly string[]).includes(v ?? '') ? (v as NotificationTab) : 'all')),
  cursor: z.string().max(200).optional().nullable(),
  per_page: queryPerPage(20),
});
export type NotificationsQuery = z.output<typeof notificationsQuerySchema>;

/** POST /notifications/read-all. */
export const notificationsReadAllSchema = z.object({
  audience: z.enum(['worker', 'employer']).optional(),
  category: z.enum(NOTIFICATION_CATEGORY.values as unknown as [string, ...string[]]).optional(),
});

export const LOCKED_PREFERENCE_MESSAGE = 'Payout and security alerts can’t be turned off.';

/** PUT /notifications/preferences (VR-045). */
export const notificationPreferencesUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        pref_key: z.enum(NOTIFICATION_PREF_KEY.values as unknown as [string, ...string[]]),
        enabled: z.boolean().optional(),
        in_app_enabled: z.boolean().optional(),
        email_enabled: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type NotificationPreferencesUpdateInput = z.input<typeof notificationPreferencesUpdateSchema>;
