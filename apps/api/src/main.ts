import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getEnv } from './config/env';

// Load apps/api/.env for local runs (real environment variables win).
try {
  process.loadEnvFile?.('.env');
} catch {
  try {
    process.loadEnvFile?.('apps/api/.env');
  } catch {
    /* no .env file: rely on the environment */
  }
}

async function bootstrap() {
  const env = getEnv(); // loads .env and validates (Doc 11 §4.3)
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001,http://localhost:3005').split(',').map((o) => o.trim());
  // Traffic arrives via nginx → Next.js rewrite → API, so without this every request has the
  // proxy's IP and all per-IP limits (throttler, OTP, login lockout, admin allowlist) are shared
  // by every user. 'loopback' trusts X-Forwarded-For only from same-host proxies, so a client
  // hitting the API directly can't spoof it. TRUST_PROXY=<n> sets an exact hop count instead.
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY > 0 ? env.TRUST_PROXY : 'loopback');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: origins, credentials: true });

  const serveAsset = (filename: string, contentType: string) => (_req: Request, res: Response, next: NextFunction) => {
    const file = [path.resolve(process.cwd(), 'assets', filename), path.resolve(process.cwd(), 'apps/api/assets', filename)].find((p) => fs.existsSync(p));
    if (!file) return next();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type(contentType);
    res.sendFile(file);
  };
  app.use('/favicon.ico', serveAsset('favicon.ico', 'image/x-icon'));
  app.use('/icon.svg', serveAsset('icon.svg', 'image/svg+xml'));

  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'healthz', method: RequestMethod.GET }, { path: 'readyz', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  // Behind proxies (Next.js rewrites, load balancers) keep idle sockets open longer than the proxy does,
  // so a reused keep-alive connection is never closed mid-request.
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}
void bootstrap();
