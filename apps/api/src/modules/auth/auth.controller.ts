import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  COOKIE_NAMES,
  forgotPasswordSchema,
  loginOtpSchema,
  loginSchema,
  otpResendSchema,
  otpVerifySchema,
  registerSchema,
  resetPasswordSchema,
  type RegisterBody,
} from '@24f/shared';
import { getEnv } from '../../config/env';
import { ZodPipe } from '../../common/zod.pipe';
import { ApiError } from '../../common/api-error';
import { AuthService, type SignedIn } from './auth.service';
import { SessionService } from './session.service';

/** User auth endpoints (Doc 06 §5.1). */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private finish(res: Response, s: SignedIn) {
    this.sessions.setAuthCookies(res, s.refreshToken, s.keepSignedIn, s.expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    return s.body;
  }

  /** Cookie-authenticated endpoints need an allowed Origin (Doc 06 §2.1 CSRF). */
  private assertOrigin(req: Request) {
    const origin = req.header('origin');
    if (!origin || !getEnv().CORS_ALLOWED_ORIGINS.includes(origin)) throw new ApiError('FORBIDDEN', 'Request origin not allowed.');
  }

  @Post('register')
  @HttpCode(201)
  register(@Body(new ZodPipe(registerSchema)) body: RegisterBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = this.sessions.context(req, res);
    return this.auth.register(body, req.cookies?.[COOKIE_NAMES.referral], ctx);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: { identifier: string; password: string; keep_signed_in: boolean },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.sessions.context(req, res);
    const r = await this.auth.login(body, ctx);
    return r.signedIn ? this.finish(res, r.signedIn) : r.otp;
  }

  @Post('login/otp')
  @HttpCode(200)
  loginOtp(
    @Body(new ZodPipe(loginOtpSchema)) body: { identifier: string; keep_signed_in: boolean },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.loginOtp(body, this.sessions.context(req, res));
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(otpVerifySchema)) body: { challenge_id: string; code: string; keep_signed_in?: boolean },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.verify(body, this.sessions.context(req, res));
    if (r.signedIn) return this.finish(res, r.signedIn);
    res.setHeader('Cache-Control', 'no-store');
    return r.reset;
  }

  @Post('otp/resend')
  @HttpCode(200)
  resend(@Body(new ZodPipe(otpResendSchema)) body: { challenge_id: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.resend(body.challenge_id, this.sessions.context(req, res));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    try {
      const r = await this.auth.refresh(req.cookies?.[getEnv().REFRESH_COOKIE_NAME]);
      this.sessions.setAuthCookies(res, r.refreshToken, r.session.keepSignedIn, r.session.expiresAt);
      res.setHeader('Cache-Control', 'no-store');
      return { access_token: r.accessToken, expires_in: r.expiresIn };
    } catch (e) {
      if (e instanceof ApiError && e.code !== 'REFRESH_RACE') this.sessions.clearAuthCookies(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let sid: string | null = null;
    const m = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
    if (m) {
      try {
        sid = this.sessions.verifyAccess(m[1]!.trim()).sid;
      } catch {
        sid = null;
      }
    }
    if (!sid) this.assertOrigin(req);
    await this.auth.logout(req.cookies?.[getEnv().REFRESH_COOKIE_NAME], sid);
    this.sessions.clearAuthCookies(res);
    return { signed_out: true };
  }

  @Post('password/forgot')
  @HttpCode(200)
  forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { identifier: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.forgot(body, this.sessions.context(req, res));
  }

  @Post('password/reset')
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(resetPasswordSchema)) body: { reset_token: string; new_password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.reset(body, this.sessions.context(req, res));
    return this.finish(res, s);
  }
}
