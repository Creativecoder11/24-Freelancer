import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { queryPage, queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/auth.module';
import { requireIdemKey } from '../employer/employer-common';
import { JobsService } from './jobs.service';
import { jobWriteSchema, type JobWrite } from './job-rules';

const listQuery = z.object({
  tab: z.enum(['running', 'paused', 'completed', 'drafts']).optional().default('running'),
  q: z.string().trim().max(80).optional(),
  page: queryPage,
  per_page: queryPerPage(10),
});
const quoteBody = z.object({ reward_usd: z.string().optional(), slots_total: z.number().int().optional() });
const publishBody = z.object({ posting_rules_accepted: z.boolean().optional(), expected_total_reserved_usd: z.string().optional() });
const resumeBody = z.object({ expected_reserve_usd: z.string().optional() });
const slotsBody = z.object({ add_slots: z.number().int(), expected_amount_usd: z.string().optional() });
const marketQuery = z.object({ category: z.string().optional(), time_per_task: z.string().optional() });

/** Employer jobs (Doc 06 §5.8). */
@Controller('employer')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  list(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.jobs.list(uid, q);
  }

  @Post('jobs')
  @HttpCode(201)
  create(@CurrentUser('id') uid: string, @Body(new ZodPipe(jobWriteSchema)) body: JobWrite) {
    return this.jobs.create(uid, body);
  }

  @Get('job-categories')
  categories() {
    return this.jobs.categories();
  }

  @Get('market-rates')
  market(@Query(new ZodPipe(marketQuery)) q: z.infer<typeof marketQuery>) {
    return this.jobs.marketRates(q);
  }

  @Get('jobs/:publicId')
  get(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.get(uid, id);
  }

  @Patch('jobs/:publicId')
  update(@CurrentUser('id') uid: string, @Param('publicId') id: string, @Body(new ZodPipe(jobWriteSchema)) body: JobWrite) {
    return this.jobs.update(uid, id, body);
  }

  @Delete('jobs/:publicId')
  remove(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.remove(uid, id);
  }

  @Post('jobs/:publicId/quote')
  @HttpCode(200)
  quote(@CurrentUser('id') uid: string, @Param('publicId') id: string, @Body(new ZodPipe(quoteBody)) body: z.infer<typeof quoteBody>) {
    return this.jobs.quote(uid, id, body);
  }

  @Post('jobs/:publicId/publish')
  @HttpCode(200)
  publish(
    @CurrentUser('id') uid: string,
    @Param('publicId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(publishBody)) body: z.infer<typeof publishBody>,
  ) {
    requireIdemKey(key);
    return this.jobs.publish(uid, id, body);
  }

  @Post('jobs/:publicId/pause')
  @HttpCode(200)
  @AllowStatus('active', 'restricted')
  pause(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.pause(uid, id);
  }

  @Post('jobs/:publicId/resume')
  @HttpCode(200)
  resume(@CurrentUser('id') uid: string, @Param('publicId') id: string, @Body(new ZodPipe(resumeBody)) body: z.infer<typeof resumeBody>) {
    return this.jobs.resume(uid, id, body);
  }

  @Post('jobs/:publicId/close')
  @HttpCode(200)
  @AllowStatus('active', 'restricted')
  close(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.close(uid, id);
  }

  @Post('jobs/:publicId/slots')
  @HttpCode(200)
  slots(
    @CurrentUser('id') uid: string,
    @Param('publicId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(slotsBody)) body: z.infer<typeof slotsBody>,
  ) {
    return this.jobs.addSlots(uid, id, body, requireIdemKey(key));
  }

  @Post('jobs/:publicId/duplicate')
  @HttpCode(201)
  duplicate(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.duplicate(uid, id);
  }

  @Get('jobs/:publicId/performance')
  performance(@CurrentUser('id') uid: string, @Param('publicId') id: string) {
    return this.jobs.performance(uid, id);
  }
}
