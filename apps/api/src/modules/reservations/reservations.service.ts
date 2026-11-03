import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import type {
  DraftProofItem,
  ProgressResponse,
  ReleaseResponse,
  ReservationDraft,
  StartJobResponse,
  SubmitResponse,
  UploadPurpose,
  WorkerReservation,
} from '@24f/shared';
import { isHttpsUrl, LINK_INVALID_MESSAGE } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { getEnv } from '../../config/env';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { iso, isUniqueViolation, recordEvent, reward3, type Tx } from '../worker/worker-common';
import { ProofChecksService } from './proof-checks.service';

type ReservationRow = Prisma.SlotReservationGetPayload<object>;
type JobRow = Prisma.JobGetPayload<object>;
type Requirement = Prisma.JobProofRequirementGetPayload<object>;

export interface ProofInput {
  proof_requirement_id: string;
  link_url: string | null;
  text_value: string | null;
  upload_id: string | null;
}

const PROOF_PURPOSES: Record<string, UploadPurpose[]> = {
  screenshot: ['proof_screenshot'],
  file: ['proof_file', 'proof_screenshot'],
};

export function draftUploadIds(draft: unknown): string[] {
  const d = draft as ReservationDraft | null;
  return (d?.proof_items ?? []).map((p) => p.upload_id).filter((v): v is string => !!v);
}

/**
 * Slot reservations and first submission (Doc 04 §6.1–§6.6). Counters on `jobs` change only
 * while the job row is locked (§5.12). Lock order: worker advisory lock → reservation → job.
 */
