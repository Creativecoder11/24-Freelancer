import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@24f/db';
import { maskEmail } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import type { AdminCtx } from './admin-context';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityRef?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  /** Override the actor (system rows, failed logins). */
  actorType?: 'admin' | 'system' | 'user';
  actorAdminId?: string | null;
}

const SECRET_KEY = /^(password|.*_password|token|.*_token|otp|totp.*|account_.*|document_number|secret|refresh.*)$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?\d{10,15}$/;

/** redactAudit() (Doc 04 §11.4): drops secrets and masks emails and phones. */
export function redactAudit(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || depth > 6) return v ?? null;
  if (typeof v === 'string') {
    if (EMAIL.test(v)) return maskEmail(v);
    if (PHONE.test(v)) return `${v.slice(0, 5)}•••${v.slice(-3)}`;
    return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  }
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => redactAudit(x, depth + 1));
  if (typeof v === 'object') {
    if (v instanceof Prisma.Decimal) return v.toString();
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = redactAudit(x, depth + 1);
    }
    return out;
  }
  return v;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (redactAudit(v) as Prisma.InputJsonValue));

/**
 * Writes `audit_logs` (Doc 09 §20). Call inside the same transaction as the business change.
 * Marks the request context as audited so the interceptor does not add a generic row.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: AdminCtx | null, input: AuditInput, tx: Tx = this.prisma.db) {
    const actorType = input.actorType ?? (ctx ? 'admin' : 'system');
    await tx.auditLog.create({
      data: {
        actorType,
        actorAdminId: input.actorAdminId !== undefined ? input.actorAdminId : actorType === 'admin' ? (ctx?.id ?? null) : null,
        action: input.action.slice(0, 80),
        entityType: input.entityType.slice(0, 40),
        entityId: input.entityId && /^[0-9a-f-]{36}$/i.test(input.entityId) ? input.entityId : null,
        entityRef: input.entityRef ? input.entityRef.slice(0, 20) : null,
        reason: input.reason ? input.reason.slice(0, 500) : null,
        beforeData: json(input.before),
        afterData: json(input.after),
        ipAddress: ctx?.ip && /^[0-9a-f.:]+$/i.test(ctx.ip) ? ctx.ip : null,
        userAgent: ctx?.ua?.slice(0, 512) ?? null,
        requestId: ctx?.requestId?.slice(0, 64) ?? null,
      },
    });
    if (ctx) ctx.audited = true;
  }

  /** Best-effort write outside a business transaction (reads, failures). Never throws. */
  async safe(ctx: AdminCtx | null, input: AuditInput) {
    try {
      await this.record(ctx, input);
    } catch (e) {
      this.log.error(`audit write failed ${input.action}: ${String(e)}`);
    }
  }
}
