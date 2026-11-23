import { Body, Controller, Get, HttpCode, Injectable, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { SettingsService } from '../../settings/settings.service';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, type AdminCtx } from '../core/admin-context';
import { AdminSessionService } from '../core/admin-session.service';
import { AuditService } from '../core/audit.service';
import { adminEnv } from '../core/admin-env';
import { dec, iso, m2, needEnum, needReason, needText, optText, paged, paging, type Q } from '../core/helpers';
import { MONEY_SETTING_KEYS } from '../core/permissions';
import { GROUP_LABEL, GROUP_ORDER, SETTING_RULES, validateSetting } from './setting-rules';
import { ACCOUNT_TYPES, CHANNELS, MANUAL_CHANNELS, accountTypeOf } from '../../deposits/manual-channels';

const METHODS = ['bkash', 'nagad', 'rocket', 'usdt_trc20'] as const;
const FX_MAX_AGE = Number(process.env.FX_MAX_AGE_HOURS ?? 36);
const FX_MAX_CHANGE = Number(process.env.FX_MAX_CHANGE_PERCENT ?? 3);

/** Settings, payout configs and FX (Doc 06 §6.17; Doc 09 SCR-ADM-18, §17, §18). */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private canWrite(ctx: AdminCtx) {
    return ctx.has('settings.write');
  }

  async list(ctx: AdminCtx, q: Q) {
    const moneyOnly = !ctx.has('settings.write') && !ctx.isSuper;
    const rows = await this.db.platformSetting.findMany({ include: { updatedByAdmin: { select: { fullName: true } } }, orderBy: { key: 'asc' } });
    const data = rows
      .filter((r) => !moneyOnly || MONEY_SETTING_KEYS.has(r.key))
      .map((r) => {
        const rule = SETTING_RULES[r.key];
        const group = rule?.group ?? 'other';
        return {
          key: r.key,
          value: r.value,
          value_type: r.valueType,
          description: r.description,
          source_ref: r.sourceRef,
          is_public: r.isPublic,
          group,
          group_label: GROUP_LABEL[group],
          money: MONEY_SETTING_KEYS.has(r.key),
          super_only: !!rule?.superOnly,
          confirm_class: rule?.cls ?? 'C1',
          applies_to: rule?.applies ?? 'Immediately',
          rule: rule ? { type: rule.type, min: rule.min, max: rule.max, dp: rule.dp, enum: rule.enum, max_len: rule.maxLen, nullable: rule.nullable, list: rule.list } : { type: r.valueType },
          editable: this.canWrite(ctx) && (!rule?.superOnly || ctx.isSuper),
          updated_by: r.updatedByAdmin?.fullName ?? null,
          updated_at: iso(r.updatedAt),
        };
      })
      .filter((s) => !q.group || s.group === q.group)
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.key.localeCompare(b.key));
    return paged(data, data.length, { page: 1, perPage: Math.max(1, data.length) }, { groups: GROUP_ORDER.filter((g) => data.some((d) => d.group === g)).map((g) => ({ code: g, label: GROUP_LABEL[g] })) });
  }

  private async reauthFresh(ctx: AdminCtx) {
    const env = adminEnv();
    if (!env.totpRequired && !ctx.totpEnrolled) return;
    if (!ctx.reauthAt || ctx.reauthAt.getTime() + env.reauthWindowMinutes * 60_000 < Date.now()) throw new ApiError('ADMIN_REAUTH_REQUIRED');
  }

  async update(ctx: AdminCtx, key: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const row = await this.db.platformSetting.findUnique({ where: { key } });
    if (!row) throw new ApiError('NOT_FOUND', 'Unknown setting.');
    const rule = SETTING_RULES[key];
    if (rule?.superOnly && !ctx.isSuper) {
      // Turning an incident pause ON stays open to ops (Doc 09 §17.4).
      throw new ApiError('ADMIN_FORBIDDEN');
    }
    if ((key === 'withdrawals_paused' || key === 'deposits_paused') && b.value === false && !ctx.isSuper) throw new ApiError('ADMIN_FORBIDDEN', 'Only a super admin can lift a pause.');
    const cls = (key === 'withdrawals_paused' || key === 'deposits_paused') && b.value === false ? 'C3' : (rule?.cls ?? 'C1');
    if (cls !== 'C1') await this.reauthFresh(ctx);
    if (cls === 'C3' && b.confirm_key !== key) throw new ApiError('VALIDATION_FAILED', undefined, { confirm_key: ['Type the setting name to confirm.'] });
    // Optimistic lock at millisecond precision (the column keeps microseconds; JSON carries ms).
    if (!b.expected_updated_at || new Date(String(b.expected_updated_at)).getTime() !== row.updatedAt.getTime()) throw new ApiError('SETTING_CONFLICT');
    const all = await this.db.platformSetting.findMany({ select: { key: true, value: true } });
    const res = validateSetting(key, rule, b.value, new Map(all.map((a) => [a.key, a.value])));
    if (!res.ok) throw new ApiError('SETTING_OUT_OF_RANGE', res.message, { value: [res.message] }, res.allowed ? { allowed: res.allowed } : undefined);
    const upd = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT key FROM platform_settings WHERE key = ${key} FOR UPDATE`;
      const cur = await tx.platformSetting.findUniqueOrThrow({ where: { key } });
      if (cur.updatedAt.getTime() !== row.updatedAt.getTime()) throw new ApiError('SETTING_CONFLICT');
      await tx.platformSetting.update({ where: { key }, data: { value: (res.value ?? Prisma.JsonNull) as Prisma.InputJsonValue, updatedByAdminId: ctx.id, updatedAt: new Date() } });
      await this.audit.record(ctx, { action: 'settings.update', entityType: 'platform_setting', entityRef: key, reason, before: { value: row.value }, after: { value: res.value } }, tx);
      return tx.platformSetting.findUniqueOrThrow({ where: { key } });
    });
    this.settings.invalidate();
    await this.redis.client.publish('settings:changed', key).catch(() => undefined);
    return { key, value: upd.value, updated_at: iso(upd.updatedAt), applies_to: rule?.applies ?? 'Immediately' };
  }

  // ------------------------------------------------------------------ deposit methods

  /** Setting keys behind one manual deposit rail. */
  private depositKeys(channel: (typeof MANUAL_CHANNELS)[number]) {
    const d = CHANNELS[channel];
    return [d.enabledKey, d.accountKey, d.instructionsKey, ...(d.accountTypeKey ? [d.accountTypeKey] : [])];
  }

  /** Manual deposit rails with their switch, receiving account and why one is hidden on Add funds. */
  async depositMethods(ctx: AdminCtx) {
    const keys = [...MANUAL_CHANNELS.flatMap((c) => this.depositKeys(c)), 'deposit_methods_enabled'];
    const rows = await this.db.platformSetting.findMany({ where: { key: { in: keys } }, include: { updatedByAdmin: { select: { fullName: true } } } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const groupsRow = byKey.get('deposit_methods_enabled')?.value;
    const groups = Array.isArray(groupsRow) ? (groupsRow as unknown[]).map(String) : ['mobile_wallet', 'crypto'];
    const rate = await this.db.exchangeRate.findFirst({ where: { quoteCurrency: 'BDT', direction: 'deposit', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
    const str = (k: string | undefined, fallback = '') => {
      const v = k ? byKey.get(k)?.value : undefined;
      return typeof v === 'string' ? v : fallback;
    };
    const data = MANUAL_CHANNELS.map((channel, i) => {
      const d = CHANNELS[channel];
      const enabledRow = byKey.get(d.enabledKey)?.value;
      const enabled = typeof enabledRow === 'boolean' ? enabledRow : true;
      const account = str(d.accountKey, byKey.has(d.accountKey) ? '' : d.accountDefault).trim();
      const groupOn = groups.includes(d.group);
      const hasRate = d.currency !== 'BDT' || !!rate;
      const hidden_reason = !enabled
        ? 'Switched off.'
        : !account
          ? 'No receiving account set.'
          : !groupOn
            ? `${d.group === 'crypto' ? 'Crypto' : 'Mobile wallet'} deposits are off (Platform → Deposits).`
            : !hasRate
              ? 'No BDT deposit rate (Settings → Exchange rate).'
              : null;
      const latest = this.depositKeys(channel)
        .map((k) => byKey.get(k))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      return {
        channel,
        label: d.label,
        subtitle: d.subtitle,
        group: d.group,
        currency: d.currency === 'USD' ? 'USDT' : 'BDT',
        enabled,
        shown: !hidden_reason,
        hidden_reason,
        account,
        account_label: d.accountLabel,
        account_type: d.accountTypeKey ? accountTypeOf(str(d.accountTypeKey, 'Personal number')) : null,
        instructions: str(d.instructionsKey).trim(),
        default_instructions: d.instructions,
        sort_order: i,
        updated_by: latest?.updatedByAdmin?.fullName ?? null,
        updated_at: latest ? iso(latest.updatedAt) : null,
      };
    });
    return paged(data, data.length, { page: 1, perPage: data.length }, { editable: this.canWrite(ctx) });
  }

  async updateDepositMethod(ctx: AdminCtx, method: string, b: Record<string, unknown>) {
    const channel = needEnum(method, MANUAL_CHANNELS, 'channel');
    const d = CHANNELS[channel];
    // Reason is optional here; it still goes to the audit log when given.
    const reason = optText(b.reason, 500, 'reason');
    const rows = await this.db.platformSetting.findMany({ where: { key: { in: this.depositKeys(channel) } } });
    const cur = new Map(rows.map((r) => [r.key, r.value]));
    const fields: Record<string, string[]> = {};
    const text = (v: unknown, max: number, field: string) => {
      const t = typeof v === 'string' ? v.trim() : '';
      if (t.length > max) fields[field] = [`Keep it to ${max} characters or fewer.`];
      return t;
    };
    const next = new Map<string, { value: boolean | string; type: 'boolean' | 'string'; description: string }>();
    if (b.account !== undefined) {
      const account = text(b.account, 64, 'account');
      if (account && !d.accountPattern.test(account)) fields.account = [d.accountError];
      next.set(d.accountKey, { value: account, type: 'string', description: `${d.accountLabel} that receives manual deposits. Empty hides ${d.label}.` });
    }
    if (b.account_type !== undefined && d.accountTypeKey) {
      const type = typeof b.account_type === 'string' ? b.account_type.trim() : '';
      if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) fields.account_type = ['Choose Personal number or Merchant number.'];
      next.set(d.accountTypeKey, { value: type, type: 'string', description: `${d.label} account type (Personal number / Merchant number).` });
    }
    if (b.instructions !== undefined) {
      next.set(d.instructionsKey, { value: text(b.instructions, 500, 'instructions'), type: 'string', description: `Instructions shown on Add funds for ${d.label}. Empty uses the default text.` });
    }
    if (b.enabled !== undefined) next.set(d.enabledKey, { value: b.enabled === true, type: 'boolean', description: `Enable manual ${d.label} deposits.` });
    // An empty account is allowed: the method just stays hidden on Add funds until one is set.
    const enabled = next.has(d.enabledKey) ? next.get(d.enabledKey)!.value === true : cur.get(d.enabledKey) !== false;
    const accountNow = next.has(d.accountKey) ? String(next.get(d.accountKey)!.value) : String(cur.get(d.accountKey) ?? (cur.has(d.accountKey) ? '' : d.accountDefault)).trim();
    if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', undefined, fields);

    const changed = [...next].filter(([k, v]) => cur.get(k) !== v.value);
    if (changed.length) {
      await this.db.$transaction(async (tx) => {
        for (const [key, v] of changed) {
          await tx.platformSetting.upsert({
            where: { key },
            update: { value: v.value, updatedByAdminId: ctx.id, updatedAt: new Date() },
            create: { key, value: v.value, valueType: v.type, description: v.description, sourceRef: 'Admin', isPublic: true, updatedByAdminId: ctx.id },
          });
        }
        await this.audit.record(
          ctx,
          { action: 'deposit_method.update', entityType: 'deposit_method', entityRef: channel, reason, before: Object.fromEntries(changed.map(([k]) => [k, cur.get(k) ?? null])), after: Object.fromEntries(changed.map(([k, v]) => [k, v.value])) },
          tx,
        );
      });
      this.settings.invalidate();
      for (const [key] of changed) await this.redis.client.publish('settings:changed', key).catch(() => undefined);
    }
    return { channel, enabled, account: accountNow, changed: changed.map(([k]) => k) };
  }

  // ------------------------------------------------------------------ payout methods

  async payoutMethods() {
    const rows = await this.db.payoutMethodConfig.findMany({ orderBy: { sortOrder: 'asc' }, include: { updatedByAdmin: { select: { fullName: true } } } });
    const reqCounts = await this.db.withdrawal.groupBy({ by: ['method'], where: { status: 'requested' }, _count: { _all: true } });
    const flagOn = (m: string) => process.env[`FEATURE_PAYOUT_${m.toUpperCase()}`] !== 'false' && (m !== 'usdt_trc20' || process.env.FEATURE_PAYOUT_USDT_TRC20 !== 'false');
    return paged(
      rows.map((c) => ({
        method_type: c.methodType,
        display_name: c.displayName,
        subtitle: c.subtitle,
        account_label: c.accountLabel,
        account_regex: c.accountRegex,
        payout_currency: c.payoutCurrency.trim(),
        min_usd: m2(c.minUsd),
        max_per_request_usd: m2(c.maxPerRequestUsd),
        max_per_day_usd: m2(c.maxPerDayUsd),
        fee_fixed_usd: m2(c.feeFixedUsd),
        fee_percent: dec(c.feePercent).toString(),
        quick_amounts_usd: (Array.isArray(c.quickAmountsUsd) ? c.quickAmountsUsd : []).map((v) => new Decimal(String(v)).toFixed(2)),
        eta_text: c.etaText,
        execution: c.execution,
        treasury_system_code: c.treasurySystemCode,
        enabled: c.enabled,
        feature_flag_on: flagOn(c.methodType),
        sort_order: c.sortOrder,
        requested_count: reqCounts.find((r) => r.method === c.methodType)?._count._all ?? 0,
        updated_by: c.updatedByAdmin?.fullName ?? null,
        updated_at: iso(c.updatedAt),
      })),
      rows.length,
      { page: 1, perPage: Math.max(rows.length, 1) },
    );
  }

  async updatePayoutMethod(ctx: AdminCtx, method: string, b: Record<string, unknown>) {
    const m = needEnum(method, METHODS, 'method');
    // Reason is optional here; it still goes to the audit log when given.
    const reason = optText(b.reason, 500, 'reason');
    await this.reauthFresh(ctx);
    const c = await this.db.payoutMethodConfig.findUniqueOrThrow({ where: { methodType: m } });
    const num = (k: string, cur: Prisma.Decimal) => (b[k] === undefined ? dec(cur) : new Decimal(String(b[k])));
    const min = num('min_usd', c.minUsd);
    const maxReq = num('max_per_request_usd', c.maxPerRequestUsd);
    const maxDay = num('max_per_day_usd', c.maxPerDayUsd);
    const feeFixed = num('fee_fixed_usd', c.feeFixedUsd);
    const feePct = num('fee_percent', c.feePercent);
    const fields: Record<string, string[]> = {};
    if (min.lte(0) || min.gt(maxReq)) fields.min_usd = ['Must be above 0 and not more than the maximum per request.'];
    if (maxReq.lt(min)) fields.max_per_request_usd = ['Must be at least the minimum.'];
    if (maxDay.lt(maxReq)) fields.max_per_day_usd = ['Must be at least the maximum per request.'];
    if (feeFixed.lt(0) || feeFixed.gte(min)) fields.fee_fixed_usd = ['Must be 0 or more and below the minimum.'];
    if (feePct.lt(0) || feePct.gt(20)) fields.fee_percent = ['Use 0 to 20.'];
    let quick = Array.isArray(c.quickAmountsUsd) ? (c.quickAmountsUsd as unknown[]).map(Number) : [];
    if (b.quick_amounts_usd !== undefined) {
      quick = (Array.isArray(b.quick_amounts_usd) ? b.quick_amounts_usd : String(b.quick_amounts_usd).split(',')).map((v) => Number(String(v).replace(/[$\s]/g, '')));
      if (!quick.length || quick.length > 6 || quick.some((q, i) => !Number.isFinite(q) || q < min.toNumber() || (i > 0 && q <= quick[i - 1]!))) fields.quick_amounts_usd = ['1 to 6 ascending amounts, each at least the minimum.'];
    }
    const eta = b.eta_text === undefined ? c.etaText : needText(b.eta_text, 80, 'eta_text', 'Enter the arrival text.');
    const execution = b.execution === undefined ? c.execution : needEnum(b.execution, ['manual', 'api'] as const, 'execution');
    if (execution === 'api' && process.env[`FEATURE_PAYOUT_${m.toUpperCase()}_API`] !== 'true') fields.execution = ['API payouts need a contracted provider.'];
    const enabled = b.enabled === undefined ? c.enabled : b.enabled === true;
    if (enabled && !c.enabled && m === 'usdt_trc20') {
      if (process.env.FEATURE_PAYOUT_USDT_TRC20 === 'false') fields.enabled = ['USDT payouts are switched off by the FEATURE_PAYOUT_USDT_TRC20 flag.'];
      if (b.legal_advice_on_file !== true) fields.legal_advice_on_file = ['Confirm written legal advice is on file.'];
    }
    if (Object.keys(fields).length) throw new ApiError('SETTING_OUT_OF_RANGE', undefined, fields);
    const data = { minUsd: min.toFixed(6), maxPerRequestUsd: maxReq.toFixed(6), maxPerDayUsd: maxDay.toFixed(6), feeFixedUsd: feeFixed.toFixed(6), feePercent: feePct.toFixed(4), quickAmountsUsd: quick, etaText: eta, execution, enabled, updatedByAdminId: ctx.id, updatedAt: new Date() };
    const upd = await this.db.$transaction(async (tx) => {
      const u = await tx.payoutMethodConfig.update({ where: { methodType: m }, data });
      await this.audit.record(ctx, { action: 'payout_config.update', entityType: 'payout_method_config', entityRef: m, reason, before: { min_usd: m2(c.minUsd), max_per_request_usd: m2(c.maxPerRequestUsd), max_per_day_usd: m2(c.maxPerDayUsd), fee_fixed_usd: m2(c.feeFixedUsd), fee_percent: c.feePercent.toString(), quick_amounts_usd: c.quickAmountsUsd, eta_text: c.etaText, execution: c.execution, enabled: c.enabled }, after: { ...data, updatedByAdminId: undefined, updatedAt: undefined } }, tx);
      return u;
    });
    return { method_type: m, enabled: upd.enabled, fee_fixed_usd: m2(upd.feeFixedUsd), updated_at: iso(upd.updatedAt) };
  }

  // ------------------------------------------------------------------ FX

  async fxRates(q: Q) {
    const p = paging(q, 50);
    const where: Prisma.ExchangeRateWhereInput = {};
    if (q.quote_currency) where.quoteCurrency = q.quote_currency;
    if (q.direction) where.direction = q.direction;
    const [rows, total] = await Promise.all([
      this.db.exchangeRate.findMany({ where, orderBy: { effectiveFrom: 'desc' }, skip: p.skip, take: p.take, include: { createdByAdmin: { select: { fullName: true } } } }),
      this.db.exchangeRate.count({ where }),
    ]);
    const currents: Record<string, unknown>[] = [];
    for (const [cur, dir] of [['BDT', 'payout'], ['BDT', 'deposit'], ['USDT', 'payout']] as const) {
      const c = await this.db.exchangeRate.findFirst({ where: { quoteCurrency: cur, direction: dir, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, include: { createdByAdmin: { select: { fullName: true } } } });
      if (!c) {
        currents.push({ quote_currency: cur, direction: dir, rate: null, state: 'missing' });
        continue;
      }
      const age = (Date.now() - c.effectiveFrom.getTime()) / 3_600_000;
      currents.push({ quote_currency: cur, direction: dir, rate: dec(c.rate).toFixed(2), source: c.source, set_by: c.createdByAdmin?.fullName ?? null, effective_from: iso(c.effectiveFrom), age_hours: Math.floor(age), is_stale: cur === 'BDT' && age > FX_MAX_AGE, state: cur !== 'BDT' ? 'current' : age > FX_MAX_AGE ? 'stale' : age >= 24 ? 'old' : 'current' });
    }
    const all = await this.db.exchangeRate.findMany({ orderBy: { effectiveFrom: 'asc' }, select: { id: true, quoteCurrency: true, direction: true, rate: true } });
    const prev = new Map<string, Decimal>();
    const change = new Map<string, string | null>();
    for (const r of all) {
      const k = `${r.quoteCurrency}:${r.direction}`;
      const pr = prev.get(k);
      change.set(r.id, pr ? dec(r.rate).minus(pr).div(pr).mul(100).toFixed(2) : null);
      prev.set(k, dec(r.rate));
    }
    return paged(
      rows.map((r) => ({ id: r.id, quote_currency: r.quoteCurrency.trim(), direction: r.direction, rate: dec(r.rate).toFixed(2), source: r.source, margin_percent: dec(r.marginPercent).toString(), effective_from: iso(r.effectiveFrom), created_by: r.createdByAdmin?.fullName ?? null, note: r.note, change_percent: change.get(r.id) ?? null, age_hours: Math.floor((Date.now() - r.effectiveFrom.getTime()) / 3_600_000) })),
      total,
      p,
      { current: currents, max_age_hours: FX_MAX_AGE, max_change_percent: FX_MAX_CHANGE },
    );
  }

  async addFx(ctx: AdminCtx, b: Record<string, unknown>) {
    await this.reauthFresh(ctx);
    const cur = needEnum(b.quote_currency, ['BDT', 'USDT'] as const, 'quote_currency');
    const dir = needEnum(b.direction, ['payout', 'deposit'] as const, 'direction');
    const s = String(b.rate ?? '').trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s) || Number(s) <= 0) throw new ApiError('VALIDATION_FAILED', undefined, { rate: ['Enter a rate above 0 with up to 6 decimals.'] });
    const rate = new Decimal(s);
    const [lo, hi] = cur === 'BDT' ? [50, 500] : [0.5, 2];
    if (rate.lt(lo) || rate.gt(hi)) throw new ApiError('SETTING_OUT_OF_RANGE', `For ${cur} the rate must be between ${lo} and ${hi}.`, { rate: [`For ${cur} the rate must be between ${lo} and ${hi}.`] });
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null;
    const current = await this.db.exchangeRate.findFirst({ where: { quoteCurrency: cur, direction: dir }, orderBy: { effectiveFrom: 'desc' } });
    const pct = current ? rate.minus(dec(current.rate)).div(dec(current.rate)).mul(100) : new Decimal(0);
    if (pct.abs().gt(FX_MAX_CHANGE) && b.confirm_large_change !== true) throw new ApiError('FX_CHANGE_CONFIRM_REQUIRED', undefined, undefined, { change_percent: pct.toFixed(2) });
    const r = await this.db.$transaction(async (tx) => {
      const r = await tx.exchangeRate.create({ data: { quoteCurrency: cur, direction: dir, rate: rate.toFixed(6), source: 'manual', createdByAdminId: ctx.id, note } });
      await this.audit.record(ctx, { action: 'fx.set_rate', entityType: 'exchange_rate', entityId: r.id, entityRef: `${cur}:${dir}`, reason: note, before: { rate: current ? dec(current.rate).toFixed(6) : null }, after: { rate: rate.toFixed(6), change_percent: pct.toFixed(2) } }, tx);
      return r;
    });
    return { id: r.id, rate: rate.toFixed(2), effective_from: iso(r.effectiveFrom), change_percent: pct.toFixed(2) };
  }
}

@Controller('admin/settings')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminSettingsController {
  constructor(private readonly svc: AdminSettingsService) {}

  @Get()
  @Perms('settings.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('deposit-methods')
  @Perms('settings.read')
  depositMethods(@Admin() ctx: AdminCtx) {
    return this.svc.depositMethods(ctx);
  }

  @Patch('deposit-methods/:channel')
  @Perms('settings.write')
  updateDepositMethod(@Admin() ctx: AdminCtx, @Param('channel') c: string, @Body() b: Record<string, unknown>) {
    return this.svc.updateDepositMethod(ctx, c, b ?? {});
  }

  @Get('payout-methods')
  @Perms('payout_configs.read')
  methods() {
    return this.svc.payoutMethods();
  }

  @Patch('payout-methods/:method')
  @Perms('payout_configs.write')
  updateMethod(@Admin() ctx: AdminCtx, @Param('method') m: string, @Body() b: Record<string, unknown>) {
    return this.svc.updatePayoutMethod(ctx, m, b ?? {});
  }

  @Get('fx-rates')
  @Perms('payout_configs.read', 'fx.write')
  fx(@Query() q: Q) {
    return this.svc.fxRates(q);
  }

  @Post('fx-rates')
  @Perms('fx.write')
  addFx(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.addFx(ctx, b ?? {});
  }

  @Patch(':key')
  @HttpCode(200)
  @Perms('settings.write')
  update(@Admin() ctx: AdminCtx, @Param('key') key: string, @Body() b: Record<string, unknown>) {
    return this.svc.update(ctx, key, b ?? {});
  }
}
