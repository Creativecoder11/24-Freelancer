import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@24f/db';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';

type Tx = Prisma.TransactionClient | PrismaClient;
type TxType = Prisma.LedgerTransactionCreateInput['type'];
type AccountKind = 'worker_earnings' | 'employer_available' | 'employer_reserved';

export interface LedgerLine {
  accountId: string;
  /** Signed: + credit, − debit. Strings or Decimal, never floats. */
  amount: Decimal.Value;
  displayType?: TxType;
}

export interface PostInput {
  type: TxType;
  idempotencyKey: string;
  lines: LedgerLine[];
  operationId?: string;
  actor?: 'user' | 'admin' | 'system';
  userId?: string;
  adminId?: string;
  reason?: string;
  reasonCode?: string;
  description?: Record<string, unknown>;
  refs?: { jobId?: string; submissionId?: string; depositId?: string; withdrawalId?: string; referralCommissionId?: string; disputeId?: string; reversesTxId?: string };
}

/**
 * Double-entry ledger (Doc 08 §2, Doc 04 §7.1). The database enforces the invariants:
 * `ledger_entry_apply` updates cached balances with row locks and rejects negative user balances,
 * `ledger_tx_balanced` (deferred) rejects any transaction whose entries don't sum to zero,
 * and both tables are immutable. This service adds idempotency and a typed API.
 * Always call `post` inside the caller's `$transaction` so business rows and money commit together.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(input: PostInput, tx: Tx = this.prisma.db) {
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const sum = input.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    if (!sum.isZero()) throw new Error(`Ledger transaction ${input.idempotencyKey} does not balance (${sum.toString()})`);
    if (input.lines.length < 2) throw new Error('Ledger transaction needs at least two entries');
    const opId = input.operationId;
    try {
      const created = await tx.ledgerTransaction.create({
        data: {
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          operationId: opId ?? (await tx.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id,
          createdByActor: input.actor ?? 'system',
          createdByUserId: input.userId,
          createdByAdminId: input.adminId,
          reason: input.reason,
          reasonCode: input.reasonCode,
          descriptionParams: (input.description ?? {}) as Prisma.InputJsonValue,
          jobId: input.refs?.jobId,
          submissionId: input.refs?.submissionId,
          depositId: input.refs?.depositId,
          withdrawalId: input.refs?.withdrawalId,
          referralCommissionId: input.refs?.referralCommissionId,
          disputeId: input.refs?.disputeId,
          reversesTxId: input.refs?.reversesTxId,
        },
      });
      // Entries in account-id order so concurrent posts lock wallet rows in a consistent order (no deadlocks).
      const lines = [...input.lines].sort((a, b) => a.accountId.localeCompare(b.accountId));
      for (const l of lines) {
        await tx.ledgerEntry.create({
          data: {
            transactionId: created.id,
            txSeq: created.seq,
            accountId: l.accountId,
            displayType: l.displayType ?? input.type,
            amount: new Prisma.Decimal(new Decimal(l.amount).toFixed(6)),
          },
        });
      }
      return created;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/negative|insufficient/i.test(msg)) throw new ApiError('INSUFFICIENT_BALANCE');
      throw e;
    }
  }

  async userAccount(userId: string, kind: AccountKind, tx: Tx = this.prisma.db) {
    let acc = await tx.walletAccount.findFirst({ where: { ownerUserId: userId, kind } });
    if (!acc) acc = await tx.walletAccount.create({ data: { ownerUserId: userId, kind } });
    return acc;
  }

  async systemAccount(code: string, tx: Tx = this.prisma.db) {
    const acc = await tx.walletAccount.findUnique({ where: { systemCode: code } });
    if (!acc) throw new Error(`Missing system account ${code}`);
    return acc;
  }

  async balance(userId: string, kind: AccountKind, tx: Tx = this.prisma.db) {
    const acc = await tx.walletAccount.findFirst({ where: { ownerUserId: userId, kind }, select: { balanceCached: true } });
    return new Decimal(acc?.balanceCached.toString() ?? 0);
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
