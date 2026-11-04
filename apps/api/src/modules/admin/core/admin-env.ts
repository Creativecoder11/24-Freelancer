import { createHmac } from 'node:crypto';
import { decodeSecret } from '../../../config/env.schema';
import { getEnv } from '../../../config/env';

/**
 * Admin-only environment (Doc 09 §2.2, §22; Doc 11 §4). Read from process.env with the
 * documented defaults, so the shared env schema stays untouched.
 */
const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const int = (v: string | undefined, def: number) => {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isFinite(n) ? def : n;
};

export function adminEnv() {
  getEnv(); // ensures .env files are loaded
  const e = process.env;
  const prod = getEnv().APP_ENV === 'production';
  return {
    /** Mandatory per spec; `ADMIN_TOTP_REQUIRED=false` relaxes it for local dev only. Forced on in production. */
    totpRequired: prod ? true : bool(e.ADMIN_TOTP_REQUIRED, true),
    idleMinutes: int(e.ADMIN_SESSION_IDLE_MINUTES, 30),
    idleMinutesPrivileged: int(e.ADMIN_SESSION_IDLE_MINUTES_PRIVILEGED, 15),
    maxHours: int(e.ADMIN_SESSION_MAX_HOURS, 12),
    reauthWindowMinutes: int(e.ADMIN_REAUTH_WINDOW_MINUTES, 10),
    accessTtlSeconds: int(e.ADMIN_ACCESS_TTL_SECONDS, 900),
    maxSessions: int(e.ADMIN_MAX_SESSIONS, 3),
    loginPer15Min: int(e.RATE_LIMIT_ADMIN_LOGIN_PER_15_MINUTES, 5),
    ipAllowlist: (e.ADMIN_IP_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieName: e.ADMIN_REFRESH_COOKIE_NAME || 'fl_admin_rt',
    cookieSecure: getEnv().COOKIE_SECURE,
    adminAppUrl: getEnv().ADMIN_APP_URL,
    webAppUrl: getEnv().WEB_APP_URL,
    payoutDualThresholdFallback: '100.00',
  };
}

let secret: Buffer | null = null;
/** ADMIN_JWT_ACCESS_SECRET, or a key derived from JWT_ACCESS_SECRET so user and admin tokens never share a key. */
export function adminJwtSecret(): Buffer {
  if (secret) return secret;
  const raw = process.env.ADMIN_JWT_ACCESS_SECRET;
  secret = raw ? decodeSecret(raw) : createHmac('sha256', decodeSecret(getEnv().JWT_ACCESS_SECRET)).update('24f-admin-access-v1').digest();
  return secret;
}

export const ADMIN_AUD = '24f-admin';
export const ADMIN_SETUP_AUD = '24f-admin-setup';
export const ADMIN_COOKIE_PATH = '/api/v1/admin/auth';
