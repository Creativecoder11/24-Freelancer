import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { notificationPreferencesUpdateSchema, notificationsQuerySchema, notificationsReadAllSchema, type NotificationsQuery } from '@24f/shared';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

const audienceQuery = z.object({ audience: z.enum(['worker', 'employer']).optional() });

/** Doc 06 §5.15. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  async list(@CurrentUser('id') userId: string, @Query(new ZodPipe(notificationsQuerySchema)) q: NotificationsQuery) {
    const r = await this.svc.list(userId, q);
    return new Paged(r.data, r.meta as unknown as Record<string, unknown>);
  }

  @Get('unread-count')
  unread(@CurrentUser('id') userId: string, @Query(new ZodPipe(audienceQuery)) q: { audience?: 'worker' | 'employer' }) {
    return this.svc.unreadCount(userId, q.audience);
  }

  @Get('preferences')
  preferences(@CurrentUser('id') userId: string) {
    return this.svc.preferences(userId);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser('id') userId: string, @Body(new ZodPipe(notificationPreferencesUpdateSchema)) body: z.output<typeof notificationPreferencesUpdateSchema>) {
    return this.svc.updatePreferences(userId, body.preferences);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser('id') userId: string, @Body(new ZodPipe(notificationsReadAllSchema)) body: { audience?: 'worker' | 'employer'; category?: string }) {
    return this.svc.markAllRead(userId, body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.markRead(userId, id);
  }
}

/** Global so any module can inject NotificationsService and call `notify()`. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
