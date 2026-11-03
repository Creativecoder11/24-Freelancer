import { Controller, Get, Module, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { queryPage, queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule, CurrentUser, JwtAuthGuard } from '../auth/auth.module';
import { EmployerModule } from '../employer/employer.module';
import { EmployerWalletService } from './employer-wallet.service';

const TYPES = ['all', 'deposit', 'job_reserve', 'job_spend', 'job_release', 'platform_fee', 'deposit_refund', 'adjustment'] as const;
const RANGES = ['last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'this_year', 'all', 'custom'] as const;
const listQuery = z.object({
  type: z.enum(TYPES).optional().default('all'),
  range: z.enum(RANGES).optional().default('last_30_days'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(80).optional(),
  page: queryPage,
  per_page: queryPerPage(10),
});
const exportQuery = listQuery.extend({ mode: z.enum(['summary', 'detailed']).optional().default('summary') });

/** Employer wallet (Doc 06 §5.13). */
@Controller('employer/wallet')
@UseGuards(JwtAuthGuard)
export class EmployerWalletController {
  constructor(private readonly svc: EmployerWalletService) {}

  @Get()
  summary(@CurrentUser('id') uid: string) {
    return this.svc.summary(uid);
  }

  @Get('transactions')
  list(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.transactions(uid, q);
  }

  @Get('transactions/export')
  async export(@CurrentUser('id') uid: string, @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>, @Res() res: Response) {
    const csv = await this.svc.exportCsv(uid, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(csv.body);
  }
}

@Module({
  imports: [AuthModule, EmployerModule],
  controllers: [EmployerWalletController],
  providers: [EmployerWalletService],
  exports: [EmployerWalletService],
})
export class EmployerWalletModule {}
