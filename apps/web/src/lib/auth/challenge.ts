'use client';
import type { OtpChallengeResponse, OtpPurpose } from '@24f/shared';

/** OTP challenge handoff between pages (Doc 03 §6.3). No code or token is stored. */
export interface StoredChallenge {
  challenge_id: string;
  purpose: OtpPurpose;
  destination_masked: string;
  expires_at: string;
  resend_available_at: string;
  keep_signed_in?: boolean;
  next?: string | null;
  /** The identifier typed on the previous form, so "Change number" can restore it. */
  identifier?: string;
  /** Page to return to from "Change number". */
  back?: string;
}

const KEY = 'fl_otp_challenge';

export function storeChallenge(c: OtpChallengeResponse, extra: Partial<StoredChallenge> = {}) {
  const v: StoredChallenge = {
    challenge_id: c.challenge_id,
    purpose: c.purpose,
    destination_masked: c.destination_masked,
    expires_at: c.expires_at,
    resend_available_at: c.resend_available_at,
    ...extra,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
  return v;
}

export function readChallenge(): StoredChallenge | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredChallenge) : null;
  } catch {
    return null;
  }
}

export function clearChallenge() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Prefill for the form a user returns to with "Change number" / "Back". */
const PREFILL = 'fl_auth_prefill';
export function setPrefill(identifier: string) {
  try {
    sessionStorage.setItem(PREFILL, identifier);
  } catch {
    /* ignore */
  }
}
export function takePrefill(): string | null {
  try {
    const v = sessionStorage.getItem(PREFILL);
    sessionStorage.removeItem(PREFILL);
    return v;
  } catch {
    return null;
  }
}
