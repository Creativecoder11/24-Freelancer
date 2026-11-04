import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@24f/db';
import { EmployerCore } from '../../employer/employer-common';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Writes user notifications for admin actions (same rows NotificationsService produces). */
@Injectable()
export class AdminNotifier {
  constructor(private readonly core: EmployerCore) {}

  async user(
    userId: string,
    n: { type: string; title: string; body: string; category?: 'tasks' | 'payments' | 'referrals' | 'system'; audience?: 'worker' | 'employer'; linkPath?: string; mandatory?: boolean; data?: Record<string, unknown> },
    tx?: Tx,
  ) {
    let audience = n.audience;
    if (!audience) {
      const u = await (tx ?? this.core.db).user.findUnique({ where: { id: userId }, select: { activeMode: true } });
      audience = (u?.activeMode as 'worker' | 'employer') ?? 'worker';
    }
    await this.core.notify({ userId, audience, category: n.category ?? 'system', type: n.type, title: n.title, body: n.body, linkPath: n.linkPath, mandatory: n.mandatory, data: n.data }, tx);
  }
}
