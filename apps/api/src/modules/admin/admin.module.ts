import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewModule } from '../review/review.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayoutMethodsModule } from '../payout-methods/payout-methods.module';
import { FxModule } from '../fx/fx.service';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { AdminAuthController, AdminMeController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminGuard, AdminAuditInterceptor } from './core/admin.guard';
import { AdminSessionService } from './core/admin-session.service';
import { AuditService } from './core/audit.service';
import { DualControlService } from './core/dual-control';
import { AdminNotifier } from './core/notify';
import { AdminUsersController, AdminUsersService } from './users/admin-users';
import { AdminJobsController, AdminJobsService } from './jobs/admin-jobs';
import { AdminWorkController, AdminWorkService } from './work/admin-work';
import { AdminKycController, AdminKycService } from './kyc/admin-kyc';
import { AdminWithdrawalsController, AdminWithdrawalsService } from './money/admin-withdrawals';
import { AdminDepositsController, AdminDepositsService } from './money/admin-deposits';
import { AdminLedgerController, AdminLedgerService } from './money/admin-ledger';
import { AdminSettingsController, AdminSettingsService } from './system/admin-settings';
import { AdminCmsController, AdminCmsService } from './system/admin-cms';
import { AdminOpsController, AdminOpsService } from './system/admin-ops';

/**
 * Admin API (`/api/v1/admin/*`, Doc 06 §6, Doc 09). Separate identity (`admin_users`,
 * `admin_sessions`), AdminGuard with permission keys, audit rows on every write.
 */
@Module({
  imports: [AuthModule, ReviewModule, NotificationsModule, PayoutMethodsModule, FxModule, WithdrawalsModule],
  controllers: [
    AdminAuthController,
    AdminMeController,
    AdminOpsController,
    AdminUsersController,
    AdminKycController,
    AdminJobsController,
    AdminWorkController,
    AdminDepositsController,
    AdminWithdrawalsController,
    AdminLedgerController,
    AdminSettingsController,
    AdminCmsController,
  ],
  providers: [
    AdminAuthService,
    AdminSessionService,
    AuditService,
    DualControlService,
    AdminNotifier,
    AdminGuard,
    AdminAuditInterceptor,
    AdminUsersService,
    AdminJobsService,
    AdminWorkService,
    AdminKycService,
    AdminWithdrawalsService,
    AdminDepositsService,
    AdminLedgerService,
    AdminSettingsService,
    AdminCmsService,
    AdminOpsService,
  ],
})
export class AdminModule {}
