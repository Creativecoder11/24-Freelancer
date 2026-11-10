import { z } from 'zod';

/**
 * Environment schema (Doc 11 §4.3). Parsed once at boot: an invalid value stops the
 * process with a readable error. Secrets accept a `b64:` prefix for base64 values.
 *
 * Add new variables here (with a default when they are optional) and to `.env.example`.
 */

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be an integer' });
        return z.NEVER;
      }
      return n;
    });

const str = (def?: string) => (def === undefined ? z.string().min(1) : z.string().optional().transform((v) => (v === undefined || v === '' ? def : v)));
const optionalStr = () => z.string().optional().transform((v) => (v ? v : undefined));
const list = (def: string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : def));

/** A secret of at least 32 bytes after decoding. */
const secret = () =>
  z.string().refine((v) => decodeSecret(v).length >= 32, { message: 'must be at least 32 bytes (use b64:<base64>)' });

export function decodeSecret(v: string): Buffer {
  return v.startsWith('b64:') ? Buffer.from(v.slice(4), 'base64') : Buffer.from(v, 'utf8');
}

const durationRe = /^(\d+)(s|m|h|d)$/;
const duration = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => v || def)
    .refine((v) => durationRe.test(v), { message: 'use a duration like 15m, 12h, 30d' })
    .transform((v) => {
      const [, n, unit] = durationRe.exec(v)!;
      const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
      return Number(n) * mult; // seconds
    });

export const envSchema = z
  .object({
    // ----- Runtime -----
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']).default('local'),
    PROCESS_ROLE: z.enum(['api', 'worker', 'scheduler', 'migrate', 'all']).default('api'),
    PORT: int(4000),
    API_PREFIX: str('/api/v1'),
    API_PUBLIC_URL: str('http://localhost:4000'),
    WEB_APP_URL: str('http://localhost:3000'),
    ADMIN_APP_URL: str('http://localhost:3001/admin'),
    CDN_PUBLIC_BASE_URL: optionalStr(),
    CORS_ALLOWED_ORIGINS: list(['http://localhost:3000', 'http://localhost:3001']),
    TRUST_PROXY: int(0),
    CLIENT_IP_HEADER: optionalStr(),
    APP_DISPLAY_TZ: str('Asia/Dhaka'),
    SHUTDOWN_GRACE_SECONDS: int(30),

    // ----- Cookies and sessions -----
    COOKIE_SECURE: bool(false),
    REFRESH_COOKIE_NAME: str('fl_rt'),
    SESSION_HINT_COOKIE_NAME: str('fl_session'),
    SESSION_HINT_COOKIE_DOMAIN: optionalStr(),
    DEVICE_COOKIE_NAME: str('fl_did'),
    SESSION_MAX_PER_USER: int(10),

    // ----- JWT -----
    JWT_ISSUER: str('http://localhost:4000'),
    JWT_AUDIENCE: str('24f-web'),
    JWT_ACCESS_SECRET: secret(),
    JWT_ACCESS_SECRET_PREVIOUS: optionalStr(),
    JWT_ACCESS_TTL: duration('15m'),
    JWT_REFRESH_SECRET: secret(),
    JWT_REFRESH_TTL_REMEMBER: duration('30d'),
    JWT_REFRESH_TTL_SESSION: duration('12h'),

    // ----- Passwords -----
    ARGON2_MEMORY_KIB: int(19456),
    ARGON2_TIME_COST: int(2),
    ARGON2_PARALLELISM: int(1),

    // ----- Database and Redis -----
    DATABASE_URL: z.string().url(),
    DATABASE_STATEMENT_TIMEOUT_MS: int(15000),
    DATABASE_LOCK_TIMEOUT_MS: int(5000),
    REDIS_URL: str('redis://127.0.0.1:6379/0'),
    REDIS_KEY_PREFIX: str('24f:local:'),

    // ----- Crypto -----
    PII_KMS_PROVIDER: z.enum(['local', 'aws-kms']).default('local'),
    PII_LOCAL_MASTER_KEY: optionalStr(),
    PII_KEY_VERSION: int(1),
    PII_BLIND_INDEX_KEY: secret(),
    OTP_HMAC_SECRET: secret(),
    LIVECHAT_IDENTITY_SECRET: optionalStr(),

    // ----- Storage (local-disk driver in dev; S3 later) -----
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: str('./.storage'),
    STORAGE_SIGNING_SECRET: secret(),
    S3_BUCKET_PROOFS: str('24f-local-proofs-private'),
    S3_BUCKET_KYC: str('24f-local-kyc-private'),
    S3_BUCKET_PUBLIC: str('24f-local-public-assets'),
    UPLOAD_PRESIGN_PUT_TTL_SECONDS: int(300),
    UPLOAD_PRESIGN_GET_TTL_SECONDS: int(300),
    FEATURE_VIRUS_SCAN: bool(false),
    FEATURE_DUPLICATE_IMAGE_CHECK: bool(true),

    // ----- OTP delivery -----
    OTP_DELIVERY_DRIVER: z.enum(['log', 'email']).default('log'),
    /** false = skip all OTP steps (sign-up verification, 2-step on new device). Re-enable before launch. */
    AUTH_OTP_ENABLED: bool(true),
    EMAIL_PROVIDER: z.enum(['log', 'smtp', 'ses', 'postmark']).default('log'),
    EMAIL_FROM: str('24 Freelancing <no-reply@24freelancing.local>'),
    SMS_PROVIDER: z.enum(['log', 'sslwireless', 'alphasms', 'bulksmsbd']).default('log'),
    SMS_SENDER_ID: str('24Freelance'),

    // ----- Rate limits (Doc 06 §1.9) -----
    RATE_LIMIT_ENABLED: bool(true),
    RATE_LIMIT_GLOBAL_PER_MINUTE: int(300),
    RATE_LIMIT_AUTH_PER_15_MINUTES: int(10),
    RATE_LIMIT_OTP_VERIFY_PER_15_MINUTES: int(10),
    RATE_LIMIT_UPLOAD_PRESIGN_PER_HOUR: int(60),
    RATE_LIMIT_START_JOB_PER_HOUR: int(30),
    RATE_LIMIT_CONTACT_PER_HOUR: int(5),
    RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE: int(60),
    RATE_LIMIT_WITHDRAWAL_PER_DAY: int(3),
    RATE_LIMIT_WEBHOOK_PER_MINUTE: int(600),

    // ----- Features -----
    FEATURE_SIGNUPS: bool(true),
    FEATURE_MAINTENANCE_MODE: bool(false),
    FEATURE_LIVE_CHAT: bool(true),
    FEATURE_PUBLIC_PAYOUT_HISTORY: bool(true),
    DEV_ENDPOINTS_ENABLED: bool(false),

    // ----- Logging -----
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'verbose']).default('info'),
  })
  .superRefine((env, ctx) => {
    const prodLike = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
    if (env.PII_KMS_PROVIDER === 'local') {
      if (!env.PII_LOCAL_MASTER_KEY || decodeSecret(env.PII_LOCAL_MASTER_KEY).length !== 32)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PII_LOCAL_MASTER_KEY'], message: 'required: 32 bytes (b64:…) when PII_KMS_PROVIDER=local' });
    }
    if (prodLike && !env.COOKIE_SECURE)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['COOKIE_SECURE'], message: 'must be true outside local/test' });
    if (prodLike && env.DEV_ENDPOINTS_ENABLED)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEV_ENDPOINTS_ENABLED'], message: 'dev endpoints are local/test only' });
  });

export type Env = z.output<typeof envSchema>;
