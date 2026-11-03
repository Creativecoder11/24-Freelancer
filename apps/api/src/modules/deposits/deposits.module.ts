import { Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { queryPage, queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule, CurrentUser, JwtAuthGuard } from '../auth/auth.module';
import { getEnv } from '../../config/env';
import { requireIdemKey } from '../employer/employer-common';
import { EmployerWalletModule } from '../employer-wallet/employer-wallet.module';
import { JobsModule } from '../jobs/jobs.module';
import { DepositsService } from './deposits.service';

const createBody = z.object({
  method: z.enum(['crypto', 'mobile_wallet', 'card'], { errorMap: () => ({ message: 'Choose a payment method.' }) }),
  sub_provider: z.enum(['bkash', 'nagad']).optional(),
  amount_usd: z.string({ required_error: 'Enter an amount.' }).trim(),
  return_to: z.string().max(300).optional(),
});
const listQuery = z.object({ status: z.string().max(20).optional(), page: queryPage, per_page: queryPerPage(10) });
const mockBody = z.object({ outcome: z.enum(['paid', 'failed', 'cancelled']) });

/** Deposits (Doc 06 §5.13). */
@Controller('deposits')
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(private readonly svc: DepositsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser('id') uid: string, @Headers('idempotency-key') key: string | undefined, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: Request) {
    requireIdemKey(key);
    const origin = req.header('origin');
    const allowed = getEnv().CORS_ALLOWED_ORIGINS;
    const webOrigin = origin && allowed.includes(origin) ? origin : getEnv().WEB_APP_URL;
    return this.svc.create(uid, body, webOrigin);
  }

  @Get()
  list(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(uid, q);
  }

  @Get(':ref')
  get(@CurrentUser('id') uid: string, @Param('ref') ref: string) {
    return this.svc.get(uid, ref);
  }
}

/** Incoming payment webhooks (Doc 06 §7.4). Provider signature, no user session. */
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly svc: DepositsService) {}

  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.svc.handleWebhook(provider, req.headers as Record<string, string | string[] | undefined>, body ?? {});
  }
}

/** PAYMENTS_MODE=mock hosted page backend (Doc 06 §7.1). Absent outside local/dev/test. */
@Controller('dev/mock-gateway')
export class MockGatewayController {
  constructor(private readonly svc: DepositsService) {}

  @Get(':ref')
  info(@Param('ref') ref: string) {
    return this.svc.mockInfo(ref);
  }

  @Post(':ref/complete')
  @HttpCode(200)
  complete(@Param('ref') ref: string, @Body(new ZodPipe(mockBody)) body: z.infer<typeof mockBody>) {
    return this.svc.mockComplete(ref, body.outcome);
  }
}

@Module({
  imports: [AuthModule, EmployerWalletModule, JobsModule],
  controllers: [DepositsController, PaymentWebhooksController, MockGatewayController],
  providers: [DepositsService],
})
export class DepositsModule {}
