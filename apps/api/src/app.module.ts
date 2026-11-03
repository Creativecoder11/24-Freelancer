import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma.service';
import { ErrorFilter } from './common/error.filter';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { requestId } from './common/request-id.middleware';
import { SettingsModule } from './modules/settings/settings.service';
import { PublicModule } from './modules/public/public.module';
import { LedgerModule } from './modules/ledger/ledger.service';
import { HealthController } from './modules/health/health.controller';
import { RedisModule } from './common/redis.service';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
// Employer app (overview, jobs, review, wallet, deposits)
import { EmployerCoreModule } from './modules/employer/employer-common';
import { EmployerModule } from './modules/employer/employer.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ReviewModule } from './modules/review/review.controller';
import { EmployerWalletModule } from './modules/employer-wallet/employer-wallet.module';
import { DepositsModule } from './modules/deposits/deposits.module';

// Worker app (jobs, reservations, submissions, uploads, disputes, notifications)
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { WorkerModule } from './modules/worker/worker.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { DisputesModule } from './modules/disputes/disputes.module';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]), PrismaModule, SettingsModule, LedgerModule, PublicModule, RedisModule, AuthModule, MeModule, EmployerCoreModule, EmployerModule, JobsModule, ReviewModule, EmployerWalletModule, DepositsModule, ScheduleModule.forRoot(), NotificationsModule, UploadsModule, ReservationsModule, WorkerModule, SubmissionsModule, DisputesModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestId).forRoutes('*');
  }
}
