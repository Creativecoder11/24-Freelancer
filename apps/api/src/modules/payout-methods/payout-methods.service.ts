import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Prisma, PrismaClient } from '@24f/db';
import type { PayoutMethodType } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { PasswordService } from '../auth/password.service';
import { blindIndex, encryptPii, piiKeyId } from './pii.crypto';
import { ACCOUNT_ERROR, accountValid, destinationLabel, last3, maskAccount, maskFull, methodLabel, normaliseAccount } from './payout-account';
import { notifyDirect } from './direct-notify';

type Tx = Prisma.TransactionClient | PrismaClient;
type MethodRow = Prisma.PayoutMethodGetPayload<{ include: { methodTypeRef: true } }>;
type ConfigRow = Prisma.PayoutMethodConfigGetPayload<object>;

const money2 = (d: Prisma.Decimal | Decimal.Value) => new Decimal(d.toString()).toFixed(2, Decimal.ROUND_DOWN);

export interface PayoutMethodDto {
  id: string;
  method_type: PayoutMethodType;
  label: string;
  display_name: string;
  account_masked: string;
  account_last3: string;
  destination_label: string;
  is_default: boolean;
  status: 'active' | 'pending_review' | 'disabled';
  usable_from: string;
  in_cooldown: boolean;
  method_enabled: boolean;
  created_at: string;
}

export interface MethodConfigDto {
  method_type: PayoutMethodType;
  display_name: string;
  subtitle: string;
  account_label: string;
  account_regex: string;
  payout_currency: string;
  min_usd: string;
  max_per_request_usd: string;
  fee_fixed_usd: string;
  fee_percent: string;
  quick_amounts_usd: string[];
  eta_text: string;
  enabled: boolean;
}

