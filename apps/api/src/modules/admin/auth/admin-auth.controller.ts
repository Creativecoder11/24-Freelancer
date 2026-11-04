import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, type AdminCtx, type AdminRequest } from '../core/admin-context';
import { AdminSessionService } from '../core/admin-session.service';

const bearer = (req: Request) => /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '')?.[1]?.trim();
const noStore = (res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
};

/** Doc 06 §6.1 — admin auth. Public routes; `reauth` and `me` need the admin bearer. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly svc: AdminAuthService,
    private readonly sessions: AdminSessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string; totp_code?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    return this.svc.login(body ?? {}, req, res);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    return this.svc.refresh(req, res);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    return this.svc.logout(req, res, req.admin ?? null);
  }

  @Post('set-password')
  @HttpCode(200)
  setPassword(@Body() body: { token?: string; new_password?: string }, @Req() req: Request) {
    return this.svc.setPassword(body ?? {}, bearer(req));
  }

  @Post('totp/enrol')
  @HttpCode(200)
  enrol(@Req() req: Request) {
    return this.svc.totpEnrol(bearer(req));
  }

  @Post('totp/confirm')
  @HttpCode(200)
  confirm(@Body() body: { totp_code?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.svc.totpConfirm(bearer(req), body?.totp_code, req, res);
  }

  @Post('reauth')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @UseInterceptors(AdminAuditInterceptor)
  reauth(@Admin() ctx: AdminCtx, @Body() body: { totp_code?: string }) {
    return this.svc.reauth(ctx, body?.totp_code);
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminMeController {
  constructor(private readonly svc: AdminAuthService) {}

  @Get('me')
  me(@Admin() ctx: AdminCtx) {
    return this.svc.me(ctx);
  }
}
