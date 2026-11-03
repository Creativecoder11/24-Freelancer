import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { resubmitSchema, workerSubmissionsQuerySchema, type WorkerSubmissionsQuery } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsModule } from '../reservations/reservations.module';
import type { ProofInput } from '../reservations/reservations.service';
import { SubmissionsService } from './submissions.service';

/** Doc 06 §5.7: My tasks, task details, resubmit. */
@Controller('worker/submissions')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class SubmissionsController {
  constructor(private readonly svc: SubmissionsService) {}

  @Get()
  async list(@CurrentUser('id') userId: string, @Query(new ZodPipe(workerSubmissionsQuerySchema)) q: WorkerSubmissionsQuery) {
    const r = await this.svc.list(userId, q);
    return new Paged(r.data, r.meta as unknown as Record<string, unknown>);
  }

  @Get(':ref')
  detail(@CurrentUser('id') userId: string, @Param('ref') ref: string) {
    return this.svc.detail(userId, ref);
  }

  @Post(':ref/resubmit')
  @HttpCode(200)
  resubmit(@CurrentUser('id') userId: string, @Param('ref') ref: string, @Body(new ZodPipe(resubmitSchema)) body: { proof_items: ProofInput[]; change_note: string | null }) {
    return this.svc.resubmit(userId, ref, body);
  }
}

@Module({
  imports: [AuthModule, ReservationsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