/** Payout methods (Doc 06 §5.11, Doc 08 §6.3, G-04). */
@Injectable()
export class PayoutMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
  ) {}

  configDto(c: ConfigRow): MethodConfigDto {
    const quick = Array.isArray(c.quickAmountsUsd) ? (c.quickAmountsUsd as (string | number)[]) : [];
    return {
      method_type: c.methodType as PayoutMethodType,
      display_name: c.displayName,
      subtitle: c.subtitle,
      account_label: c.accountLabel,
      account_regex: c.accountRegex,
      payout_currency: c.payoutCurrency.trim(),
      min_usd: money2(c.minUsd),
      max_per_request_usd: money2(c.maxPerRequestUsd),
      fee_fixed_usd: money2(c.feeFixedUsd),
      fee_percent: new Decimal(c.feePercent.toString()).toString(),
      quick_amounts_usd: quick.map((q) => new Decimal(String(q)).toFixed(2)),
      eta_text: c.etaText,
      enabled: c.enabled,
    };
  }

  async configs(tx: Tx = this.prisma.db) {
    const rows = await tx.payoutMethodConfig.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => this.configDto(r));
  }

  async config(method: PayoutMethodType, tx: Tx = this.prisma.db) {
    return tx.payoutMethodConfig.findUnique({ where: { methodType: method } });
  }

  dto(m: MethodRow): PayoutMethodDto {
    const method = m.methodType as PayoutMethodType;
    const masked = maskFull(m.accountMasked);
    return {
      id: m.id,
      method_type: method,
      label: methodLabel(method, m.methodTypeRef.displayName, m.accountLabel),
      display_name: m.methodTypeRef.displayName,
      account_masked: masked,
      account_last3: m.accountLast3,
      destination_label: destinationLabel(method, m.accountMasked, m.accountLast3),
      is_default: m.isDefault,
      status: m.status as PayoutMethodDto['status'],
      usable_from: m.usableFrom.toISOString(),
      in_cooldown: m.usableFrom.getTime() > Date.now(),
      method_enabled: m.methodTypeRef.enabled,
      created_at: m.createdAt.toISOString(),
    };
  }

  async listRows(userId: string, tx: Tx = this.prisma.db) {
    return tx.payoutMethod.findMany({
      where: { userId, deletedAt: null },
      include: { methodTypeRef: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** GET /payout-methods. */
  async list(userId: string) {
    const [rows, configs, limit] = await Promise.all([this.listRows(userId), this.configs(), this.settings.number('payout_methods_max', 5)]);
    return {
      data: rows.map((r) => this.dto(r)),
      meta: {
        total: rows.length,
        limit,
        method_configs: configs.filter((c) => c.enabled),
        // Tiles for methods switched off by config (D-35), shown disabled on the withdraw form.
        disabled_methods: configs.filter((c) => !c.enabled).map((c) => ({ method_type: c.method_type, display_name: c.display_name, subtitle: c.subtitle })),
      },
    };
  }

  /** POST /payout-methods. */
  async add(userId: string, dto: { method_type: PayoutMethodType; account: string; is_default?: boolean; password: string; label?: string | null }) {
    await this.passwords.verifyForSensitiveAction(userId, dto.password, 'payout_method', 'password');
    const cfg = await this.config(dto.method_type);
    if (!cfg || !cfg.enabled) throw new ApiError('METHOD_UNAVAILABLE', undefined, { method_type: ["This method isn't available right now. Pick another one."] }, { method: dto.method_type });
    const account = normaliseAccount(dto.method_type, dto.account);
    if (!accountValid(dto.method_type, account, cfg.accountRegex)) throw new ApiError('VALIDATION_FAILED', undefined, { account: [ACCOUNT_ERROR[dto.method_type]] });
    const hash = blindIndex(`${dto.method_type}:${account}`, 'payout_account');
    const limit = await this.settings.number('payout_methods_max', 5);
    const cooldownH = await this.settings.number('payout_method_cooldown_hours', 24);

    const created = await this.prisma.db.$transaction(async (tx) => {
      // Serialise per user so the limit and default rules hold under concurrency.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const existing = await tx.payoutMethod.findMany({ where: { userId, deletedAt: null } });
      if (existing.some((e) => Buffer.from(e.accountHash).equals(Buffer.from(hash)))) throw new ApiError('PAYOUT_METHOD_EXISTS', undefined, { account: ["You've already saved this account."] });
      if (existing.length >= limit) throw new ApiError('PAYOUT_METHOD_LIMIT', undefined, undefined, { limit });
      const everHad = await tx.payoutMethod.count({ where: { userId } });
      const shared = await tx.payoutMethod.findFirst({
        where: { accountHash: hash, userId: { not: userId }, deletedAt: null, user: { status: { in: ['active', 'restricted'] } } },
        select: { id: true },
      });
      const now = new Date();
      // First-ever method: the first-withdrawal hold covers it, so no extra cooldown (Doc 08 §12.4).
      const usableFrom = everHad === 0 ? now : new Date(now.getTime() + cooldownH * 3_600_000);
      const makeDefault = existing.length === 0 || !!dto.is_default;
      if (makeDefault && existing.length) await tx.payoutMethod.updateMany({ where: { userId, deletedAt: null, isDefault: true }, data: { isDefault: false, updatedAt: now } });
      const row = await tx.payoutMethod.create({
        data: {
          userId,
          methodType: dto.method_type,
          accountLabel: dto.label ?? (dto.method_type === 'usdt_trc20' ? null : 'Personal'),
          accountEncrypted: encryptPii(account),
          keyId: piiKeyId(),
          accountHash: hash,
          accountMasked: maskAccount(dto.method_type, account),
          accountLast3: last3(account),
          status: shared ? 'pending_review' : 'active',
          isDefault: makeDefault,
          verifiedAt: now,
          usableFrom,
        },
        include: { methodTypeRef: true },
      });
      await notifyDirect(tx, {
        userId,
        type: 'payout_method_added',
        category: 'payments',
        title: 'Payout method added',
        body: `${destinationLabel(dto.method_type, row.accountMasked, row.accountLast3)} was added to your account. If this wasn’t you, contact support now.`,
        link: '/worker/settings#payout-methods',
        mandatory: true,
      });
      return row;
    });
    return this.dto(created);
  }

  private async owned(userId: string, id: string, tx: Tx = this.prisma.db) {
    const m = await tx.payoutMethod.findFirst({ where: { id, userId, deletedAt: null }, include: { methodTypeRef: true } });
    if (!m) throw new ApiError('PAYOUT_METHOD_INVALID');
    return m;
  }

  /** PATCH /payout-methods/{id}: make default. Not a cooldown event. */
  async makeDefault(userId: string, id: string, dto: { is_default: true; password: string }) {
    await this.passwords.verifyForSensitiveAction(userId, dto.password, 'payout_method', 'password');
    await this.prisma.db.$transaction(async (tx) => {
      await this.owned(userId, id, tx);
      const now = new Date();
      await tx.payoutMethod.updateMany({ where: { userId, deletedAt: null, isDefault: true, id: { not: id } }, data: { isDefault: false, updatedAt: now } });
      await tx.payoutMethod.update({ where: { id }, data: { isDefault: true, updatedAt: now } });
    });
    return { id, is_default: true };
  }

  /** DELETE /payout-methods/{id}. Soft delete; blocked while a withdrawal to it is in flight. */
  async remove(userId: string, id: string, dto: { password: string }) {
    await this.passwords.verifyForSensitiveAction(userId, dto.password, 'payout_method', 'password');
    return this.prisma.db.$transaction(async (tx) => {
      const m = await this.owned(userId, id, tx);
      const inFlight = await tx.withdrawal.count({ where: { payoutMethodId: id, status: { in: ['requested', 'processing'] } } });
      if (inFlight) throw new ApiError('PAYOUT_METHOD_IN_USE', 'A withdrawal to this method is still on its way. Remove it after that finishes.');
      const now = new Date();
      await tx.payoutMethod.update({ where: { id }, data: { deletedAt: now, isDefault: false, updatedAt: now } });
      let newDefault: string | null = null;
      if (m.isDefault) {
        const next = await tx.payoutMethod.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) {
          await tx.payoutMethod.update({ where: { id: next.id }, data: { isDefault: true, updatedAt: now } });
          newDefault = next.id;
        }
      }
      await notifyDirect(tx, {
        userId,
        type: 'payout_method_removed',
        category: 'payments',
        title: 'Payout method removed',
        body: `${destinationLabel(m.methodType as PayoutMethodType, m.accountMasked, m.accountLast3)} was removed from your account. If this wasn’t you, contact support now.`,
        link: '/worker/settings#payout-methods',
        mandatory: true,
      });
      return { id, deleted: true, new_default_id: newDefault };
    });
  }
}
