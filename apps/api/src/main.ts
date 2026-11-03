import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getEnv } from './config/env';

// Load apps/api/.env for local runs (real environment variables win).
try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env file: rely on the environment */
}

async function bootstrap() {
  const env = getEnv(); // loads .env and validates (Doc 11 §4.3)
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001,http://localhost:3005').split(',').map((o) => o.trim());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'healthz', method: RequestMethod.GET }, { path: 'readyz', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
void bootstrap();
