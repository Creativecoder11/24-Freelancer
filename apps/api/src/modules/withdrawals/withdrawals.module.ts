import { Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PAYOUT_METHOD_TYPE, queryPage, queryPerPage, type PayoutMethodType } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutMethodsModule } from '../payout-methods/payout-methods.module';
import { WithdrawalsService, type WithdrawalTab } from './withdrawals.service';
import { requireIdempotencyKey, withIdempotency } from './idempotency';

const quoteQuery = z.object({
  payout_method_id: z.string().uuid().optional(),
  method: z.enum(PAYOUT_METHOD_TYPE.values as unknown as [string, ...string[]]).optional(),
  account: z.string().trim().max(64).optional(),
  amount: z.string().trim().max(20).optional(),
});
const requestBody = z.object({
  payout_method_id: z.string({ required_error: 'Choose where to send your money.' }).uuid('Choose where to send your money.'),
  amount_usd: z.string({ required_error: 'Enter an amount.' }).trim().min(1, 'Enter an amount.').max(20),
  quote_id: z.string({ required_error: 'Refresh the summary and try again.' }).uuid('Refresh the summary and try again.'),
  password: z.string({ required_error: 'Enter your account password.' }).min(1, 'Enter your account password.'),
  otp_challenge_id: z.string().uuid().optional(),
  otp_code: z.string().regex(/^\d{6}$/).optional(),
});
const listQuery = z.object({ tab: z.enum(['all', 'processing', 'paid', 'rejected']).optional().default('all'), page: queryPage, per_page: queryPerPage(10) });

/** Doc 06 §5.12. */
@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class WithdrawalsController {
  constructor(
    private readonly svc: WithdrawalsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('quote')
  quote(@CurrentUser('id') uid: string, @Query(new ZodPipe(quoteQuery)) q: z.infer<typeof quoteQuery>) {
    return this.svc.quote(uid, { ...q, method: q.method as PayoutMethodType | undefined });
  }

  @Post()
  request(
    @CurrentUser('id') uid: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(requestBody)) body: z.infer<typeof requestBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = requireIdempotencyKey(key);
    return withIdempotency(this.prisma, { userId: uid, key: k, method: 'POST', path: '/withdrawals', body, res }, async () => ({
      status: 201,
      body: await this.svc.request(uid, body, { ip: req.ip ?? null }),
    }));
  }

  @Get()
  async list(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: { tab: WithdrawalTab; page: number; per_page: number }) {
    const r = await this.svc.list(uid, q);
    return new Paged(r.data, r.meta);
  }

  @Get(':ref')
  detail(@CurrentUser('id') uid: string, @Param('ref') ref: string) {
    return this.svc.detail(uid, ref);
  }

  @Post(':ref/cancel')
  @HttpCode(200)
  cancel(@CurrentUser('id') uid: string, @Param('ref') ref: string, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const k = requireIdempotencyKey(key);
    return withIdempotency(this.prisma, { userId: uid, key: k, method: 'POST', path: `/withdrawals/${ref.toUpperCase()}/cancel`, body: {}, res }, async () => ({
      status: 200,
      body: await this.svc.cancel(uid, ref),
    }));
  }
}

/** Exports WithdrawalsService so the admin module can call the `admin*` processing methods. */
@Module({
  imports: [AuthModule, PayoutMethodsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
