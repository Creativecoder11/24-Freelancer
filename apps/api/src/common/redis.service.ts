import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getEnv } from '../config/env';

/**
 * Shared ioredis client. Keys are written without a prefix (e.g. `otp:last:<destination>`),
 * so dev tooling can read them directly.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('Redis');
  readonly client: Redis;

  constructor() {
    this.client = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
    this.client.on('error', (e) => this.log.warn(`redis: ${e.message}`));
  }

  /** Fixed-window counter. Returns the count after increment and the window TTL in seconds. */
  async hit(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const res = await this.client.multi().incr(key).ttl(key).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    let ttl = Number(res?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      await this.client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, ttl };
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
