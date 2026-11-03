import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OtpService } from './otp.service';
import { otpDeliveryProvider } from './otp-delivery';
import { PasswordService } from './password.service';
import { ProfilesService } from './profiles.service';
import { SessionService } from './session.service';

/**
 * Auth (Doc 04 §3). Other modules import AuthModule and use
 * `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` (from './jwt-auth.guard').
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, otpDeliveryProvider, PasswordService, SessionService, ProfilesService, JwtAuthGuard],
  exports: [JwtAuthGuard, SessionService, PasswordService, OtpService, ProfilesService],
})
export class AuthModule {}

export { JwtAuthGuard, CurrentUser, AllowStatus, type AuthUser } from './jwt-auth.guard';