@Injectable()
export class ReservationsService {
  private readonly log = new Logger('Reservations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
    private readonly checks: ProofChecksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  async view(r: ReservationRow, job?: { publicId: string }): Promise<WorkerReservation> {
    const draft = (r.draft as ReservationDraft | null) ?? null;
    const ids = draftUploadIds(draft);
    return {
      id: r.id,
      ...(job ? { job_public_id: job.publicId } : {}),
      status: r.status,
      started_at: r.startedAt.toISOString(),
      expires_at: r.expiresAt.toISOString(),
      steps_checked: [...r.stepsChecked].sort((a, b) => a - b),
      draft,
      draft_saved_at: iso(r.draftSavedAt),
      draft_uploads: ids.length ? await this.uploads.records(ids) : {},
    };
  }

  private async lockJob(tx: Tx, jobId: string): Promise<JobRow> {
    await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    return (await tx.job.findUnique({ where: { id: jobId } }))!;
  }

  private async lockOwnReservation(tx: Tx, id: string, userId: string): Promise<ReservationRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM slot_reservations WHERE id = ${id}::uuid AND worker_user_id = ${userId}::uuid FOR UPDATE`;
    if (!rows.length) throw new ApiError('NOT_FOUND');
    return (await tx.slotReservation.findUnique({ where: { id } }))!;
  }

  // ---------------------------------------------------------------------------
  // Start (§6.1)
  // ---------------------------------------------------------------------------

  async start(userId: string, publicId: string): Promise<{ created: boolean; body: StartJobResponse }> {
    const env = getEnv();
    if (env.RATE_LIMIT_ENABLED) {
      const { count, ttl } = await this.redis.hit(`rl:start_job:${userId}`, 3600).catch(() => ({ count: 0, ttl: 0 }));
      if (count > env.RATE_LIMIT_START_JOB_PER_HOUR) throw new ApiError('RATE_LIMITED', undefined, undefined, { retry_after: ttl });
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, include: { workerProfile: true } });
    if (!user) throw new ApiError('UNAUTHENTICATED');
    if (user.status !== 'active') throw new ApiError('ACCOUNT_RESTRICTED');
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) throw new ApiError('VERIFICATION_REQUIRED');

    const holdMinutes = await this.settings.number('slot_hold_minutes', 60);
    const maxActive = await this.settings.number('max_active_reservations_per_worker', 3);

    // Expire this worker's stale rows first, through the same code as the sweep (§6.1 last paragraph).
    const stale = await this.prisma.db.slotReservation.findMany({ where: { workerUserId: userId, status: 'active', expiresAt: { lte: new Date() } }, select: { id: true } });
    for (const s of stale) await this.expireOne(s.id);

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'worker-start:' + userId}, 0))`;
        const found = await tx.job.findUnique({ where: { publicId }, select: { id: true } });
        if (!found) throw new ApiError('NOT_FOUND');
        const job = await this.lockJob(tx, found.id);
        if (job.deletedAt || job.status === 'draft') throw new ApiError('NOT_FOUND');

        const existing = await tx.slotReservation.findFirst({ where: { jobId: job.id, workerUserId: userId, status: 'active', expiresAt: { gt: new Date() } } });
        if (existing) {
          return { created: false, body: { reservation: await this.view(existing, job), task_link_url: job.taskLinkUrl, slots_left: Math.max(job.slotsLeft ?? 0, 0) } };
        }
        if (job.status !== 'running' || !job.endsAt || job.endsAt <= new Date()) throw new ApiError('JOB_NOT_AVAILABLE', undefined, undefined, { job_status: job.status });
        if (job.employerUserId === userId) throw new ApiError('OWN_JOB');
        const sub = await tx.submission.findFirst({ where: { jobId: job.id, workerUserId: userId }, select: { publicRef: true } });
        if (sub) throw new ApiError('ALREADY_SUBMITTED', undefined, undefined, { submission_ref: sub.publicRef });
        if (job.eligibility === 'kyc_verified' && user.kycStatus !== 'verified') {
          throw new ApiError('NOT_ELIGIBLE', 'This job is for identity-verified workers. Verify to take it.', undefined, { reason: 'kyc_required' });
        }
        const rate = user.workerProfile?.approvalRatePct ?? null;
        if (job.minApprovalRate > 0 && rate !== null && rate < job.minApprovalRate) {
          throw new ApiError('NOT_ELIGIBLE', `This job needs an ${job.minApprovalRate}%+ approval rate. Yours is ${rate}%.`, undefined, {
            reason: 'approval_rate',
            required_rate: job.minApprovalRate,
            your_rate: rate,
          });
        }
        const active = await tx.slotReservation.count({ where: { workerUserId: userId, status: 'active' } });
        if (active >= maxActive) throw new ApiError('RESERVATION_LIMIT', `You already have ${maxActive} jobs in progress. Submit or release one first.`, undefined, { limit: maxActive });
        if ((job.slotsLeft ?? 0) <= 0) throw new ApiError('NO_SLOTS_LEFT');
        await this.assertReserveCovers(tx, job);

        const startedAt = new Date();
        const hold = new Date(startedAt.getTime() + holdMinutes * 60_000);
        const expiresAt = job.endsAt < hold ? job.endsAt : hold; // BR-030, A-17
        const r = await tx.slotReservation.create({ data: { jobId: job.id, workerUserId: userId, status: 'active', startedAt, expiresAt } });
        const updated = await tx.job.update({ where: { id: job.id }, data: { countActiveReservations: { increment: 1 }, countStarts: { increment: 1 } } });
        // "Job opened" is the worker's first view of the job (job_views), added to the trail once a reservation exists.
        const view = await tx.jobView.findFirst({ where: { jobId: job.id, viewerUserId: userId }, orderBy: { firstViewedAt: 'asc' }, select: { firstViewedAt: true } });
        await tx.submissionEvent.create({
          data: { reservationId: r.id, eventType: 'job_opened', actorType: 'user', actorUserId: userId, occurredAt: view?.firstViewedAt ?? new Date(startedAt.getTime() - 1000) },
        });
        await recordEvent(tx, r.id, null, 'slot_reserved', { type: 'user', userId });
        return { created: true, body: { reservation: await this.view(r, job), task_link_url: job.taskLinkUrl, slots_left: Math.max(updated.slotsLeft ?? 0, 0) } };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('ALREADY_SUBMITTED');
      throw e;
    }
  }

  /**
   * Guard #11 (UF-43): the job's reserve must cover one more unit beyond committed work.
   * Only for jobs funded through the ledger (a `job_reserve` posting exists); jobs without
   * reserve accounting (imported fixtures) are not blocked.
   */
  private async assertReserveCovers(tx: Tx, job: JobRow) {
    const funded = await tx.ledgerTransaction.findFirst({ where: { jobId: job.id, type: 'job_reserve' }, select: { id: true } });
    if (!funded) return;
    const unit = new Decimal((job.rewardUsd ?? 0).toString()).plus(job.feePerTaskUsd.toString());
    const committed = job.countInReview + job.countNeedsFix + job.countActiveReservations;
    const spare = new Decimal(job.reserveOutstandingUsd.toString()).minus(unit.times(committed));
    if (spare.lessThan(unit)) throw new ApiError('NO_SLOTS_LEFT');
  }

  // ---------------------------------------------------------------------------
  // Release, expiry, cancel (§6.3, §6.4)
  // ---------------------------------------------------------------------------

  private async endReservation(tx: Tx, r: ReservationRow, outcome: 'released' | 'expired' | 'cancelled', actor: { type: 'user' | 'system'; userId?: string }) {
    const job = await this.lockJob(tx, r.jobId);
    const now = new Date();
    await tx.slotReservation.update({
      where: { id: r.id },
      data: {
        status: outcome,
        draft: Prisma.DbNull,
        ...(outcome === 'released' ? { releasedAt: now } : outcome === 'expired' ? { expiredAt: now } : { cancelledAt: now }),
      },
    });
    const updated = await tx.job.update({ where: { id: job.id }, data: { countActiveReservations: { decrement: 1 } } });
    await this.uploads.scheduleDeletion(tx, draftUploadIds(r.draft));
    await recordEvent(tx, r.id, null, outcome === 'released' ? 'slot_released' : outcome === 'expired' ? 'slot_expired' : 'reservation_cancelled', actor);
    return { job: updated, at: now };
  }

  async release(userId: string, id: string): Promise<ReleaseResponse> {
    return this.prisma.db.$transaction(async (tx) => {
      const r = await this.lockOwnReservation(tx, id, userId);
      if (r.status !== 'active') throw new ApiError('RESERVATION_EXPIRED');
      const { job, at } = await this.endReservation(tx, r, 'released', { type: 'user', userId });
      return { id: r.id, status: 'released', released_at: at.toISOString(), job_slots_left: Math.max(job.slotsLeft ?? 0, 0) };
    });
  }

  /** Expires one reservation if it is still due (FOR UPDATE SKIP LOCKED). Returns true when it expired. */
  async expireOne(id: string): Promise<boolean> {
    const res = await this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM slot_reservations WHERE id = ${id}::uuid AND status = 'active' AND expires_at <= now() FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return null;
      const r = (await tx.slotReservation.findUnique({ where: { id }, include: { job: { select: { title: true, publicId: true } } } }))!;
      await this.endReservation(tx, r, 'expired', { type: 'system' });
      return r;
    });
    if (!res) return false;
    await this.notifications.notify('reservation_expired', res.workerUserId, { job: res.job.title, job_public_id: res.job.publicId }, { dedupeKey: `reservation:${res.id}:expired` });
    return true;
  }

  /** `reservations.expire` + `reservations.expiry-warning`, every minute (FR-SYS-002, UF-41). */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'reservations.expire' })
  async sweep() {
    if (getEnv().PROCESS_ROLE === 'migrate') return;
    try {
      for (let round = 0; round < 10; round++) {
        const due = await this.prisma.db.slotReservation.findMany({ where: { status: 'active', expiresAt: { lte: new Date() } }, orderBy: { expiresAt: 'asc' }, take: 200, select: { id: true } });
        for (const d of due) await this.expireOne(d.id).catch((e) => this.log.warn(`expire ${d.id}: ${e instanceof Error ? e.message : String(e)}`));
        if (due.length < 200) break;
      }
      const warnMin = await this.settings.number('slot_expiry_warning_minutes', 10);
      const soon = await this.prisma.db.slotReservation.findMany({
        where: { status: 'active', expiresAt: { gt: new Date(), lte: new Date(Date.now() + warnMin * 60_000) } },
        include: { job: { select: { title: true, publicId: true } } },
        take: 500,
      });
      for (const r of soon) {
        await this.notifications.notify('reservation_expiring', r.workerUserId, { job: r.job.title, job_public_id: r.job.publicId }, { dedupeKey: `reservation:${r.id}:warn` });
      }
    } catch (e) {
      this.log.error(`sweep failed: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Progress and autosave (§6.2)
  // ---------------------------------------------------------------------------

  async progress(userId: string, id: string, dto: { steps_checked?: number[]; draft?: { proof_items: DraftProofItem[]; worker_note: string | null; attestation: boolean; rev?: number } }): Promise<ProgressResponse> {
    return this.prisma.db.$transaction(async (tx) => {
      const r = await this.lockOwnReservation(tx, id, userId);
      if (r.status !== 'active' || r.expiresAt <= new Date()) throw new ApiError('RESERVATION_EXPIRED');
      const data: Prisma.SlotReservationUpdateInput = {};
      let stepsChanged = false;
      let draftChanged = false;
      if (dto.steps_checked) {
        const positions = new Set((await tx.jobStep.findMany({ where: { jobId: r.jobId }, select: { position: true } })).map((s) => s.position));
        const next = [...new Set(dto.steps_checked)].filter((p) => positions.has(p)).sort((a, b) => a - b);
        data.stepsChecked = next;
        stepsChanged = next.join(',') !== [...r.stepsChecked].sort((a, b) => a - b).join(',');
      }
      const current = (r.draft as ReservationDraft | null) ?? null;
      if (dto.draft) {
        const stale = dto.draft.rev !== undefined && current?.rev !== undefined && current.rev >= dto.draft.rev;
        if (!stale) {
          const reqIds = new Set((await tx.jobProofRequirement.findMany({ where: { jobId: r.jobId }, select: { id: true } })).map((q) => q.id));
          const draft: ReservationDraft = {
            proof_items: dto.draft.proof_items.filter((p) => reqIds.has(p.proof_requirement_id)),
            worker_note: dto.draft.worker_note,
            attestation: !!dto.draft.attestation,
            ...(dto.draft.rev !== undefined ? { rev: dto.draft.rev } : {}),
          };
          data.draft = draft as unknown as Prisma.InputJsonValue;
          data.draftSavedAt = new Date();
          draftChanged = true;
        }
      }
      const updated = Object.keys(data).length ? await tx.slotReservation.update({ where: { id }, data }) : r;
      // Only the first of each event per reservation is logged, so the activity stays readable.
      for (const [changed, type] of [[stepsChanged, 'steps_updated'], [draftChanged, 'draft_saved']] as const) {
        if (!changed) continue;
        const seen = await tx.submissionEvent.findFirst({ where: { reservationId: id, eventType: type }, select: { id: true } });
        if (!seen) await recordEvent(tx, id, null, type, { type: 'user', userId });
      }
      return {
        id,
        steps_checked: [...updated.stepsChecked].sort((a, b) => a - b),
        draft_saved_at: iso(updated.draftSavedAt),
        expires_at: updated.expiresAt.toISOString(),
        rev: ((updated.draft as ReservationDraft | null)?.rev ?? null) as number | null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Proof validation (VR-093…VR-097, UP-6), shared with resubmit
  // ---------------------------------------------------------------------------

  async resolveProof(tx: Tx, userId: string, reqs: Requirement[], items: ProofInput[]) {
    const fields: Record<string, string[]> = {};
    const byReq = new Map(items.map((p, i) => [p.proof_requirement_id, { p, i }]));
    for (const p of items) {
      if (!reqs.some((r) => r.id === p.proof_requirement_id)) (fields[`proof_items.${items.indexOf(p)}.proof_requirement_id`] ??= []).push('This proof isn’t part of the job.');
    }
    const resolved: { req: Requirement; link: string | null; text: string | null; uploadId: string | null }[] = [];
    for (const req of reqs) {
      const hit = byReq.get(req.id);
      const key = (f: string) => `proof_items.${hit?.i ?? req.position - 1}.${f}`;
      const p = hit?.p;
      if (req.proofType === 'link') {
        if (!p?.link_url) {
          if (req.isRequired) fields[key('link_url')] = ['Add the link.'];
        } else if (!isHttpsUrl(p.link_url)) fields[key('link_url')] = [LINK_INVALID_MESSAGE];
        if (p?.link_url) resolved.push({ req, link: p.link_url, text: null, uploadId: null });
      } else if (req.proofType === 'text') {
        const t = p?.text_value?.trim() ?? '';
        if (!t) {
          if (req.isRequired) fields[key('text_value')] = ['Add your answer.'];
        } else if ([...t].length > 2000) fields[key('text_value')] = ['Keep your answer under 2,000 characters.'];
        else resolved.push({ req, link: null, text: t, uploadId: null });
      } else {
        if (!p?.upload_id) {
          if (req.isRequired) fields[key('upload_id')] = [req.proofType === 'screenshot' ? 'Upload your screenshot.' : 'Upload your file.'];
          continue;
        }
        await this.uploads.requireReady(tx, userId, p.upload_id, PROOF_PURPOSES[req.proofType]!, key('upload_id'));
        resolved.push({ req, link: null, text: null, uploadId: p.upload_id });
      }
    }
    if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', undefined, fields);
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Submit (§6.6)
  // ---------------------------------------------------------------------------

  async submit(userId: string, id: string, dto: { steps_checked: number[]; proof_items: ProofInput[]; worker_note: string | null; attestation: true }): Promise<SubmitResponse> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const r = await this.lockOwnReservation(tx, id, userId);
      if (r.status !== 'active' || r.expiresAt <= new Date()) throw new ApiError('RESERVATION_EXPIRED');
      const job = await this.lockJob(tx, r.jobId);
      if (job.status === 'suspended') throw new ApiError('JOB_SUSPENDED');
      const reqs = await tx.jobProofRequirement.findMany({ where: { jobId: job.id }, orderBy: { position: 'asc' } });
      const steps = await tx.jobStep.findMany({ where: { jobId: job.id }, select: { position: true } });
      const ticked = new Set(dto.steps_checked);
      if (!steps.every((s) => ticked.has(s.position))) {
        throw new ApiError('VALIDATION_FAILED', undefined, { steps_checked: [`Tick all ${steps.length} steps to submit`] });
      }
      const items = await this.resolveProof(tx, userId, reqs, dto.proof_items);
      const now = new Date();
      const reviewDueAt = new Date(now.getTime() + job.reviewWindowHours * 3600_000); // BR-034
      const sub = await tx.submission.create({
        data: {
          jobId: job.id,
          reservationId: r.id,
          workerUserId: userId,
          employerUserId: job.employerUserId,
          status: 'in_review',
          rewardUsd: job.rewardUsd ?? new Prisma.Decimal(0),
          feeUsd: job.feePerTaskUsd,
          firstSubmittedAt: now,
          lastSubmittedAt: now,
          reviewDueAt,
          autoCheck: { state: 'pending' },
        },
      });
      const attempt = await tx.submissionAttempt.create({
        data: { submissionId: sub.id, attemptNo: 1, workerNote: dto.worker_note, attestationAcceptedAt: now, stepsChecked: [...ticked].sort((a, b) => a - b) },
      });
      for (const it of items) {
        await tx.submissionProofItem.create({
          data: { attemptId: attempt.id, proofRequirementId: it.req.id, proofType: it.req.proofType, linkUrl: it.link, textValue: it.text, uploadId: it.uploadId },
        });
      }
      await this.uploads.markClaimed(tx, items.map((i) => i.uploadId).filter((v): v is string => !!v));
      await tx.slotReservation.update({ where: { id: r.id }, data: { status: 'submitted', submittedAt: now, draft: Prisma.DbNull, stepsChecked: [...ticked].sort((a, b) => a - b) } });
      await tx.job.update({
        where: { id: job.id },
        data: { countActiveReservations: { decrement: 1 }, countInReview: { increment: 1 }, firstSubmissionAt: job.firstSubmissionAt ?? now },
      });
      await recordEvent(tx, r.id, sub.id, 'submitted', { type: 'user', userId });
      return { sub, attempt, job };
    });
    // After commit: proof auto-check (FR-SYS-019). It informs, never decides.
    setImmediate(() => void this.checks.run(result.sub.id, result.attempt.id).catch((e) => this.log.warn(`auto-check ${result.sub.publicRef}: ${String(e)}`)));
    return {
      ref: result.sub.publicRef,
      status: 'in_review',
      attempt_no: 1,
      reward_usd: reward3(result.sub.rewardUsd),
      submitted_at: result.sub.firstSubmittedAt.toISOString(),
      review_due_at: result.sub.reviewDueAt.toISOString(),
      auto_approve: result.job.autoApprove,
      warnings: [],
    };
  }
}
