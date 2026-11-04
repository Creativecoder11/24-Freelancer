import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@24f/db';
import Decimal from 'decimal.js';
import { formatRate } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ApiError } from '../../common/api-error';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface FxRate {
  id: string;
  currency: string;
  rate: Decimal;
  effectiveFrom: Date;
  stale: boolean;
}

/** Hours after which an auto-fetched rate is stale (Canonical §17 FX guard). */
const FX_MAX_AGE_HOURS = Number(process.env.FX_MAX_AGE_HOURS ?? 36);

/**
 * Exchange rates (Doc 05 `exchange_rates`, Doc 08 §6.4.3). The current rate for a currency and
 * direction is the latest row with `effective_from <= now`. Rates entered by an admin (manual
 * source, `fx_auto_fetch_enabled = false`) never go stale; auto-fetched rates are stale after 36 h.
 */
@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async current(currency: string, direction: 'payout' | 'deposit' = 'payout', tx: Tx = this.prisma.db): Promise<FxRate | null> {
    const row = await tx.exchangeRate.findFirst({
      where: { quoteCurrency: currency, direction, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    const auto = await this.settings.get<boolean>('fx_auto_fetch_enabled', false);
    const ageH = (Date.now() - row.effectiveFrom.getTime()) / 3_600_000;
    return {
      id: row.id,
      currency,
      rate: new Decimal(row.rate.toString()),
      effectiveFrom: row.effectiveFrom,
      stale: auto === true && row.source !== 'manual' && ageH > FX_MAX_AGE_HOURS,
    };
  }

  /** Throws FX_RATE_STALE when there is no usable rate. */
  async require(currency: string, tx: Tx = this.prisma.db): Promise<FxRate> {
    const r = await this.current(currency, 'payout', tx);
    if (!r || r.stale) throw new ApiError('FX_RATE_STALE');
    return r;
  }

  /** "1 USD = ৳121.50" or "1 USD = 1 USDT". */
  static label(currency: string, rate: Decimal.Value): string {
    if (currency === 'USDT') return `1 USD = ${new Decimal(rate).toDecimalPlaces(2).toString()} USDT`;
    return formatRate(new Decimal(rate).toFixed(2));
  }

  /** Payout amount: BDT floors to whole taka; USDT 2 dp (BR-WDQ-03, RND-08). */
  static payout(currency: string, net: Decimal, rate: Decimal): Decimal {
    return currency === 'BDT' ? net.times(rate).toDecimalPlaces(0, Decimal.ROUND_DOWN) : net.times(rate).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  }
}

@Global()
@Module({ providers: [FxService], exports: [FxService] })
export class FxModule {}
