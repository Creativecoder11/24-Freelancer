import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** Reads `platform_settings` (Doc 05 §8.2) with a 30 s in-process cache. */
@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load() {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.values;
    const rows = await this.prisma.db.platformSetting.findMany();
    const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.load()).get(key);
    return v === undefined || v === null ? fallback : (v as T);
  }

  async number(key: string, fallback: number): Promise<number> {
    const v = await this.get<unknown>(key, fallback);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  invalidate() {
    this.cache = null;
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
