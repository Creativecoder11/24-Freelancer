import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RedisService } from '../../common/redis.service';

/**
 * Payment provider adapter (Doc 08 §8.2). Each real gateway (bKash, Nagad, SSLCommerz,
 * NOWPayments…) implements this once credentials exist (D-06). Until then the `mock`
 * adapter serves local and dev builds: its hosted page is `/dev/mock-gateway/{ref}` on the
 * web app, and it signs webhooks NOWPayments-style (HMAC-SHA512 over the JSON with sorted keys).
 */
export interface CreatePaymentInput {
  ref: string;
  amountUsd: string;
  chargeAmountBdt: string | null;
  method: 'crypto' | 'mobile_wallet' | 'card';
  webOrigin: string;
  expiresAt: Date;
}

export interface ProviderPaymentStatus {
  status: 'paid' | 'pending' | 'failed' | 'cancelled' | 'unknown';
  orderId: string;
  amountUsd: string | null;
  currency: string;
}

export interface PaymentProviderAdapter {
  readonly slot: string;
  readonly systemCode: string;
  createPayment(input: CreatePaymentInput): Promise<{ providerPaymentId: string; checkoutUrl: string }>;
  verifySignature(headers: Record<string, string | string[] | undefined>, canonicalBody: string): boolean;
  /** WH-3: server-to-server status query; its answer is the truth, never the webhook body. */
  queryPayment(providerPaymentId: string): Promise<ProviderPaymentStatus>;
  eventId(body: Record<string, unknown>): string | null;
}

/** JSON with keys sorted at every level (the string the signature covers). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

export function mockSecret() {
  return process.env.MOCK_PAYMENTS_SECRET ?? 'dev-only-mock-payments-secret-change-me-0123456789';
}

export function mockSign(canonicalBody: string) {
  return createHmac('sha512', mockSecret()).update(canonicalBody).digest('hex');
}

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly slot = 'mock';
  readonly systemCode = 'gateway_clearing:mock';

  constructor(private readonly redis: RedisService) {}

  async createPayment(input: CreatePaymentInput) {
    const providerPaymentId = `mock_${input.ref}_${Date.now().toString(36)}`;
    await this.redis.client.set(`mockpay:${providerPaymentId}`, JSON.stringify({ status: 'pending', ref: input.ref, amount_usd: input.amountUsd }), 'EX', 86_400 * 7);
    return { providerPaymentId, checkoutUrl: `${input.webOrigin}/dev/mock-gateway/${input.ref}` };
  }

  verifySignature(headers: Record<string, string | string[] | undefined>, canonicalBody: string) {
    const sig = headers['x-mock-signature'];
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return false;
    const want = Buffer.from(mockSign(canonicalBody), 'hex');
    const got = Buffer.from(sig, 'hex');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async queryPayment(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    const raw = await this.redis.client.get(`mockpay:${providerPaymentId}`).catch(() => null);
    if (!raw) return { status: 'unknown', orderId: '', amountUsd: null, currency: 'USD' };
    const v = JSON.parse(raw) as { status: ProviderPaymentStatus['status']; ref: string; amount_usd: string };
    return { status: v.status, orderId: v.ref, amountUsd: v.amount_usd, currency: 'USD' };
  }

  /** Records what the payer did on the mock hosted page (stands in for the provider's own state). */
  async setOutcome(providerPaymentId: string, status: 'paid' | 'failed' | 'cancelled') {
    const raw = await this.redis.client.get(`mockpay:${providerPaymentId}`);
    const v = raw ? JSON.parse(raw) : {};
    await this.redis.client.set(`mockpay:${providerPaymentId}`, JSON.stringify({ ...v, status }), 'EX', 86_400 * 7);
  }

  eventId(body: Record<string, unknown>) {
    return typeof body.event_id === 'string' ? body.event_id : null;
  }
}
