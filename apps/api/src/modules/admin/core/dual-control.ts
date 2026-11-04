import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@24f/db';
import { ApiError } from '../../../common/api-error';
import { PrismaService } from '../../../common/prisma.service';
import type { AdminCtx } from './admin-context';
import { iso } from './helpers';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Maker-checker for money actions (Doc 09 §4.4, `admin_pending_actions`). One open item per
 * object (`admin_pending_one_open_uq`); the database also rejects maker = checker.
 */
@Injectable()
export class DualControlService {
  constructor(private readonly prisma: PrismaService) {}

  async open(objectType: string, objectId: string, tx: Tx = this.prisma.db) {
    return tx.adminPendingAction.findFirst({
      where: { objectType, objectId, status: 'pending' },
      include: { createdByAdmin: { select: { fullName: true } } },
    });
  }

  async openMany(objectType: string, ids: string[]) {
    if (!ids.length) return new Map<string, Awaited<ReturnType<DualControlService['open']>>>();
    const rows = await this.prisma.db.adminPendingAction.findMany({
      where: { objectType, objectId: { in: ids }, status: 'pending' },
      include: { createdByAdmin: { select: { fullName: true } } },
    });
    return new Map(rows.map((r) => [r.objectId, r]));
  }

  async create(tx: Tx, ctx: AdminCtx, i: { action: string; objectType: string; objectId: string; payload: Record<string, unknown>; reason: string; idempotencyKey: string }) {
    const existing = await this.open(i.objectType, i.objectId, tx);
    if (existing) throw new ApiError('INVALID_STATE', 'Another action is already waiting for approval on this item.');
    return tx.adminPendingAction.create({
      data: {
        action: i.action,
        objectType: i.objectType,
        objectId: i.objectId,
        payload: i.payload as Prisma.InputJsonValue,
        reason: i.reason.slice(0, 500),
        idempotencyKey: i.idempotencyKey.slice(0, 100),
        createdByAdminId: ctx.id,
      },
    });
  }

  /** Locks and returns the open item a checker is deciding. */
  async forDecision(tx: Prisma.TransactionClient, ctx: AdminCtx, objectType: string, objectId: string) {
    const p = await tx.adminPendingAction.findFirst({ where: { objectType, objectId, status: 'pending' } });
    if (!p) throw new ApiError('INVALID_STATE', 'Nothing is waiting for approval on this item.');
    await tx.$queryRaw`SELECT id FROM admin_pending_actions WHERE id = ${p.id}::uuid FOR UPDATE`;
    if (p.createdByAdminId === ctx.id) throw new ApiError('SELF_APPROVAL_FORBIDDEN');
    return p;
  }

  async close(tx: Prisma.TransactionClient, ctx: AdminCtx, id: string, status: 'approved' | 'declined' | 'void', note?: string | null) {
    return tx.adminPendingAction.update({
      where: { id },
      data: { status, decidedByAdminId: status === 'void' ? null : ctx.id, decidedAt: new Date(), decisionNote: note ?? (status === 'void' ? 'Underlying item changed.' : null) },
    });
  }

  /** DTO shown on rows and pending cards. */
  static dto(p: Awaited<ReturnType<DualControlService['open']>>, ctx: AdminCtx) {
    if (!p) return null;
    return {
      id: p.id,
      action: p.action,
      payload: p.payload,
      reason: p.reason,
      requested_by: p.createdByAdmin.fullName,
      requested_by_me: p.createdByAdminId === ctx.id,
      requested_at: iso(p.createdAt),
    };
  }
}

export const pendingResponse = (action: string, by: string, approvePath: string) => ({
  status: 'pending_approval' as const,
  action,
  requested_by: by,
  requested_at: new Date().toISOString(),
  approve_path: approvePath,
});
