import { Body, Controller, Get, HttpCode, Module, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { avatarSchema, closeAccountSchema, kycSubmitSchema, type KycDocumentType } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycService } from './kyc.service';

const closeSchema = closeAccountSchema.and(z.object({ reason: z.string().max(500).optional() }));

/** `/me/kyc` (Doc 06 §5.3) and the Settings account endpoints `/me/avatar`, `/me/close` (§5.2). */
@Controller('me')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class KycController {
  constructor(private readonly svc: KycService) {}

  @Get('kyc')
  get(@CurrentUser('id') uid: string) {
    return this.svc.get(uid);
  }

  @Post('kyc')
  submit(@CurrentUser('id') uid: string, @Body(new ZodPipe(kycSubmitSchema)) body: z.output<typeof kycSubmitSchema>) {
    return this.svc.submit(uid, { ...body, document_type: body.document_type as KycDocumentType });
  }

  @Post('avatar')
  @HttpCode(200)
  avatar(@CurrentUser('id') uid: string, @Body(new ZodPipe(avatarSchema)) body: { upload_id: string | null }) {
    return this.svc.setAvatar(uid, body.upload_id);
  }

  @Post('close')
  @HttpCode(200)
  close(@CurrentUser('id') uid: string, @Body(new ZodPipe(closeSchema)) body: { dry_run: boolean; password?: string; confirm_text?: string; reason?: string }) {
    return this.svc.close(uid, body);
  }
}

/** `POST /employer/profile/logo` (Doc 06 §5.10) plus a read of the current logo URL. */
@Controller('employer/profile/logo')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class EmployerLogoController {
  constructor(private readonly svc: KycService) {}

  @Get()
  get(@CurrentUser('id') uid: string) {
    return this.svc.logo(uid);
  }

  @Post()
  @HttpCode(200)
  set(@CurrentUser('id') uid: string, @Body(new ZodPipe(avatarSchema)) body: { upload_id: string | null }) {
    return this.svc.setLogo(uid, body.upload_id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [KycController, EmployerLogoController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
