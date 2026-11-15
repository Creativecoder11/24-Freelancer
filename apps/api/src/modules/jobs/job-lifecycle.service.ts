import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RedisService } from '../../common/redis.service';
import { EmployerCore, dec, expectedReserve, usd2 } from '../employer/employer-common';

/**
 * System jobs that close the job and submission lifecycles (FR-SYS-003, FR-SYS-004; Doc 04 §12):
 * - Job completion: a running or paused job past `ends_at`, or a running job whose slots are all
 *   approved, becomes `completed`. Budget no longer needed is released to the employer's deposit;
 *   work already in review stays reserved so it can still be paid.
 * - Fix deadline: a `needs_fix` submission past `resubmit_deadline` with no open dispute becomes `rejected`.
 * Runs every minute behind a Redis lock so only one API instance sweeps.
 */
@Injectable()
export class JobLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('JobLifecycle');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly core: EmployerCore,
    private readonly redis: RedisService,
  ) {}

  private get db() {
    return this.core.db;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JOB_LIFECYCLE_SWEEP === 'off') return;
    this.timer = setInterval(() => void this.sweepWithLock(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.sweepWithLock(), 8_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweepWithLock() {
    const key = 'lock:jobs.lifecycle';
    try {
      const ok = await this.redis.client.set(key, String(process.pid), 'EX', 55, 'NX');
      if (!ok) return;
    } catch {
      /* Redis down: run anyway; row locks keep it safe */
    }
    try {
      const jobs = await this.completeJobsSweep();
      const fixes = await this.fixDeadlineSweep();
      if (jobs.completed || jobs.failed || fixes.rejected || fixes.failed) this.log.log(`lifecycle: ${JSON.stringify({ jobs, fixes })}`);
    } catch (e) {
      this.log.error(`lifecycle sweep failed: ${String(e)}`);
    } finally {
      await this.redis.client.del(key).catch(() => undefined);
    }
  }

  /** FR-SYS-003: complete expired or fully approved jobs and release the unused reserve. */
  async completeJobsSweep() {
    const due = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE deleted_at IS NULL AND (
        (status IN ('running', 'paused') AND ends_at <= now())
        OR (status = 'running' AND slots_total IS NOT NULL AND count_approved >= slots_total)
      )
      ORDER BY ends_at NULLS LAST LIMIT 200`;
    const stats = { completed: 0, failed: 0 };
    for (const { id } of due) {
      try {
        const out = await this.db.$transaction(async (tx) => {
          const job = await this.core.lockJob(tx, id);
          const expired = !!job.endsAt && job.endsAt.getTime() <= Date.now();
          const filled = job.slotsTotal !== null && job.countApproved >= job.slotsTotal;
          if (!(job.status === 'running' || job.status === 'paused') || (!expired && !(filled && job.status === 'running'))) return null;
          const reason = filled ? 'slots_filled' : 'expired';
          const keep = expectedReserve(job, 'completed');
          const release = Decimal.max(0, dec(job.reserveOutstandingUsd).minus(keep));
          const t = await this.core.moveReserve(
            tx,
            job,
            'release',
            release,
            `job:${job.publicId}:complete`,
            { title: job.title, reason: reason === 'expired' ? 'job ended, unused slots' : 'job completed, unused budget' },
            { system: true },
          );
          // Active reservations on an expired job are cancelled so workers can't start submitting into it.
          if (expired) {
            await tx.slotReservation.updateMany({ where: { jobId: job.id, status: 'active' }, data: { status: 'cancelled' } });
            await tx.job.update({ where: { id: job.id }, data: { countActiveReservations: 0 } });
          }
          const now = new Date();
          await tx.job.update({
            where: { id: job.id },
            data: { status: 'completed', closeReason: reason, closedAt: now, pauseReason: null, version: { increment: 1 } },
          });
          return { job, reason, released: release, ledgerRef: t?.publicRef ?? null };
        });
        if (!out) continue;
        stats.completed++;
        await this.core.notify({
          userId: out.job.employerUserId,
          audience: 'employer',
          category: 'tasks',
          type: 'job_completed',
          title: out.reason === 'slots_filled' ? 'Job completed — all slots approved' : 'Job ended',
          body: out.released.gt(0)
            ? `“${out.job.title}” has ended. $${usd2(out.released)} of unused budget is back in your deposit.`
            : `“${out.job.title}” has ended.`,
          linkPath: `/employer/jobs/${out.job.publicId}`,
          data: { job_public_id: out.job.publicId, close_reason: out.reason },
          dedupeKey: `job_completed:${out.job.publicId}`,
        });
      } catch (e) {
        stats.failed++;
        this.log.error(`job_complete_failed ${id}: ${String(e)}`);
      }
    }
    return stats;
  }

  /** FR-SYS-004: a needs-fix submission whose resubmit deadline passed (no open dispute) becomes final. */
  async fixDeadlineSweep() {
    const due = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM submissions
      WHERE status = 'needs_fix' AND resubmit_deadline <= now() AND dispute_open = false
      ORDER BY resubmit_deadline LIMIT 500`;
    const stats = { rejected: 0, failed: 0 };
    for (const { id } of due) {
      try {
        const out = await this.db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM submissions WHERE id = ${id}::uuid AND status = 'needs_fix' AND resubmit_deadline <= now()
              AND dispute_open = false FOR UPDATE SKIP LOCKED`;
          if (!rows.length) return null;
          const sub = await tx.submission.update({ where: { id }, data: { status: 'rejected' }, include: { job: true } });
          await tx.job.update({ where: { id: sub.jobId }, data: { countNeedsFix: { decrement: 1 }, countRejected: { increment: 1 } } });
          await tx.submissionEvent.create({
            data: { submissionId: sub.id, reservationId: sub.reservationId, eventType: 'fix_window_expired', actorType: 'system', data: { deadline: sub.resubmitDeadline?.toISOString() ?? null } },
          });
          // A job that is no longer running only keeps reserve for committed work: release this slot's share.
          if (sub.job.status !== 'running') {
            const job = await this.core.lockJob(tx, sub.jobId);
            const release = Decimal.max(0, dec(job.reserveOutstandingUsd).minus(expectedReserve(job)));
            await this.core.moveReserve(tx, job, 'release', release, `sub:${sub.publicRef}:fix-expired`, { title: job.title, reason: 'unused slot returned' }, { system: true });
          }
          return sub;
        });
        if (!out) continue;
        stats.rejected++;
        await this.core.notify({
          userId: out.workerUserId,
          audience: 'worker',
          category: 'tasks',
          type: 'fix_window_expired',
          title: 'Fix deadline passed',
          body: `The time to fix “${out.job.title}” has ended, so the task is now rejected.`,
          linkPath: `/worker/tasks/${out.publicRef}`,
          data: { submission_ref: out.publicRef },
          dedupeKey: `fix_window_expired:${out.publicRef}`,
        });
      } catch (e) {
        stats.failed++;
        this.log.error(`fix_deadline_failed ${id}: ${String(e)}`);
      }
    }
    return stats;
  }
}
