import { z } from 'zod';
import { countryCode, fullName, identifier, otpCode, password, referralCode, uuid } from './common';

/** POST /auth/register (VR-001…VR-009). */
export const registerSchema = z.object({
  signup_role: z
    .enum(['worker', 'employer'], { errorMap: () => ({ message: 'Choose how you want to start.' }) })
    .default('worker'),
  full_name: fullName(),
  identifier: identifier('Enter your email or phone.'),
  password: password(),
  country_code: countryCode().default('BD'),
  referral_code: z
    .union([referralCode(), z.literal('').transform(() => null), z.null()])
    .optional()
    .transform((v) => v ?? null),
  terms_accepted: z.literal(true, {
    errorMap: () => ({ message: 'Tick the box to accept the Terms & conditions and Privacy policy.' }),
  }),
});
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterBody = z.output<typeof registerSchema>;

/** POST /auth/login (VR-010, VR-011). */
export const loginSchema = z.object({
  identifier: identifier('Enter your email or phone.'),
  password: z
    .string({ required_error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(128, "That email/phone and password don't match. Try again or reset your password."),
  keep_signed_in: z.boolean().optional().default(true),
});
export type LoginInput = z.input<typeof loginSchema>;
export type LoginBody = z.output<typeof loginSchema>;

/** POST /auth/login/otp (VR-013). */
export const loginOtpSchema = z.object({
  identifier: identifier('Enter your email or phone.'),
  keep_signed_in: z.boolean().optional().default(true),
});
export type LoginOtpInput = z.input<typeof loginOtpSchema>;

/** POST /auth/otp/verify (VR-014). */
export const otpVerifySchema = z.object({
  challenge_id: uuid('This code has expired. Request a new one.'),
  code: otpCode(),
  keep_signed_in: z.boolean().optional(),
});
export type OtpVerifyInput = z.input<typeof otpVerifySchema>;

/** POST /auth/otp/resend. */
export const otpResendSchema = z.object({
  challenge_id: uuid('This code has expired. Request a new one.'),
});
export type OtpResendInput = z.input<typeof otpResendSchema>;

/** POST /auth/password/forgot (VR-017). */
export const forgotPasswordSchema = z.object({
  identifier: identifier('Enter the email or phone you signed up with.'),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

/** POST /auth/password/reset (VR-018…VR-021). */
export const resetPasswordSchema = z
  .object({
    reset_token: z.string({ required_error: 'This reset link has expired. Start again.' }).min(10, 'This reset link has expired. Start again.'),
    new_password: password('Your new password must meet all 4 requirements.'),
    confirm_password: z.string({ required_error: "Passwords don't match." }),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "Passwords don't match.",
    path: ['confirm_password'],
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
