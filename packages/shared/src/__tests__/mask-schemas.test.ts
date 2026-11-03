import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SLUG,
  ERROR_CODES,
  JOB_STATUS,
  SUBMISSION_STATUS,
  closeAccountSchema,
  contactSchema,
  containsCardNumber,
  enumLabel,
  enumTone,
  initials,
  isErrorCode,
  kycSubmitSchema,
  loginSchema,
  maskCrypto,
  maskEmail,
  maskName,
  maskPhoneAuth,
  maskPhoneWallet,
  normalisePerPage,
  normaliseIdentifier,
  publicJobsQuerySchema,
  registerSchema,
  resetPasswordSchema,
  securitySchema,
  uploadTooLargeMessage,
} from '../index';

describe('masking (Canonical §5, Doc 04 §4.5)', () => {
  it('masks names', () => {
    expect(maskName('Rakibun Hasan')).toBe('Ra***n');
    expect(maskName('Nusrat Jahan')).toBe('Nu***t');
    expect(maskName('Kasem Mia')).toBe('Ka***m');
    expect(maskName('Abu')).toBe('A***u');
    expect(maskName('Al')).toBe('A***');
    expect(maskName('')).toBe('Wo***r');
  });

  it('masks phones', () => {
    expect(maskPhoneAuth('+8801712345569')).toBe('+880 17•• ••• 569');
    expect(maskPhoneWallet('01712345569')).toBe('017••• ••569');
    expect(maskPhoneWallet('+8801712345569', 'tight')).toBe('017•••569');
  });

  it('masks crypto and email', () => {
    expect(maskCrypto('T9xAbCdEfGhJkLmNpQrStUvWxYz12345k2a')).toBe('T9x…k2a');
    expect(maskEmail('nusrat.j@example.com')).toBe('nu•••@example.com');
  });

  it('builds initials', () => {
    expect(initials('Nusrat Jahan')).toBe('NJ');
    expect(initials('Shelfwise')).toBe('SH');
  });
});

describe('identifiers (A-52)', () => {
  it('normalises BD phones to E.164', () => {
    expect(normaliseIdentifier('017-1234 5569')).toMatchObject({ kind: 'phone', phone: '+8801712345569' });
    expect(normaliseIdentifier('+8801712345569')).toMatchObject({ kind: 'phone', phone: '+8801712345569' });
    expect(normaliseIdentifier('01212345569')).toBeNull();
  });

  it('lower-cases emails', () => {
    expect(normaliseIdentifier(' Nusrat.J@Example.com ')).toMatchObject({ kind: 'email', email: 'nusrat.j@example.com' });
    expect(normaliseIdentifier('a@b')).toBeNull();
  });
});

describe('enums and errors', () => {
  it('maps codes to labels and tones', () => {
    expect(enumLabel(JOB_STATUS, 'suspended')).toBe('Suspended by admin');
    expect(enumTone(JOB_STATUS, 'running')).toBe('success');
    expect(enumTone(SUBMISSION_STATUS, 'needs_fix')).toBe('danger');
    expect(enumLabel(CATEGORY_SLUG, 'data-entry')).toBe('Data entry');
    expect(enumLabel(JOB_STATUS, 'unknown_future')).toBe('unknown_future');
  });

  it('catalogues error codes', () => {
    expect(ERROR_CODES.VALIDATION_FAILED.status).toBe(422);
    expect(ERROR_CODES.OTP_EXPIRED.status).toBe(410);
    expect(isErrorCode('REFRESH_RACE')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
  });

  it('builds upload messages', () => {
    expect(uploadTooLargeMessage('proof_screenshot')).toBe('That file is larger than 5 MB');
  });
});

describe('request schemas', () => {
  it('validates sign-up (VR-001…VR-009)', () => {
    const ok = registerSchema.safeParse({
      full_name: 'Nusrat Jahan',
      identifier: '01712345569',
      password: 'Sunny#2026',
      terms_accepted: true,
      referral_code: 'nusrat24',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.signup_role).toBe('worker');
      expect(ok.data.country_code).toBe('BD');
      expect(ok.data.referral_code).toBe('NUSRAT24');
    }
    const bad = registerSchema.safeParse({ full_name: 'N', identifier: 'nusrat@example', password: 'short', terms_accepted: false });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const fields = bad.error.flatten().fieldErrors;
      expect(fields.full_name?.[0]).toBe('Enter your full name (2–80 letters).');
      expect(fields.identifier?.[0]).toContain('missing a “.” before the domain');
      expect(fields.password?.[0]).toBe('Use at least 8 characters with a number and a symbol.');
      expect(fields.terms_accepted?.[0]).toBe('Tick the box to accept the Terms & conditions and Privacy policy.');
    }
  });

  it('defaults keep_signed_in on login', () => {
    const r = loginSchema.parse({ identifier: 'nusrat.j@example.com', password: 'x' });
    expect(r.keep_signed_in).toBe(true);
  });

  it('checks reset password confirmation', () => {
    const r = resetPasswordSchema.safeParse({ reset_token: 'abcdefghijkl', new_password: 'Sunny#2026', confirm_password: 'Sunny#2027' });
    expect(r.success).toBe(false);
  });

  it('refuses withdrawal_password_required on security (C-25)', () => {
    expect(securitySchema.safeParse({ two_step_enabled: true, withdrawal_password_required: false }).success).toBe(false);
  });

  it('requires CLOSE unless dry_run', () => {
    expect(closeAccountSchema.safeParse({ dry_run: true }).success).toBe(true);
    expect(closeAccountSchema.safeParse({ password: 'x', confirm_text: 'close' }).success).toBe(true);
    expect(closeAccountSchema.safeParse({ password: 'x', confirm_text: 'nope' }).success).toBe(false);
  });

  it('validates KYC numbers and age', () => {
    const base = {
      document_type: 'national_id',
      name_on_document: 'Nusrat Jahan',
      document_number: '1234567890',
      date_of_birth: '1995-01-01',
      front_upload_id: '0192aaaa-0000-7000-8000-000000900002',
      back_upload_id: '0192aaaa-0000-7000-8000-000000900003',
      selfie_upload_id: '0192aaaa-0000-7000-8000-000000900004',
    };
    expect(kycSubmitSchema.safeParse(base).success).toBe(true);
    expect(kycSubmitSchema.safeParse({ ...base, document_number: '123' }).success).toBe(false);
    expect(kycSubmitSchema.safeParse({ ...base, date_of_birth: '2015-01-01' }).success).toBe(false);
    expect(kycSubmitSchema.safeParse({ ...base, back_upload_id: null }).success).toBe(false);
  });

  it('normalises job filters and ignores unknown values (VR-128)', () => {
    const q = publicJobsQuerySchema.parse({ category: 'surveys,nope,writing', sort: 'weird', per_page: '7', time: ['under_5', 'x'] });
    expect(q.category).toEqual(['surveys', 'writing']);
    expect(q.time).toEqual(['under_5']);
    expect(q.sort).toBe('newest');
    expect(q.per_page).toBe(6);
    expect(q.page).toBe(1);
    expect(normalisePerPage('100', 8)).toBe(50);
  });

  it('refuses card numbers in contact messages (VR-122)', () => {
    expect(containsCardNumber('my card 4111 1111 1111 1111 please')).toBe(true);
    expect(containsCardNumber('account 482910')).toBe(false);
    const r = contactSchema.safeParse({
      full_name: 'Nusrat',
      email: 'nusrat.j@example.com',
      topic: 'payments_withdrawals',
      message: 'Card 4111111111111111 was charged',
      consent: true,
    });
    expect(r.success).toBe(false);
  });
});
