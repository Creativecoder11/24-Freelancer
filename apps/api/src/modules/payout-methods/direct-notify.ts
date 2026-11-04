import { Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@24f/db';

type Tx = Prisma.TransactionClient | PrismaClient;
const log = new Logger('DirectNotify');

/**
 * In-app rows for notification types that are not (yet) in the shared catalogue
 * (security "Payout method added/removed" Doc 08 §6.3; referral reminder Doc 06 §5.14).
 * Never throws: a notification must not break the action that triggered it.
 */
export async function notifyDirect(
  tx: Tx,
  input: {
    userId: string;
    type: string;
    category: 'tasks' | 'payments' | 'referrals' | 'system';
    title: string;
    body: string;
    link?: string | null;
    mandatory?: boolean;
    audience?: 'worker' | 'employer';
    dedupeKey?: string;
  },
) {
  try {
    await tx.notification.create({
      data: {
        userId: input.userId,
        audience: input.audience ?? 'worker',
        category: input.category,
        type: input.type,
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 300),
        linkPath: input.link ?? null,
        isMandatory: !!input.mandatory,
        dedupeKey: input.dedupeKey ?? null,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
  } catch (e) {
    log.warn(`notify ${input.type} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
