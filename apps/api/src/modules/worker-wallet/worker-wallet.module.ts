import { Controller, Get, Module, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { queryPage, queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutMethodsModule } from '../payout-methods/payout-methods.module';
import { WorkerWalletService, type LedgerFilterType, type LedgerRange } from './worker-wallet.service';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txQuery = z.object({
  type: z.enum(['all', 'task_reward', 'referral_commission', 'withdrawal', 'withdrawal_reversal', 'adjustment']).optional().default('all'),
  range: z.enum(['last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'this_year', 'all', 'custom']).optional().default('last_30_days'),
  from: ymd.optional(),
  to: ymd.optional(),
  q: z.string().trim().max(80).optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
  page: queryPage,
  per_page: queryPerPage(20),
});
type TxQuery = { type: LedgerFilterType; range: LedgerRange; from?: string; to?: string; q?: string; format: 'json' | 'csv'; page: number; per_page: number };

/** Doc 06 §5.11 worker wallet. */
@Controller('worker/wallet')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class WorkerWalletController {
  constructor(private readonly svc: WorkerWalletService) {}

  @Get()
  summary(@CurrentUser('id') uid: string) {
    return this.svc.summary(uid);
  }

  @Get('earnings-chart')
  chart(@CurrentUser('id') uid: string) {
    return this.svc.chart(uid);
  }

  @Get('transactions')
  async transactions(@CurrentUser('id') uid: string, @Query(new ZodPipe(txQuery)) q: TxQuery, @Res() res: Response) {
    // @Res() takes over the response: CSV is streamed raw, JSON gets the Doc 06 envelope by hand.
    if (q.format === 'csv') {
      const csv = await this.svc.csv(uid, q);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(csv.body);
      return;
    }
    const r = await this.svc.transactions(uid, q);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data: r.data, meta: r.meta, serverTime: new Date().toISOString() });
  }
}

@Module({
  imports: [AuthModule, PayoutMethodsModule],
  controllers: [WorkerWalletController],
  providers: [WorkerWalletService],
})
export class WorkerWalletModule {}
