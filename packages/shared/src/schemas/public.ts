import { z } from 'zod';
import {
  CONTACT_TOPIC,
  FAQ_PLACEMENT,
  JOB_SORT,
  PROOF_TYPE,
  PUBLIC_CATEGORY_SLUGS,
  REWARD_MIN_OPTIONS,
  TIME_BUCKET,
  type JobSort,
  type ProofType,
  type TimeBucket,
} from '../enums';
import { email, lengthBetween, queryBool, queryList, queryPage, queryPerPage } from './common';

/** Job search text VR-125: 0–100 chars, trimmed. Longer input is cut, never an error. */
const searchText = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().slice(0, 100));

function keepKnown<T extends string>(allowed: readonly T[]) {
  return (list: string[]) => list.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

/**
 * GET /public/jobs query (Doc 06 §5.5). Unknown filter values are ignored (VR-128);
 * the normalised set is echoed back in `meta.applied_filters`.
 */
export const publicJobsQuerySchema = z.object({
  q: searchText,
  category: queryList.transform(keepKnown(PUBLIC_CATEGORY_SLUGS)),
  reward_min: z
    .string()
    .optional()
    .transform((v) => (v && (REWARD_MIN_OPTIONS as readonly string[]).includes(v) ? v : v && /^\d+(\.\d{1,3})?$/.test(v) ? v : null)),
  time: queryList.transform(keepKnown<TimeBucket>(TIME_BUCKET.values)),
  proof: queryList.transform(keepKnown<ProofType>(PROOF_TYPE.values)),
  sort: z
    .string()
    .optional()
    .transform((v): JobSort => ((JOB_SORT.values as readonly string[]).includes(v ?? '') ? (v as JobSort) : 'newest')),
  page: queryPage,
  per_page: queryPerPage(8),
  count_only: queryBool,
});
export type PublicJobsQuery = z.output<typeof publicJobsQuerySchema>;
export type PublicJobsQueryInput = z.input<typeof publicJobsQuerySchema>;

/** GET /public/search (cursor based, default 6 per page). */
export const publicSearchQuerySchema = z.object({
  q: searchText,
  category: z
    .string()
    .optional()
    .transform((v) => (v && (PUBLIC_CATEGORY_SLUGS as string[]).includes(v) ? v : null)),
  cursor: z.string().max(200).optional().nullable(),
  per_page: queryPerPage(6),
});
export type PublicSearchQuery = z.output<typeof publicSearchQuerySchema>;

/** GET /public/categories. */
export const publicCategoriesQuerySchema = z.object({ include_other: queryBool });

/** GET /public/jobs/{publicId}/similar. */
export const similarJobsQuerySchema = z.object({
  per_page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => Math.min(Math.max(Number(v ?? 3) || 3, 1), 12)),
});

/** GET /public/help/articles (VR-126: 2–100 chars when present). */
export const helpArticlesQuerySchema = z.object({
  topic: z.string().max(60).optional().nullable(),
  q: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim())
    .refine((v) => v.length === 0 || (v.length >= 2 && v.length <= 100), { message: 'Type at least 2 characters.' }),
  popular: queryBool,
  page: queryPage,
  per_page: queryPerPage(20),
});
export type HelpArticlesQuery = z.output<typeof helpArticlesQuerySchema>;

export const helpArticleQuerySchema = z.object({ topic: z.string().max(60).optional().nullable() });

/** GET /public/faqs. */
export const faqsQuerySchema = z.object({
  placement: z
    .string()
    .optional()
    .transform((v) => ((FAQ_PLACEMENT.values as readonly string[]).includes(v ?? '') ? v! : null)),
});

/** GET /public/legal/{slug}. */
export const legalQuerySchema = z.object({ version: z.string().max(20).optional().nullable() });

/** GET /public/payouts/recent. */
export const recentPayoutsQuerySchema = z.object({
  per_page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => Math.min(Math.max(Number(v ?? 50) || 50, 1), 50)),
});

/** 13–19 digits passing Luhn: looks like a card number (VR-122). */
export function containsCardNumber(text: string): boolean {
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((c) => {
    const digits = c.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  });
}

/** POST /public/contact (VR-118…VR-124). */
export const contactSchema = z
  .object({
    full_name: lengthBetween(2, 80, 'Enter your name.'),
    email: email().pipe(z.string().min(3, 'Enter a valid email so we can reply.')),
    topic: z.enum(CONTACT_TOPIC.values as unknown as [string, ...string[]], { errorMap: () => ({ message: 'Choose a topic.' }) }),
    account_public_id: z
      .union([z.string().regex(/^[0-9]{6}$/, 'Account IDs have 6 digits, e.g. 482910.'), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    message: z.string({ required_error: 'Tell us what happened (10–300 characters).' }).transform((s) => s.trim()),
    consent: z.literal(true, { errorMap: () => ({ message: 'Tick the box so we can reply by email.' }) }),
    website: z.string().optional().nullable(),
    bot_token: z.string().max(2048).optional().nullable(),
    is_appeal: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    const len = [...v.message].length;
    const [min, max] = v.is_appeal ? [20, 1000] : [10, 300];
    if (len < min || len > max)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: v.is_appeal ? 'Tell us what happened (20–1,000 characters).' : 'Tell us what happened (10–300 characters).',
      });
    else if (containsCardNumber(v.message))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message: "Don't include full card numbers." });
  });
export type ContactInput = z.input<typeof contactSchema>;
