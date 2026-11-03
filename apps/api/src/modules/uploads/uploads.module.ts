import { Body, Controller, Get, Global, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { presignSchema } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadsService } from './uploads.service';

/** Doc 06 §5.4. Signed-in routes plus the two signed-URL routes that stand in for S3 (local driver). */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly svc: UploadsService) {}

  @Post('presign')
  @UseGuards(JwtAuthGuard)
  @AllowStatus('active', 'restricted')
  presign(@CurrentUser('id') userId: string, @Body(new ZodPipe(presignSchema)) body: { purpose: string; filename: string; content_type: string; size_bytes: number }) {
    return this.svc.presign(userId, body);
  }

  /** Presigned PUT target (no session; the HMAC signature authorises it). */
  @Put(':id/content')
  @HttpCode(200)
  async put(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: Request,
  ) {
    await this.svc.receive(id, Number(exp), sig, contentType, req);
    return { upload_id: id, status: 'pending' };
  }

  @Post(':id/complete')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @AllowStatus('active', 'restricted')
  complete(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.complete(userId, id);
  }

  /** Signed download (thumbnails and full files are referenced from <img> tags, so no bearer header). */
  @Get(':id/file')
  async file(@Param('id', new ParseUUIDPipe()) id: string, @Query('v') v: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const f = await this.svc.readSigned(id, v ?? 'full', Number(exp), sig);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', f.disposition);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.data);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @AllowStatus('active', 'restricted')
  get(@CurrentUser('id') userId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.get(userId, id);
  }
}

@Global()
@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
