/**
 * Error code catalogue (Doc 06 §4.3, plus the v1.2 additions in Canonical §16.5).
 *
 * Clients branch on `code`, never on `message` or HTTP status alone. `message` is the
 * default human copy; the API may send a more specific message for the same code
 * (e.g. "That code isn't right. 4 tries left.").
 */

export interface ErrorCodeDef {
  /** HTTP status. `null` for codes that are not errors (WITHDRAWAL_UNDER_REVIEW is a warning code). */
  readonly status: number | null;
  readonly message: string;
}

export const ERROR_CODES = {
  // ----- General -----
  BAD_REQUEST: { status: 400, message: "We couldn't read that request. Refresh the page and try again." },
  VALIDATION_FAILED: { status: 422, message: 'Check the highlighted fields and try again.' },
  NOT_FOUND: { status: 404, message: "We can't find that page" },
  FORBIDDEN: { status: 403, message: "You don't have access to this." },
  INVALID_STATE: { status: 409, message: "This can't be done right now. Refresh and try again." },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'That request is too large.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Send the request as JSON.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Wait a moment and try again.' },
  FEATURE_DISABLED: { status: 403, message: "This isn't available right now." },
  MAINTENANCE: {
    status: 503,
    message: "We're making improvements. 24 Freelancing will be back shortly. Your balance and tasks are safe.",
  },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong on our side. Try again in a moment.' },
  PROVIDER_UNAVAILABLE: { status: 502, message: "We couldn't reach the payment provider. Try again or pick another method." },
  TEMPORARILY_UNAVAILABLE: { status: 503, message: 'Something took too long. Try again.' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Refresh the page and try again.' },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This request was already sent with different details. Refresh and try again.',
  },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, message: "We're still working on your last request." },

  // ----- Authentication and account -----
  UNAUTHENTICATED: { status: 401, message: 'Sign in to continue.' },
  TOKEN_EXPIRED: { status: 401, message: 'Your session needs refreshing.' },
  SESSION_EXPIRED: { status: 401, message: 'Your session ended. Sign in again.' },
  REFRESH_RACE: { status: 409, message: 'Your session is refreshing. Try again.' },
  INVALID_CREDENTIALS: {
    status: 401,
    message: "That email/phone and password don't match. Try again or reset your password.",
  },
  INVALID_PASSWORD: { status: 401, message: "That password isn't right." },
  TOO_MANY_ATTEMPTS: { status: 429, message: 'Too many attempts. Try again in 15 minutes or reset your password.' },
  IDENTIFIER_TAKEN: { status: 409, message: 'An account already uses this email or phone. Sign in instead.' },
  ACCOUNT_RESTRICTED: {
    status: 403,
    message: "Your account is restricted. You can't start jobs, publish jobs or withdraw.",
  },
  ACCOUNT_SUSPENDED: { status: 403, message: 'Your account is suspended. Contact support to appeal.' },
  ACCOUNT_CLOSED: { status: 403, message: 'This account was closed.' },
  VERIFICATION_REQUIRED: { status: 403, message: 'Verify your email or phone first.' },
  OTP_INVALID: { status: 422, message: "That code isn't right. 4 tries left." },
  OTP_EXPIRED: { status: 410, message: 'This code has expired. Request a new one.' },
  OTP_REQUIRED: { status: 428, message: 'Enter the code we sent you to continue.' },
  OTP_RESEND_TOO_SOON: { status: 429, message: 'You can request a new code in a moment.' },
  OTP_DELIVERY_FAILED: { status: 503, message: "We couldn't send the code. Try again in a moment." },
  RESET_TOKEN_EXPIRED: { status: 410, message: 'This reset link has expired. Start again.' },
  PASSWORD_REUSED: { status: 422, message: "Choose a password you haven't used here before." },
  CLOSE_BLOCKED: { status: 409, message: "Withdraw your balance first. Closing is permanent and can't be undone." },
  SESSION_NOT_FOUND: { status: 404, message: 'This session has already ended.' },

  // ----- Uploads and KYC -----
  UPLOAD_TYPE_NOT_ALLOWED: { status: 422, message: 'Use a PNG or JPG image.' },
  UPLOAD_TOO_LARGE: { status: 422, message: 'That file is larger than 5 MB' },
  UPLOAD_NOT_READY: { status: 409, message: 'Your file is still processing. Try again in a moment.' },
  UPLOAD_REJECTED: { status: 422, message: "We couldn't accept this file. Upload a different file." },
  KYC_REQUIRED: { status: 403, message: 'Verify your identity to withdraw.' },
  KYC_ALREADY_SUBMITTED: { status: 409, message: 'Your documents are already being reviewed.' },
  KYC_DOCUMENT_IN_USE: { status: 409, message: 'This document is already used by another account.' },
  KYC_ATTEMPTS_EXCEEDED: { status: 409, message: "You've used all your verification attempts. Contact support." },

  // ----- Worker jobs and submissions -----
  JOB_NOT_AVAILABLE: { status: 409, message: 'This job is no longer taking new workers.' },
  NO_SLOTS_LEFT: { status: 409, message: 'All slots are taken' },
  ALREADY_SUBMITTED: { status: 409, message: "You've already done this job" },
  NOT_ELIGIBLE: { status: 403, message: "You're not eligible for this job." },
  OWN_JOB: { status: 403, message: 'This is your own job' },
  RESERVATION_LIMIT: { status: 409, message: 'You already have 3 jobs in progress. Submit or release one first.' },
  RESERVATION_EXPIRED: {
    status: 410,
    message: "Your slot expired, so this submission couldn't be sent. Your draft was not kept.",
  },
  RESUBMIT_NOT_ALLOWED: { status: 409, message: 'The resubmit deadline has passed.' },
  NOT_DISPUTABLE: { status: 422, message: 'You can dispute a decision once, within 72 hours.' },
  DISPUTE_WINDOW_CLOSED: { status: 422, message: 'You can dispute a decision once, within 72 hours.' },
  DISPUTE_EXISTS: { status: 409, message: 'You can dispute a decision once, within 72 hours.' },
  DISPUTE_WITHDRAWN: { status: 409, message: 'The worker withdrew this dispute.' },
  DISPUTE_NOT_WITHDRAWABLE: { status: 409, message: 'This dispute has already been decided.' },
  ALREADY_REPORTED: { status: 409, message: "You've already reported this job. We're looking into it." },

  // ----- Employer jobs and review -----
  JOB_LOCKED: {
    status: 409,
    message: "This can't be changed after the first submission. Duplicate the job to change it.",
  },
  JOB_SUSPENDED: {
    status: 409,
    message: "This job was suspended by 24 Freelancing. Contact us if you think it's a mistake.",
  },
  JOB_NOT_DELETABLE: { status: 409, message: "Published jobs can't be deleted. Close the job instead." },
  JOB_INCOMPLETE: { status: 422, message: 'Finish all the steps before publishing.' },
  JOB_CONTENT_BLOCKED: { status: 422, message: "This job can't be published." },
  POSTING_RULES_REQUIRED: { status: 422, message: 'Confirm the job follows the posting rules.' },
  QUOTE_CHANGED: { status: 409, message: 'The cost changed. Check the new amount and publish again.' },
  INSUFFICIENT_BALANCE: { status: 422, message: 'Not enough balance. Add funds or lower the amount.' },
  RECEIVABLE_OUTSTANDING: { status: 422, message: 'Add funds to clear your balance first.' },
  JOB_EXTENSION_LIMIT: { status: 422, message: 'A job can stay open for up to 90 days in total.' },
  ALREADY_DECIDED: { status: 409, message: 'This submission was already decided.' },
  FIX_NOT_ALLOWED: { status: 422, message: "Resubmission isn't available for this submission." },
  INSUFFICIENT_RESERVE: { status: 409, message: "We couldn't complete this approval. Our team has been told." },

  // ----- Wallet, withdrawals and deposits -----
  PAYOUT_METHOD_INVALID: { status: 422, message: 'Choose where to send your money.' },
  PAYOUT_METHOD_COOLDOWN: { status: 422, message: "You can't use this payout method yet." },
  PAYOUT_METHOD_EXISTS: { status: 409, message: "You've already saved this account." },
  PAYOUT_METHOD_LIMIT: { status: 422, message: 'You can save up to 5 payout methods. Remove one first.' },
  PAYOUT_METHOD_IN_USE: { status: 409, message: "This method has a withdrawal on the way. Try again after it's paid." },
  METHOD_UNAVAILABLE: { status: 422, message: "This method isn't available right now. Pick another one." },
  AMOUNT_PRECISION: { status: 422, message: 'Use at most 2 decimal places.' },
  AMOUNT_BELOW_MINIMUM: { status: 422, message: 'The amount is below the minimum.' },
  AMOUNT_ABOVE_MAXIMUM: { status: 422, message: 'The amount is above the maximum.' },
  AMOUNT_BELOW_FEE: { status: 422, message: 'The amount must be more than the fee.' },
  DAILY_LIMIT_EXCEEDED: { status: 422, message: "You've reached today's limit." },
  DAILY_COUNT_EXCEEDED: { status: 422, message: 'You can make 3 withdrawal requests a day.' },
  MONTHLY_LIMIT_EXCEEDED: { status: 422, message: "You've reached this month's limit of $3,000.00." },
  QUOTE_EXPIRED: { status: 409, message: 'The rate changed. Check the new amount and confirm again.' },
  FX_RATE_STALE: { status: 409, message: 'Rates are being updated. Try again in a few minutes.' },
  WITHDRAWAL_NOT_CANCELLABLE: {
    status: 409,
    message: "This request is already being processed and can't be cancelled.",
  },
  WITHDRAWAL_UNDER_REVIEW: {
    status: null,
    message: "We're reviewing this request for your security. It may take up to 24 hours longer.",
  },
  EXPORT_TOO_LARGE: { status: 422, message: 'Choose a date range of up to 1 year.' },

  // ----- Referral -----
  REMINDER_COOLDOWN: { status: 429, message: 'You sent a reminder recently. Try again later.' },
  FRIEND_ALREADY_ACTIVE: { status: 409, message: 'This friend has already started.' },

  // ----- Admin -----
  ADMIN_FORBIDDEN: { status: 403, message: "Your role can't do this." },
  ADMIN_TOTP_REQUIRED: { status: 401, message: 'Enter the code from your authenticator app.' },
  ADMIN_TOTP_INVALID: { status: 401, message: "That code isn't right. Check your authenticator app." },
  ADMIN_REAUTH_REQUIRED: { status: 401, message: "Enter the code from your authenticator app to confirm it's you." },
  SELF_APPROVAL_FORBIDDEN: { status: 403, message: 'A different admin must approve this.' },
  REASON_REQUIRED: { status: 422, message: "Enter a reason. It's kept in the audit log." },
  DUPLICATE_PROVIDER_TXN: { status: 409, message: 'This TrxID is already recorded on another withdrawal.' },
  REFUND_EXCEEDS_AVAILABLE: { status: 422, message: 'The refund is more than the refundable amount.' },
  REFUND_WINDOW_CLOSED: { status: 422, message: 'This deposit is past the 30-day refund window.' },
  SETTING_CONFLICT: { status: 409, message: 'Someone else changed this setting. Reload and try again.' },
  SETTING_OUT_OF_RANGE: { status: 422, message: "That value isn't allowed for this setting." },
  FX_CHANGE_CONFIRM_REQUIRED: { status: 409, message: 'This rate is more than 3% from the current one. Confirm to save it.' },
  WITHDRAWAL_ON_HOLD: { status: 409, message: 'This withdrawal is on hold.' },

  // ----- Webhooks -----
  SIGNATURE_INVALID: { status: 401, message: 'Invalid signature.' },
  UNKNOWN_PROVIDER: { status: 404, message: 'Unknown provider.' },
} as const satisfies Record<string, ErrorCodeDef>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Codes only the client produces (network failure, unparseable response). */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNKNOWN';

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, v);
}

export function errorStatus(code: ErrorCode): number {
  return ERROR_CODES[code].status ?? 200;
}

export function errorMessage(code: ErrorCode): string {
  return ERROR_CODES[code].message;
}

/** The wire shape of an error (Doc 06 §4.1). */
export interface ErrorBody {
  code: ErrorCode | string;
  message: string;
  fields: Record<string, string[]>;
  details: Record<string, unknown>;
  request_id: string;
}

export interface ErrorEnvelope {
  error: ErrorBody;
  serverTime: string;
}
