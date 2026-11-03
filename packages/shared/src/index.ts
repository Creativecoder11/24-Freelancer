/**
 * @24f/shared: enums, error codes, zod request schemas, formatters, masking and API types.
 * Used by apps/api (server validation) and apps/web (forms, display).
 */
export * from './enums';
export * from './errors';
export * from './format';
export * from './mask';
export * from './identifier';
export * from './uploads';
export * from './types';
export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/me';
export * from './schemas/kyc-uploads';
export * from './schemas/public';
export * from './schemas/worker';
export * from './worker-types';

/** Cookie names (Doc 11, Canonical §16.5). */
export const COOKIE_NAMES = {
  refresh: 'fl_rt',
  adminRefresh: 'fl_admin_rt',
  session: 'fl_session',
  device: 'fl_did',
  referral: 'fl_ref',
} as const;

/** Header names (Doc 06 §1.10–§1.12). */
export const HEADER_NAMES = {
  requestId: 'X-Request-Id',
  idempotencyKey: 'Idempotency-Key',
  idempotentReplayed: 'Idempotent-Replayed',
  client: 'X-Client',
} as const;
