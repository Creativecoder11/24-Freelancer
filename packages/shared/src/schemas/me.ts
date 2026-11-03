import { z } from 'zod';
import { INTEREST_DEVICE, INTEREST_TIME, PAYOUT_METHOD_TYPE, PUBLIC_CATEGORY_SLUGS } from '../enums';
import { countryCode, email, fullName, lengthBetween, password, uuid } from './common';
import { BD_MOBILE_LOCAL_RE, toLocalBdMobile } from '../identifier';

const modeEnum = z.enum(['worker', 'employer'], { errorMap: () => ({ message: 'Pick one to continue.' }) });

/** PATCH /me (VR-027, VR-030). */
export const updateMeSchema = z
  .object({
    full_name: fullName().optional(),
    country_code: countryCode().optional(),
  })
  .strict();
export type UpdateMeInput = z.input<typeof updateMeSchema>;

/** PATCH /me/preferences. */
export const preferencesSchema = z
  .object({
    active_mode: modeEnum.optional(),
    default_mode: modeEnum.nullable().optional(),
    email_digest_enabled: z.boolean().optional(),
    setup_card_dismissed: z.boolean().optional(),
  })
  .strict();
export type PreferencesInput = z.input<typeof preferencesSchema>;

const categoriesList = z
  .array(z.string(), { invalid_type_error: 'Choose task types from the list.' })
  .max(9, 'Choose task types from the list.')
  .transform((list) => Array.from(new Set(list)))
  .refine((list) => list.every((s) => (PUBLIC_CATEGORY_SLUGS as string[]).includes(s)), {
    message: 'Choose task types from the list.',
  });

/** PUT /me/interests (VR-031). */
export const interestsSchema = z
  .object({
    categories: categoriesList,
    interest_time: z.enum(INTEREST_TIME.values as unknown as [string, ...string[]]).nullable().optional(),
    interest_device: z.enum(INTEREST_DEVICE.values as unknown as [string, ...string[]]).nullable().optional(),
  })
  .strict();
export type InterestsInput = z.input<typeof interestsSchema>;

/** Website VR-039: http(s) URL or bare domain, normalised to https://, ≤ 200 chars. */
export const websiteUrl = () =>
  z
    .string()
    .transform((s) => s.trim())
    .transform((s) => (s && !/^https?:\/\//i.test(s) ? `https://${s}` : s))
    .refine(
      (s) => {
        if (s.length > 200) return false;
        try {
          const u = new URL(s);
          return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
        } catch {
          return false;
        }
      },
      { message: 'Enter a valid website, e.g. shelfwise.com.' },
    );

/** Payout account per method (VR-047…VR-050). */
export function payoutAccountValid(method: string, account: string): boolean {
  const a = account.trim();
  switch (method) {
    case 'bkash':
    case 'nagad':
      return BD_MOBILE_LOCAL_RE.test(toLocalBdMobile(a));
    case 'rocket':
      return /^01[3-9][0-9]{8,9}$/.test(a.replace(/[\s-]/g, ''));
    case 'usdt_trc20':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    default:
      return false;
  }
}

/** POST /me/onboarding (VR-022…VR-026, VR-038…VR-040). */
export const onboardingSchema = z
  .discriminatedUnion('step', [
    z.object({ step: z.literal('role'), role: modeEnum }),
    z.object({
      step: z.literal('interests'),
      categories: categoriesList.optional().default([]),
      interest_time: z.enum(INTEREST_TIME.values as unknown as [string, ...string[]]).nullable().optional(),
      interest_device: z.enum(INTEREST_DEVICE.values as unknown as [string, ...string[]]).nullable().optional(),
    }),
    z.object({
      step: z.literal('payout'),
      method_type: z.enum(PAYOUT_METHOD_TYPE.values as unknown as [string, ...string[]], {
        errorMap: () => ({ message: 'Choose where to send your money.' }),
      }),
      account: z.string({ required_error: 'Enter the account number.' }).transform((s) => s.trim()),
      is_default: z.boolean().optional().default(true),
    }),
    z.object({
      step: z.literal('business'),
      business_name: lengthBetween(2, 80, 'Enter your business name (2–80 characters).'),
      website_url: z
        .union([websiteUrl(), z.literal(''), z.null()])
        .optional()
        .transform((v) => (v ? v : null)),
      industry: z.string().max(60, 'Choose an industry from the list.').nullable().optional(),
    }),
    z.object({ step: z.literal('skip') }),
  ])
  .superRefine((v, ctx) => {
    if (v.step === 'payout' && !payoutAccountValid(v.method_type, v.account))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['account'],
        message:
          v.method_type === 'usdt_trc20'
            ? 'Enter a TRC20 address that starts with T (34 characters).'
            : 'Enter an 11-digit mobile number starting with 01.',
      });
  });
export type OnboardingInput = z.input<typeof onboardingSchema>;

/** POST /me/avatar (VR-032). */
export const avatarSchema = z.object({ upload_id: uuid().nullable() });
export type AvatarInput = z.input<typeof avatarSchema>;

/** POST /me/password (VR-033, VR-034). */
export const changePasswordSchema = z
  .object({
    current_password: z.string({ required_error: "That password isn't right." }).min(1, "That password isn't right."),
    new_password: password('Your new password must meet all 4 requirements.'),
    confirm_password: z.string({ required_error: "Passwords don't match." }),
  })
  .refine((v) => v.new_password === v.confirm_password, { message: "Passwords don't match.", path: ['confirm_password'] });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/**
 * PATCH /me/security. `withdrawal_password_required` is not accepted (C-25): `.strict()`
 * makes sending it a VALIDATION_FAILED.
 */
export const securitySchema = z
  .object({
    two_step_enabled: z.boolean({ required_error: 'Choose on or off.' }),
    password: z.string().optional(),
  })
  .strict();
export type SecurityInput = z.input<typeof securitySchema>;

/** POST /me/contact/change (VR-028, VR-029). */
export const contactChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('email'), value: email(), password: z.string().min(1, "That password isn't right.") }),
  z.object({
    kind: z.literal('phone'),
    value: z
      .string()
      .transform((s) => toLocalBdMobile(s.trim()))
      .refine((s) => BD_MOBILE_LOCAL_RE.test(s), { message: 'Enter an 11-digit mobile number starting with 01.' }),
    password: z.string().min(1, "That password isn't right."),
  }),
]);
export type ContactChangeInput = z.input<typeof contactChangeSchema>;

/** POST /me/close (VR-035, VR-036). */
export const closeAccountSchema = z
  .object({
    dry_run: z.boolean().optional().default(false),
    password: z.string().optional(),
    confirm_text: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.dry_run) return;
    if (!v.password) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: "That password isn't right." });
    if ((v.confirm_text ?? '').trim().toUpperCase() !== 'CLOSE')
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm_text'], message: 'Type CLOSE to confirm.' });
  });
export type CloseAccountInput = z.input<typeof closeAccountSchema>;

/** POST /me/terms/accept. */
export const termsAcceptSchema = z.object({
  terms_version: z.string().min(1).max(20),
  accepted: z.literal(true, {
    errorMap: () => ({ message: 'Tick the box to accept the Terms & conditions and Privacy policy.' }),
  }),
});
export type TermsAcceptInput = z.input<typeof termsAcceptSchema>;

/** Re-export for forms that need the raw password rule. */
export { password as passwordRule };
