import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { queryPage, queryPerPage } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { ApiError } from '../../common/api-error';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReferralService } from './referral.service';

const listQuery = z.object({ tab: z.enum(['all', 'active', 'not_started']).optional().default('all'), page: queryPage, per_page: queryPerPage(20) });
const idPipe = new ParseUUIDPipe({ exceptionFactory: () => new ApiError('NOT_FOUND', 'We couldn’t find that friend.') });

/** Doc 06 §5.14. */
@Controller('referral')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class ReferralController {
  constructor(private readonly svc: ReferralService) {}

  @Get('summary')
  summary(@CurrentUser('id') uid: string) {
    return this.svc.summary(uid);
  }

  @Get('friends')
  async friends(@CurrentUser('id') uid: string, @Query(new ZodPipe(listQuery)) q: { tab: 'all' | 'active' | 'not_started'; page: number; per_page: number }) {
    const r = await this.svc.friends(uid, q);
    return new Paged(r.data, r.meta);
  }

  @Get('friends/:id')
  friend(@CurrentUser('id') uid: string, @Param('id', idPipe) id: string) {
    return this.svc.friend(uid, id);
  }

  @Post('friends/:id/remind')
  @HttpCode(200)
  remind(@CurrentUser('id') uid: string, @Param('id', idPipe) id: string) {
    return this.svc.remind(uid, id);
  }
}

@Module({ imports: [AuthModule], controllers: [ReferralController], providers: [ReferralService] })
export class ReferralModule {}
