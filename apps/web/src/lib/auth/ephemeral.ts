'use client';
import type { PasswordResetTokenResponse } from '@24f/shared';

/**
 * Short-lived single-use credentials kept in memory only (Doc 03 §6.3). A hard refresh loses
 * them on purpose: the user starts the reset again.
 */
let reset: PasswordResetTokenResponse | null = null;

export const ephemeral = {
  setReset(v: PasswordResetTokenResponse) {
    reset = v;
  },
  getReset(): PasswordResetTokenResponse | null {
    if (reset && new Date(reset.reset_token_expires_at).getTime() < Date.now()) reset = null;
    return reset;
  },
  clearReset() {
    reset = null;
  },
};
