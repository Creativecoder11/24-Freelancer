import { Body, Controller, Get, Module, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule, CurrentUser, JwtAuthGuard } from '../auth/auth.module';
import { EmployerService } from './employer.service';

const spendingQuery = z.object({ range: z.enum(['7d', '30d', '90d']).optional().default('7d') });
const profileBody = z
  .object({
    business_name: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => [...s].length >= 2 && [...s].length <= 80, { message: 'Enter your business name (2–80 characters).' })
      .optional(),
    website_url: z
      .string()
      .trim()
      .max(255)
      .refine((s) => s === '' || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(s), { message: 'Enter a full website address starting with https://.' })
      .nullish(),
    industry: z.string().trim().max(60).nullish(),
    billing_email: z
      .string()
      .trim()
      .max(254)
      .refine((s) => s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), { message: 'Enter a valid email address.' })
      .nullish(),
    about: z.string().trim().max(300, 'Keep it under 300 characters.').nullish(),
  })
  .strict();
const defaultsBody = z
  .object({
    default_review_window_hours: z.number().int().optional(),
    default_min_approval_rate: z.number().int().optional(),
    default_auto_approve: z.boolean().optional(),
    default_allow_resubmission: z.boolean().optional(),
    default_pause_on_low_deposit: z.boolean().optional(),
  })
  .strict();

/** Employer overview and profile (Doc 06 §5.8, §5.10). */
@Controller('employer')
@UseGuards(JwtAuthGuard)
export class EmployerController {
  constructor(private readonly svc: EmployerService) {}

  @Get('overview')
  overview(@CurrentUser('id') uid: string) {
    return this.svc.overview(uid);
  }

  @Get('overview/spending')
  spending(@CurrentUser('id') uid: string, @Query(new ZodPipe(spendingQuery)) q: z.infer<typeof spendingQuery>) {
    return this.svc.spending(uid, q.range);
  }

  @Get('profile')
  profile(@CurrentUser('id') uid: string) {
    return this.svc.profile(uid);
  }

  @Patch('profile')
  updateProfile(@CurrentUser('id') uid: string, @Body(new ZodPipe(profileBody)) body: z.infer<typeof profileBody>) {
    return this.svc.updateProfile(uid, body);
  }

  @Patch('job-defaults')
  defaults(@CurrentUser('id') uid: string, @Body(new ZodPipe(defaultsBody)) body: z.infer<typeof defaultsBody>) {
    return this.svc.updateDefaults(uid, body);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [EmployerController],
  providers: [EmployerService],
  exports: [EmployerService],
})
export class EmployerModule {}
