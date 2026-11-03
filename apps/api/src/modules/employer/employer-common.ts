import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma, type Job, type PrismaClient } from '@24f/db';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { LedgerService } from '../ledger/ledger.service';

export type Tx = Prisma.TransactionClient | PrismaClient;

export const ZERO = new Decimal(0);
export const dec = (v: Decimal.Value | Prisma.Decimal | null | undefined) => new Decimal(v === null || v === undefined ? 0 : v.toString());

/** Display strings (A-03): balances truncate to 2 dp; rewards keep 3 dp. */
export const usd2 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
export const usd3 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toDecimalPlaces(3, Decimal.ROUND_DOWN).toFixed(3);
export const usd6 = (v: Decimal.Value | Prisma.Decimal | null | undefined) => dec(v).toFixed(6);
/** Money that may be owed: round up to the cent so "You need $X more" is always enough. */
export const usd2Up = (v: Decimal.Value) => dec(v).toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2);

/** Doc 04 §5.2 reserve model helpers. */
export const unitCost = (j: Pick<Job, 'rewardUsd' | 'feePerTaskUsd'>) => dec(j.rewardUsd).plus(dec(j.feePerTaskUsd));
export const committed = (j: Pick<Job, 'countInReview' | 'countNeedsFix' | 'countActiveReservations'>) =>
  j.countInReview + j.countNeedsFix + j.countActiveReservations;
export const slotsLeftOf = (j: Pick<Job, 'slotsTotal' | 'countApproved' | 'countInReview' | 'countNeedsFix' | 'countActiveReservations'>) =>
  Math.max(0, (j.slotsTotal ?? 0) - j.countApproved - committed(j));

export function expectedReserve(j: Job, status = j.status): Decimal {
  const u = unitCost(j);
  switch (status) {
    case 'draft':
      return ZERO;
    case 'running':
      return u.mul(Math.max((j.slotsTotal ?? 0) - j.countApproved, committed(j)));
    default:
      return u.mul(committed(j));
  }
}

