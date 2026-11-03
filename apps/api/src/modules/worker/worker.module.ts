import { Body, Controller, Get, Module, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { jobReportSchema, workerJobsQuerySchema, type WorkerJobsQuery } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsModule } from '../reservations/reservations.module';
import { ReservationsService } from '../reservations/reservations.service';
import { WorkerService } from './worker.service';

const normalisePublicId = (id: string) => id.trim().toUpperCase();

/** Doc 06 §5.6. Reads allowed for `restricted` users; start needs `active` (checked in the service for the exact error). */
@Controller('worker')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class WorkerController {
  constructor(
    private readonly svc: WorkerService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get('overview')
  overview(@CurrentUser('id') userId: string) {
    return this.svc.overview(userId);
  }

  @Get('jobs')
  async jobs(@CurrentUser('id') userId: string, @Query(new ZodPipe(workerJobsQuerySchema)) q: WorkerJobsQuery) {
    const r = await this.svc.jobs(userId, q);
    return new Paged(r.data, r.meta);
  }

  @Get('jobs/:publicId')
  job(@CurrentUser('id') userId: string, @Param('publicId') publicId: string) {
    return this.svc.jobDetail(userId, normalisePublicId(publicId));
  }

  /** 201 when a slot is reserved, 200 with the same reservation on an idempotent repeat. */
  @Post('jobs/:publicId/start')
  async start(@CurrentUser('id') userId: string, @Param('publicId') publicId: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.reservations.start(userId, normalisePublicId(publicId));
    res.status(r.created ? 201 : 200);
    return r.body;
  }
}

/** `POST /jobs/{publicId}/reports`: any signed-in user, any mode (Doc 06 §5.6). */
@Controller('jobs')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class JobReportsController {
  constructor(private readonly svc: WorkerService) {}

  @Post(':publicId/reports')
  report(@CurrentUser('id') userId: string, @Param('publicId') publicId: string, @Body(new ZodPipe(jobReportSchema)) body: { reason: string; details: string | null }) {
    return this.svc.report(userId, normalisePublicId(publicId), body);
  }
}

@Module({
  imports: [AuthModule, ReservationsModule],
  controllers: [WorkerController, JobReportsController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
