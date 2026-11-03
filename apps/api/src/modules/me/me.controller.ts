import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  changePasswordSchema,
  interestsSchema,
  onboardingSchema,
  preferencesSchema,
  securitySchema,
  updateMeSchema,
  type ActiveMode,
} from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { ApiError } from '../../common/api-error';
import { CurrentUser, JwtAuthGuard, type AuthUser } from '../auth/jwt-auth.guard';
import { MeService } from './me.service';

/** Me and account endpoints (Doc 06 §5.2). */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentUser('id') id: string) {
    return this.me.me(id);
  }

  @Patch()
  update(@CurrentUser('id') id: string, @Body(new ZodPipe(updateMeSchema)) body: { full_name?: string; country_code?: string }) {
    return this.me.update(id, body);
  }

  @Patch('preferences')
  preferences(
    @CurrentUser('id') id: string,
    @Body(new ZodPipe(preferencesSchema))
    body: { active_mode?: ActiveMode; default_mode?: ActiveMode | null; email_digest_enabled?: boolean; setup_card_dismissed?: boolean },
  ) {
    return this.me.preferences(id, body);
  }

  @Put('interests')
  interests(
    @CurrentUser('id') id: string,
    @Body(new ZodPipe(interestsSchema)) body: { categories: string[]; interest_time?: string | null; interest_device?: string | null },
  ) {
    return this.me.interests(id, body);
  }

  @Post('onboarding')
  @HttpCode(200)
  onboarding(@CurrentUser('id') id: string, @Body(new ZodPipe(onboardingSchema)) body: Record<string, unknown> & { step: string }) {
    return this.me.onboarding(id, body);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    const rows = await this.me.listSessions(user);
    return new Paged(rows, { total: rows.length });
  }

  @Delete('sessions/:id')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new ApiError('SESSION_NOT_FOUND') })) sessionId: string,
  ) {
    return this.me.revokeSession(user, sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.me.revokeOthers(user);
  }

  @Post('password')
  @HttpCode(200)
  password(@CurrentUser('id') id: string, @Body(new ZodPipe(changePasswordSchema)) body: { current_password: string; new_password: string }) {
    return this.me.changePassword(id, body);
  }

  @Patch('security')
  security(@CurrentUser('id') id: string, @Body(new ZodPipe(securitySchema)) body: { two_step_enabled: boolean; password?: string }) {
    return this.me.security(id, body);
  }
}
