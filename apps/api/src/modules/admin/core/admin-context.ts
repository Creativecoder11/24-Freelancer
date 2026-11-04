import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../../common/api-error';
import { hasPerm } from './permissions';

/** The signed-in admin for one request (Doc 09 §2.2). */
export interface AdminCtx {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  /** Raw role keys, with wildcards. Use `has()`. */
  perms: string[];
  sessionId: string;
  reauthAt: Date | null;
  totpEnrolled: boolean;
  ip: string | null;
  ua: string | null;
  requestId: string | null;
  audited: boolean;
  has(key: string): boolean;
  hasAny(...keys: string[]): boolean;
  isSuper: boolean;
  /** "Imran H." style short name for UI and pending-approval cards. */
  shortName: string;
}

export type AdminRequest = Request & { id?: string; admin?: AdminCtx };

export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0]} ${[...parts[parts.length - 1]!][0]}.`;
}

export function buildCtx(req: AdminRequest, a: { id: string; email: string; fullName: string; totpEnrolledAt: Date | null }, roles: string[], perms: string[], sessionId: string, reauthAt: Date | null): AdminCtx {
  return {
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    roles,
    perms,
    sessionId,
    reauthAt,
    totpEnrolled: !!a.totpEnrolledAt,
    ip: req.ip ?? null,
    ua: req.header('user-agent') ?? null,
    requestId: req.id ?? null,
    audited: false,
    has: (k: string) => hasPerm(perms, k),
    hasAny: (...ks: string[]) => ks.some((k) => hasPerm(perms, k)),
    isSuper: roles.includes('super_admin'),
    shortName: shortName(a.fullName),
  };
}

export const PERMS_KEY = 'admin:perms';
export const REAUTH_KEY = 'admin:reauth';

/** Any of these keys grants access to the route (Doc 09 §4.2). */
export const Perms = (...keys: string[]) => SetMetadata(PERMS_KEY, keys);
/** Sensitive action: needs a TOTP re-entry within ADMIN_REAUTH_WINDOW_MINUTES (Doc 09 §22.2). */
export const Reauth = () => SetMetadata(REAUTH_KEY, true);

export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const a = ctx.switchToHttp().getRequest<AdminRequest>().admin;
  if (!a) throw new ApiError('UNAUTHENTICATED');
  return a;
});

/** Throws ADMIN_FORBIDDEN unless the admin holds one of the keys (service-layer re-check). */
export function requirePerm(ctx: AdminCtx, ...keys: string[]) {
  if (!ctx.hasAny(...keys)) throw new ApiError('ADMIN_FORBIDDEN');
}
