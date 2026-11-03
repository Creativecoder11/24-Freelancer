import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post, UseGuards } from '@nestjs/common';
import { disputeCreateSchema, type DisputeCreated, type WorkerDispute } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { ReservationsModule } from '../reservations/reservations.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { SubmissionsService } from '../submissions/submissions.service';
import { isUniqueViolation, recordEvent } from '../worker/worker-common';

/** Worker disputes: open, read, withdraw (Doc 04 §6.14, Doc 06 §5.7; D-13, A-55). */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
    private readonly submissions: SubmissionsService,
  ) {}

  async open(userId: string, ref: string, dto: { worker_statement: string; evidence_upload_ids: string[] }): Promise<DisputeCreated> {
    const windowH = await this.settings.number('dispute_window_hours', 72);
    const slaH = await this.settings.number('dispute_sla_hours', 48);
    const evidence = [...new Set(dto.evidence_upload_ids)].slice(0, 3);
    try {
      const out = await this.prisma.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM submissions WHERE public_ref = ${ref.toUpperCase()} AND worker_user_id = ${userId}::uuid FOR UPDATE`;
        if (!rows.length) throw new ApiError('NOT_FOUND');
        const sub = (await tx.submission.findUnique({ where: { id: rows[0]!.id }, include: { dispute: true, job: { select: { title: true } } } }))!;
        if (sub.status !== 'needs_fix' && sub.status !== 'rejected') throw new ApiError('NOT_DISPUTABLE');
        if (sub.dispute) throw new ApiError('DISPUTE_EXISTS', undefined, undefined, { dispute_ref: sub.dispute.publicRef });
        if (!sub.decidedAt || sub.decidedAt.getTime() + windowH * 3600_000 < Date.now()) {
          throw new ApiError('DISPUTE_WINDOW_CLOSED', undefined, undefined, { decided_at: sub.decidedAt?.toISOString() ?? null });
        }
        for (const [i, id] of evidence.entries()) await this.uploads.requireReady(tx, userId, id, ['proof_screenshot', 'proof_file'], `evidence_upload_ids.${i}`);
        const now = new Date();
        const d = await tx.dispute.create({
          data: {
            submissionId: sub.id,
            workerUserId: userId,
            employerUserId: sub.employerUserId,
            status: 'open',
            disputedDecision: sub.status,
            workerStatement: dto.worker_statement,
            evidenceUploadId: evidence[0] ?? null,
            evidenceUpload2Id: evidence[1] ?? null,
            evidenceUpload3Id: evidence[2] ?? null,
            openedAt: now,
            slaDueAt: new Date(now.getTime() + slaH * 3600_000),
          },
        });
        await this.uploads.markClaimed(tx, evidence);
        await tx.submission.update({ where: { id: sub.id }, data: { disputeOpen: true } });
        await recordEvent(tx, sub.reservationId, sub.id, 'dispute_opened', { type: 'user', userId }, { dispute_ref: d.publicRef });
        return { d, sub };
      });
      await this.notifications.notify('dispute_opened', userId, { dispute_ref: out.d.publicRef, ref: out.sub.publicRef }, { dedupeKey: `dispute:${out.d.id}:opened` });
      await this.notifications.notify('dispute_against_decision', out.sub.employerUserId, { ref: out.sub.publicRef }, { dedupeKey: `dispute:${out.d.id}:employer` });
      return { ref: out.d.publicRef, status: 'open', submission_ref: out.sub.publicRef, opened_at: out.d.openedAt.toISOString(), sla_due_at: out.d.slaDueAt.toISOString() };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('DISPUTE_EXISTS');
      throw e;
    }
  }

  private async owned(userId: string, ref: string) {
    const d = await this.prisma.db.dispute.findUnique({ where: { publicRef: ref.toUpperCase() }, include: { submission: { select: { publicRef: true } } } });
    if (!d || d.workerUserId !== userId) throw new ApiError('NOT_FOUND');
    return d;
  }

  async get(userId: string, ref: string): Promise<WorkerDispute> {
    const d = await this.owned(userId, ref);
    return this.submissions.disputeView(d, d.submission.publicRef);
  }

  async withdraw(userId: string, ref: string) {
    const resubmitH = await this.settings.number('resubmit_window_hours', 24);
    const out = await this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM disputes WHERE public_ref = ${ref.toUpperCase()} AND worker_user_id = ${userId}::uuid FOR UPDATE`;
      if (!rows.length) throw new ApiError('NOT_FOUND');
      const d = (await tx.dispute.findUnique({ where: { id: rows[0]!.id } }))!;
      if (d.status !== 'open' && d.status !== 'under_review') throw new ApiError('DISPUTE_NOT_WITHDRAWABLE', undefined, undefined, { status: d.status });
      const now = new Date();
      await tx.dispute.update({ where: { id: d.id }, data: { status: 'withdrawn', withdrawnAt: now } });
      const sub = (await tx.submission.findUnique({ where: { id: d.submissionId } }))!;
      // A-55: a suspended fix deadline restarts for 24 h.
      const deadline = sub.status === 'needs_fix' ? new Date(now.getTime() + resubmitH * 3600_000) : sub.resubmitDeadline;
      await tx.submission.update({ where: { id: sub.id }, data: { disputeOpen: false, ...(sub.status === 'needs_fix' ? { resubmitDeadline: deadline } : {}) } });
      await recordEvent(tx, sub.reservationId, sub.id, 'dispute_resolved', { type: 'user', userId }, { outcome: 'withdrawn' });
      return { d, sub, now, deadline };
    });
    await this.notifications.notify('employer_dispute_withdrawn', out.sub.employerUserId, { ref: out.sub.publicRef });
    return { ref: out.d.publicRef, status: 'withdrawn', withdrawn_at: out.now.toISOString(), resubmit_deadline: out.sub.status === 'needs_fix' ? (out.deadline?.toISOString() ?? null) : null };
  }
}

@Controller('worker')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class DisputesController {
  constructor(private readonly svc: DisputesService) {}

  @Post('submissions/:ref/disputes')
  open(@CurrentUser('id') userId: string, @Param('ref') ref: string, @Body(new ZodPipe(disputeCreateSchema)) body: { worker_statement: string; evidence_upload_ids: string[] }) {
    return this.svc.open(userId, ref, body);
  }

  @Get('disputes/:ref')
  get(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.svc.get(userId, ref);
  }

  @Post('disputes/:ref/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.svc.withdraw(userId, ref);
  }
}

@Module({
  imports: [AuthModule, ReservationsModule, SubmissionsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
