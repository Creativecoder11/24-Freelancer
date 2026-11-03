import { z } from 'zod';
import { PER_PAGE_VALUES } from '../enums';
import { BD_MOBILE_LOCAL_RE, EMAIL_RE, emailErrorMessage, toLocalBdMobile } from '../identifier';

/** Trimmed string (Doc 06 §1.4: the server trims before validation). Lengths count Unicode characters. */
export const trimmed = () => z.string().transform((s) => s.trim());

export function lengthBetween(min: number, max: number, message: string) {
  return z
    .string({ required_error: message, invalid_type_error: message })
    .transform((s) => s.trim())
    .refine((s) => [...s].length >= min && [...s].length <= max, { message });
}

export const uuid = (message = 'Invalid ID.') => z.string().uuid({ message });

/** Query booleans accept 1/0 and true/false (Doc 06 §1.4). */
export const queryBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (typeof v === 'boolean' ? v : v === '1' || v === 'true'));

/** Multi-value query param: repeated or comma-separated (Doc 06 §1.8). */
export const queryList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [] as string[];
    const arr = Array.isArray(v) ? v : [v];
    return arr
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  });

/** `page` ≥ 1, default 1. */
export const queryPage = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    const n = Math.floor(Number(v ?? 1));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  });

/** Rounds `per_page` down to the nearest allowed value (Doc 06 §1.7, VR-131). */
export function normalisePerPage(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  let chosen: number = PER_PAGE_VALUES[0];
  for (const allowed of PER_PAGE_VALUES) if (allowed <= n) chosen = allowed;
  return chosen;
}

export const queryPerPage = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? fallback : normalisePerPage(v, fallback)));

/** Decimal money string on the wire (Doc 06 §1.5): a JSON number is rejected. */
export const moneyString = (message = 'Enter an amount.') =>
  z.string({ invalid_type_error: message, required_error: message }).regex(/^\d+(\.\d+)?$/, { message });

/** Email (VR-003). */
export const email = () =>
  z
    .string({ required_error: 'Enter a valid email address.' })
    .transform((s) => s.trim().toLowerCase())
    .superRefine((s, ctx) => {
      if (s.length > 254 || !EMAIL_RE.test(s)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: emailErrorMessage(s) });
    });

/** Email or BD mobile (VR-003, VR-004, VR-010). */
export const identifier = (emptyMessage = 'Enter your email or phone.') =>
  z
    .string({ required_error: emptyMessage, invalid_type_error: emptyMessage })
    .transform((s) => s.trim())
    .superRefine((s, ctx) => {
      if (!s) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: emptyMessage });
        return;
      }
      if (s.includes('@')) {
        if (s.length > 254 || !EMAIL_RE.test(s.toLowerCase()))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: emailErrorMessage(s) });
        return;
      }
      if (!BD_MOBILE_LOCAL_RE.test(toLocalBdMobile(s)))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an 11-digit mobile number starting with 01, or an email.' });
    });

/** A small list of very common passwords (BR-080). The API may extend it. */
export const COMMON_PASSWORDS = new Set([
  'password123!', 'p@ssw0rd', 'p@ssword1', 'qwerty123!', '12345678!', 'abc12345!', 'welcome1!',
  'letmein1!', 'admin123!', 'iloveyou1!', 'bangladesh1!', 'passw0rd!', 'qwerty1!', 'monkey123!', '123456789!',
]);

export const PASSWORD_MESSAGE = 'Use at least 8 characters with a number and a symbol.';

export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 8) problems.push('length');
  if (pw.length > 128) problems.push('max_length');
  if (!/[0-9]/.test(pw)) problems.push('digit');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('symbol');
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) problems.push('common');
  return problems;
}

/** Password policy BR-080 (VR-006, VR-018, VR-034). Not trimmed. */
export const password = (message = PASSWORD_MESSAGE) =>
  z
    .string({ required_error: message, invalid_type_error: message })
    .refine((pw) => passwordProblems(pw).length === 0, { message });

/** Full name VR-002: 2–80 chars; letters, spaces, `.`, `'`, `-`; at least one letter. */
export const fullName = () =>
  z
    .string({ required_error: 'Enter your full name (2–80 letters).' })
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .refine((s) => [...s].length >= 2 && [...s].length <= 80 && /^[\p{L}\p{M} .'’-]+$/u.test(s) && /\p{L}/u.test(s), {
      message: 'Enter your full name (2–80 letters).',
    });

export const countryCode = () =>
  z
    .string({ required_error: 'Choose your country.' })
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^[A-Z]{2}$/.test(s), { message: 'Choose your country.' });

export const otpCode = () =>
  z
    .string({ required_error: 'Enter all 6 digits.' })
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => /^[0-9]{6}$/.test(s), { message: 'Enter all 6 digits.' });

/** Referral code VR-008: 4–12 A–Z0–9 after upper-casing. */
export const referralCode = () =>
  z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => /^[A-Z0-9]{4,12}$/.test(s), {
      message: "We couldn't find that referral code. Check it or leave it empty.",
    });

/** Idempotency-Key header format (Doc 06 §1.10). */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
/** X-Request-Id accepted from clients (Doc 06 §1.11). */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
