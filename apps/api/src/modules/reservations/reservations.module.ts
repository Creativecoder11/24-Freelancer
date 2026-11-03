import { Body, Controller, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { reservationProgressSchema, submitProofSchema } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProofChecksService } from './proof-checks.service';
import { ReservationsService, type ProofInput } from './reservations.service';

/** Doc 06 §5.6: release, progress, submit. Submit is allowed for `restricted` (work already started). */
@Controller('worker/reservations')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class ReservationsController {
  constructor(private readonly svc: ReservationsService) {}

  @Post(':id/release')
  @HttpCode(200)
  release(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.release(userId, id);
  }

  @Put(':id/progress')
  progress(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(reservationProgressSchema)) body: never) {
    return this.svc.progress(userId, id, body);
  }

  @Post(':id/submit')
  submit(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(submitProofSchema)) body: { steps_checked: number[]; proof_items: ProofInput[]; worker_note: string | null; attestation: true },
  ) {
    return this.svc.submit(userId, id, body);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ProofChecksService],
  exports: [ReservationsService, ProofChecksService],
})
export class ReservationsModule {}
