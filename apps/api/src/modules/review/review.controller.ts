import { Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AllowStatus, AuthModule, CurrentUser, JwtAuthGuard } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { requireIdemKey, usd3 } from '../employer/employer-common';
import { ApprovalService } from './approval.service';
import { ReferralCreditService } from '../employer/referral-credit';
import { ReviewService } from './review.service';

const listQuery = z.object({
  job: z.string().trim().max(12).optional(),
  tab: z.enum(['to_review', 'approved', 'rejected']).optional().default('to_review'),
  cursor: z.string().max(200).optional(),
  per_page: queryPerPage(20),
});
const detailQuery = z.object({ job: z.string().max(12).optional(), tab: z.string().max(20).optional() });
const rejectBody = z.object({
  reason_code: z.enum(['proof_incomplete', 'steps_not_followed', 'wrong_or_copied', 'link_not_accessible', 'other'], {
    errorMap: () => ({ message: 'Choose a reason.' }),
  }),
  reason_text: z
    .string({ required_error: 'Tell the worker what was wrong (10–300 characters).' })
    .transform((s) => s.trim())
    .refine((s) => [...s].length >= 10 && [...s].length <= 300, { message: 'Tell the worker what was wrong (10–300 characters).' }),
  allow_fix: z.boolean(),
  job: z.string().max(12).optional(),
});
const bulkBody = z.object({ refs: z.array(z.string().max(12)).min(1, 'Select up to 100 submissions.').max(100, 'Select up to 100 submissions.') });

/** Employer review (Doc 06 §5.9). */
@Controller('employer/submissions')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    private readonly approval: ApprovalService,
  ) {}

  @Get()
  list(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.review.list(uid, q);
  }

  @Post('bulk-approve')
  @HttpCode(200)
  async bulk(@CurrentUser('id') uid: string, @Headers('idempotency-key') key: string | undefined, @Body(new ZodPipe(bulkBody)) body: z.infer<typeof bulkBody>) {
    requireIdemKey(key);
    const r = await this.approval.bulkApprove(uid, body.refs);
    const after = await this.review.afterDecision(uid, '');
    return { ...r, badges: after.badges };
  }

  @Get(':ref')
  detail(@CurrentUser('id') uid: string, @Param('ref') ref: string, @Query(new ZodPipe(detailQuery)) q: z.infer<typeof detailQuery>) {
    return this.review.detail(uid, ref, q);
  }

  @Post(':ref/approve')
  @HttpCode(200)
  @AllowStatus('active', 'restricted')
  async approve(@CurrentUser('id') uid: string, @Param('ref') ref: string, @Headers('idempotency-key') key: string | undefined, @Query(new ZodPipe(detailQuery)) q: z.infer<typeof detailQuery>) {
    requireIdemKey(key);
    const r = await this.approval.approve(uid, ref);
    const after = await this.review.afterDecision(uid, ref, q.job);
    return {
      ref: r.ref,
      status: 'approved',
      decision_source: 'employer',
      decided_at: new Date().toISOString(),
      paid_usd: usd3(r.rewardUsd),
      ledger_ref: r.ledgerRef,
      job: await this.review.jobSummary(r.jobId),
      ...after,
    };
  }

  @Post(':ref/reject')
  @HttpCode(200)
  @AllowStatus('active', 'restricted')
  async reject(@CurrentUser('id') uid: string, @Param('ref') ref: string, @Body(new ZodPipe(rejectBody)) body: z.infer<typeof rejectBody>) {
    const r = await this.approval.reject(uid, ref, body);
    const after = await this.review.afterDecision(uid, ref, body.job);
    return { ...r, ...after };
  }
}

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ReviewController],
  providers: [ReviewService, ApprovalService, ReferralCreditService],
  exports: [ApprovalService],
})
export class ReviewModule {}