/** Fee per task for a percent (D-02). */
export const feeFor = (reward: Decimal.Value, percent: Decimal.Value) => dec(reward).mul(dec(percent)).div(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

/** Titles in employer descriptions are cut to 40 chars (Doc 08 §4.3). */
export const shortTitle = (t: string) => ([...t].length > 40 ? [...t].slice(0, 40).join('').trimEnd() + '…' : t);

export const JOB_SELECT_FOR_UPDATE = (id: string) => Prisma.sql`SELECT id FROM jobs WHERE id = ${id}::uuid FOR UPDATE`;

/** Allowed row actions per status (FR-EJOB-016). */
export function allowedActions(j: Pick<Job, 'status' | 'pauseReason' | 'countInReview'>): string[] {
  switch (j.status) {
    case 'draft':
      return ['continue', 'duplicate', 'delete'];
    case 'running':
      return ['review', 'edit', 'add_slots', 'pause', 'duplicate', 'close'];
    case 'paused':
      return j.pauseReason === 'admin' ? ['review', 'duplicate', 'close'] : ['review', 'resume', 'edit', 'add_slots', 'duplicate', 'close'];
    case 'suspended':
      return ['review'];
    default:
      return j.countInReview > 0 ? ['review', 'duplicate'] : ['view', 'duplicate'];
  }
}

export interface NotifyInput {
  userId: string;
  audience: 'worker' | 'employer';
  category: 'tasks' | 'payments' | 'referrals' | 'system';
  type: string;
  title: string;
  body: string;
  linkPath?: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  mandatory?: boolean;
}

/**
 * Shared services for the employer modules: wallet lookups, the reserve mover (Doc 04 §5.2),
 * and a notification adapter. Notifications are written to the `notifications` table directly
 * (the same rows `NotificationsService.notify()` produces), so they show up whether or not the
 * notifications module is loaded.
 */
@Injectable()
export class EmployerCore {
  private readonly log = new Logger('EmployerCore');

  constructor(
    readonly prisma: PrismaService,
    readonly ledger: LedgerService,
  ) {}

  get db() {
    return this.prisma.db;
  }

  /** Creates the employer profile and wallet accounts lazily (BR-WAL-03, Doc 04 §4.2). */
  async ensureProfile(userId: string, tx: Tx = this.db) {
    let p = await tx.employerProfile.findUnique({ where: { userId } });
    if (!p) {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { fullName: true } });
      p = await tx.employerProfile.upsert({
        where: { userId },
        update: {},
        create: { userId, businessName: (u?.fullName ?? 'My business').slice(0, 80) },
      });
    }
    return p;
  }

  async accounts(userId: string, tx: Tx = this.db) {
    const available = await this.ledger.userAccount(userId, 'employer_available', tx);
    const reserved = await this.ledger.userAccount(userId, 'employer_reserved', tx);
    return { available, reserved };
  }

  /** Locks both employer accounts in id order (TX-3) and returns fresh balances. */
  async lockAccounts(userId: string, tx: Prisma.TransactionClient) {
    const { available, reserved } = await this.accounts(userId, tx);
    const ids = [available.id, reserved.id].sort();
    const rows = await tx.$queryRaw<{ id: string; balance_cached: Prisma.Decimal }[]>`
      SELECT id, balance_cached FROM wallet_accounts WHERE id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) ORDER BY id FOR UPDATE`;
    const bal = (id: string) => dec(rows.find((r) => r.id === id)?.balance_cached);
    return { available, reserved, availableBal: bal(available.id), reservedBal: bal(reserved.id) };
  }

  async balances(userId: string, tx: Tx = this.db) {
    const rows = await tx.walletAccount.findMany({
      where: { ownerUserId: userId, kind: { in: ['employer_available', 'employer_reserved'] } },
      select: { kind: true, balanceCached: true },
    });
    const available = dec(rows.find((r) => r.kind === 'employer_available')?.balanceCached);
    const reserved = dec(rows.find((r) => r.kind === 'employer_reserved')?.balanceCached);
    return { available, reserved, total: available.plus(reserved) };
  }

  /**
   * The single helper that moves money between available and reserved for a job and keeps
   * `jobs.reserve_outstanding_usd` in step (Doc 04 §5.2 moveReserve). Returns the ledger row or null.
   */
  async moveReserve(
    tx: Prisma.TransactionClient,
    job: Pick<Job, 'id' | 'employerUserId'>,
    direction: 'reserve' | 'release',
    amount: Decimal,
    key: string,
    description: Record<string, unknown>,
    actor: { userId?: string; system?: boolean } = {},
  ) {
    if (amount.lte(0)) return null;
    const acc = await this.lockAccounts(job.employerUserId, tx);
    if (direction === 'reserve' && acc.availableBal.lt(amount)) {
      throw new ApiError('INSUFFICIENT_BALANCE', `You need ${'$' + usd2Up(amount.minus(acc.availableBal))} more. Add funds first.`, undefined, {
        shortfall_usd: usd2Up(amount.minus(acc.availableBal)),
        available_usd: usd2(acc.availableBal),
      });
    }
    const a = amount.toFixed(6);
    const neg = amount.neg().toFixed(6);
    const tx1 = await this.ledger.post(
      {
        type: direction === 'reserve' ? 'job_reserve' : 'job_release',
        idempotencyKey: key,
        actor: actor.userId ? 'user' : 'system',
        userId: actor.userId,
        description,
        refs: { jobId: job.id },
        lines:
          direction === 'reserve'
            ? [
                { accountId: acc.available.id, amount: neg },
                { accountId: acc.reserved.id, amount: a },
              ]
            : [
                { accountId: acc.reserved.id, amount: neg },
                { accountId: acc.available.id, amount: a },
              ],
      },
      tx,
    );
    await tx.job.update({
      where: { id: job.id },
      data: { reserveOutstandingUsd: { increment: direction === 'reserve' ? new Prisma.Decimal(a) : new Prisma.Decimal(neg) } },
    });
    return tx1;
  }

  async notify(n: NotifyInput, tx: Tx = this.db) {
    try {
      const days = 90;
      if (n.dedupeKey) {
        const dup = await tx.notification.findFirst({ where: { userId: n.userId, dedupeKey: n.dedupeKey }, select: { id: true } });
        if (dup) return;
      }
      await tx.notification.create({
        data: {
          userId: n.userId,
          audience: n.audience,
          category: n.category,
          type: n.type,
          title: n.title.slice(0, 120),
          body: n.body.slice(0, 300),
          linkPath: n.linkPath,
          data: (n.data ?? {}) as Prisma.InputJsonValue,
          isMandatory: n.mandatory ?? false,
          dedupeKey: n.dedupeKey,
          expiresAt: new Date(Date.now() + days * 86_400_000),
        },
      });
    } catch (e) {
      this.log.warn(`notify ${n.type} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Owner-scoped job lookup; other owners get 404 (Doc 04 §5.3). */
  async ownJob(userId: string, publicId: string, tx: Tx = this.db) {
    const job = await tx.job.findFirst({ where: { publicId, employerUserId: userId, deletedAt: null } });
    if (!job) throw new ApiError('NOT_FOUND', "We can't find that job.");
    return job;
  }

  /** Row-locks the job and re-reads it (business row first, TX-3). */
  async lockJob(tx: Prisma.TransactionClient, jobId: string) {
    await tx.$queryRaw(JOB_SELECT_FOR_UPDATE(jobId));
    return tx.job.findUniqueOrThrow({ where: { id: jobId } });
  }

  /** Counts prior ledger rows with a key prefix, for pause/resume counters (Doc 04 §5.7). */
  async nextCounter(tx: Prisma.TransactionClient, prefix: string) {
    const n = await tx.ledgerTransaction.count({ where: { idempotencyKey: { startsWith: prefix } } });
    return n + 1;
  }
}

@Global()
@Module({ providers: [EmployerCore], exports: [EmployerCore] })
export class EmployerCoreModule {}

/** Idempotency-Key header (Doc 06 §1.10). Required on money-moving employer calls. */
export function requireIdemKey(v: string | undefined): string {
  if (!v || !/^[A-Za-z0-9_-]{8,80}$/.test(v)) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
  return v;
}

/** Start of the current month in Asia/Dhaka, as a UTC Date. */
export function dhakaMonthStart(offsetMonths = 0, now = new Date()): Date {
  const local = new Date(now.getTime() + 6 * 3_600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + offsetMonths;
  return new Date(Date.UTC(y, m, 1) - 6 * 3_600_000);
}

/** Dhaka calendar date string (YYYY-MM-DD) of a Date. */
export function dhakaDate(d: Date): string {
  return new Date(d.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Start of a Dhaka calendar day `daysAgo` days back, as a UTC Date. */
export function dhakaDayStart(daysAgo = 0, now = new Date()): Date {
  const local = new Date(now.getTime() + 6 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysAgo) - 6 * 3_600_000);
}
