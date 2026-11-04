import { Body, Controller, Get, HttpCode, Injectable, Logger, Param, Patch, Post, Put, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@24f/db';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, requirePerm, type AdminCtx } from '../core/admin-context';
import { AdminSessionService } from '../core/admin-session.service';
import { AuditService } from '../core/audit.service';
import { adminEnv } from '../core/admin-env';
import { dateRange, dec, dhakaDateStr, iso, m2, m6, needReason, needText, paged, paging, startOfDhakaDay, toCsv, type Q } from '../core/helpers';
import { MONEY_AUDIT_PREFIXES, MONEY_SETTING_KEYS, ROLE_LABEL } from '../core/permissions';
import { hashAdminPassword } from '../auth/admin-auth.service';

const ROLE_CODES = ['super_admin', 'ops_admin', 'finance_admin', 'moderator', 'support_agent', 'analyst'];
const ROLE_DESC: Record<string, string> = {
  super_admin: 'Full access, including admin accounts and all settings.',
  ops_admin: 'Users, KYC, employer verification, jobs, disputes, reports, content, broadcast, platform settings.',
  finance_admin: 'Deposits, withdrawals, ledger, reconciliation, FX, payout method configs, financial reports.',
  moderator: 'Job moderation, job reports, disputes, submission overrides, restrict accounts, referral review.',
  support_agent: 'Contact messages and read-only lookup with masked data.',
  analyst: 'Read-only dashboards, reports, audit log and aggregated data.',
};

export const FINANCIAL_REPORTS = ['general_journal', 'trial_balance', 'customer_funds', 'deposits', 'withdrawals', 'provider_settlement', 'platform_revenue', 'referral_expense', 'provider_fees', 'fx', 'refunds_chargebacks', 'adjustments', 'aged_balances', 'withdrawal_sla', 'employer_statement', 'worker_statement'];
export const OPERATIONAL_REPORTS = ['withdrawal_sla', 'kyc_sla', 'dispute_sla', 'moderation_activity', 'support_queue'];
const PII_REPORTS = new Set(['general_journal', 'deposits', 'withdrawals', 'referral_expense', 'employer_statement', 'worker_statement', 'adjustments']);

/** Admin users, audit log, dashboard and reports (Doc 06 §6.2, §6.18–6.20; Doc 09 §19–21). */
@Injectable()
export class AdminOpsService {
  private readonly log = new Logger('AdminOps');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  // ------------------------------------------------------------------ admins

  async admins(q: Q) {
    const p = paging(q, 50);
    const where: Prisma.AdminUserWhereInput = {};
    if (q.status) where.status = q.status as 'active';
    if (q.role) where.adminUserRolesByAdminUser = { some: { adminRole: { code: q.role } } };
    const orderBy: Prisma.AdminUserOrderByWithRelationInput = q.sort === '-last_login_at' ? { lastLoginAt: 'desc' } : q.sort === 'last_login_at' ? { lastLoginAt: 'asc' } : { fullName: 'asc' };
    const [rows, total] = await Promise.all([
      this.db.adminUser.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { adminUserRolesByAdminUser: { include: { adminRole: { select: { code: true } } } } } }),
      this.db.adminUser.count({ where }),
    ]);
    return paged(
      rows.map((a) => {
        const roles = a.adminUserRolesByAdminUser.map((r) => r.adminRole.code);
        return { id: a.id, full_name: a.fullName, email: a.email, status: a.status, roles, totp_enrolled: !!a.totpEnrolledAt, last_login_at: iso(a.lastLoginAt), mixed_duties: roles.includes('finance_admin') && roles.includes('ops_admin'), invited: !a.lastLoginAt && a.mustChangePassword };
      }),
      total,
      p,
    );
  }

  private parseRoles(v: unknown) {
    const roles = Array.isArray(v) ? [...new Set((v as string[]).filter((r) => ROLE_CODES.includes(r)))] : [];
    if (!roles.length) throw new ApiError('VALIDATION_FAILED', undefined, { roles: ['Choose at least one role.'] });
    return roles;
  }

  private async issueLink(adminId: string) {
    const token = randomBytes(24).toString('base64url');
    await this.redis.client.set(`admin:pwlink:${token}`, adminId, 'EX', 24 * 3600);
    const link = `${adminEnv().adminAppUrl.replace(/\/$/, '')}/setup?token=${token}`;
    this.log.log(`[email] admin set-password link for ${adminId}: ${link}`);
    return link;
  }

  async invite(ctx: AdminCtx, b: Record<string, unknown>) {
    const email = needText(b.email, 254, 'email', 'Enter a valid email.').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('VALIDATION_FAILED', undefined, { email: ['Enter a valid email.'] });
    const name = needText(b.full_name, 80, 'full_name', 'Enter the full name.');
    const roles = this.parseRoles(b.roles);
    if (await this.db.adminUser.findUnique({ where: { email } })) throw new ApiError('IDENTIFIER_TAKEN', 'This email already has an admin account.', { email: ['This email already has an admin account.'] });
    const roleRows = await this.db.adminRole.findMany({ where: { code: { in: roles } } });
    const a = await this.db.$transaction(async (tx) => {
      const a = await tx.adminUser.create({ data: { email, fullName: name, passwordHash: await hashAdminPassword(randomBytes(24).toString('base64url')), mustChangePassword: true, createdByAdminId: ctx.id } });
      await tx.adminUserRole.createMany({ data: roleRows.map((r) => ({ adminUserId: a.id, adminRoleId: r.id, grantedByAdminId: ctx.id })) });
      await this.audit.record(ctx, { action: 'admin.create', entityType: 'admin_user', entityId: a.id, after: { email, name, roles } }, tx);
      return a;
    });
    const link = await this.issueLink(a.id);
    return { id: a.id, status: a.status, invite_sent: true, dev_link: process.env.APP_ENV === 'production' ? undefined : link };
  }

  private async target(id: string) {
    const a = await this.db.adminUser.findUnique({ where: { id }, include: { adminUserRolesByAdminUser: { include: { adminRole: true } } } });
    if (!a) throw new ApiError('NOT_FOUND');
    return { a, roles: a.adminUserRolesByAdminUser.map((r) => r.adminRole.code) };
  }

  private async activeSupers(excluding?: string) {
    return this.db.adminUser.count({ where: { status: 'active', id: excluding ? { not: excluding } : undefined, adminUserRolesByAdminUser: { some: { adminRole: { code: 'super_admin' } } } } });
  }

  async rename(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const name = needText(b.full_name, 80, 'full_name', 'Enter the full name.');
    const { a } = await this.target(id);
    await this.db.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id }, data: { fullName: name } });
      await this.audit.record(ctx, { action: 'admin.update', entityType: 'admin_user', entityId: id, before: { name: a.fullName }, after: { name } }, tx);
    });
    return { id, full_name: name };
  }

  async setRoles(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const roles = this.parseRoles(b.roles);
    const reason = needReason(b.reason);
    const { roles: before, a } = await this.target(id);
    if (before.includes('super_admin') && !roles.includes('super_admin') && a.status === 'active' && (await this.activeSupers(id)) === 0) throw new ApiError('INVALID_STATE', "You can't remove the last active super admin.");
    const roleRows = await this.db.adminRole.findMany({ where: { code: { in: roles } } });
    await this.db.$transaction(async (tx) => {
      await tx.adminUserRole.deleteMany({ where: { adminUserId: id } });
      await tx.adminUserRole.createMany({ data: roleRows.map((r) => ({ adminUserId: id, adminRoleId: r.id, grantedByAdminId: ctx.id })) });
      await this.audit.record(ctx, { action: 'admin.set_roles', entityType: 'admin_user', entityId: id, reason, before: { roles: before }, after: { roles } }, tx);
    });
    return { id, roles };
  }

  async setStatus(ctx: AdminCtx, id: string, status: 'active' | 'disabled', b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const { a, roles } = await this.target(id);
    if (status === 'disabled') {
      if (id === ctx.id) throw new ApiError('INVALID_STATE', "You can't disable yourself or the last super admin.");
      if (roles.includes('super_admin') && (await this.activeSupers(id)) === 0) throw new ApiError('INVALID_STATE', "You can't disable yourself or the last super admin.");
    }
    if (a.status === status) throw new ApiError('INVALID_STATE');
    await this.db.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id }, data: { status } });
      await this.audit.record(ctx, { action: status === 'disabled' ? 'admin.disable' : 'admin.enable', entityType: 'admin_user', entityId: id, reason, before: { status: a.status }, after: { status } }, tx);
    });
    if (status === 'disabled') await this.sessions.revokeAllFor(id, 'disabled');
    return { id, status };
  }

  async resetTotp(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    await this.target(id);
    await this.db.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id }, data: { totpSecretEnc: null, totpEnrolledAt: null } });
      await this.audit.record(ctx, { action: 'admin.reset_totp', entityType: 'admin_user', entityId: id, reason, after: { totp_enrolled_at: null } }, tx);
    });
    const n = await this.sessions.revokeAllFor(id, 'totp_reset');
    return { id, totp_enrolled: false, sessions_revoked: n };
  }

  async resetPassword(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    if (id === ctx.id) throw new ApiError('SELF_APPROVAL_FORBIDDEN', "You can't send a reset to your own account.");
    await this.target(id);
    const n = await this.sessions.revokeAllFor(id, 'password_reset');
    const link = await this.issueLink(id);
    await this.audit.record(ctx, { action: 'admin.reset_password', entityType: 'admin_user', entityId: id, reason });
    return { id, reset_link_sent: true, sessions_revoked: n, dev_link: process.env.APP_ENV === 'production' ? undefined : link };
  }

  async roles() {
    const rows = await this.db.adminRole.findMany({ include: { _count: { select: { adminUserRoles: true } } } });
    rows.sort((x, y) => ROLE_CODES.indexOf(x.code) - ROLE_CODES.indexOf(y.code));
    const supers = await this.activeSupers();
    return paged(rows.map((r) => ({ code: r.code, name: r.name || ROLE_LABEL[r.code], description: r.description || ROLE_DESC[r.code], permissions: r.permissions, holders: r._count.adminUserRoles })), rows.length, { page: 1, perPage: Math.max(1, rows.length) }, { active_super_admins: supers });
  }

  // ------------------------------------------------------------------ audit log

  private auditWhere(ctx: AdminCtx, q: Q): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    const { from, to } = dateRange(q, 7);
    and.push({ createdAt: { gte: from, ...(to ? { lt: to } : {}) } });
    if (q.actor) and.push(q.actor === 'system' ? { actorType: 'system' } : { actorAdminId: q.actor });
    if (q.action) and.push(q.action.endsWith('*') ? { action: { startsWith: q.action.slice(0, -1) } } : { action: q.action });
    if (q.entity_type) and.push({ entityType: q.entity_type });
    if (q.entity_ref) and.push({ entityRef: q.entity_ref });
    const financeOnly = !ctx.isSuper && ctx.roles.includes('finance_admin') && !ctx.roles.some((r) => ['ops_admin', 'analyst'].includes(r));
    if (financeOnly) {
      and.push({ OR: [...MONEY_AUDIT_PREFIXES.map((p) => ({ action: { startsWith: p } })), { action: 'settings.update', entityRef: { in: [...MONEY_SETTING_KEYS].map((k) => k.slice(0, 20)) } }, { action: 'report.export' }] });
    }
    return { AND: and };
  }

  async auditLog(ctx: AdminCtx, q: Q) {
    const p = paging(q, 50);
    const where = this.auditWhere(ctx, q);
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actorAdmin: { select: { fullName: true } }, actorUser: { select: { publicId: true } } } }),
      this.db.auditLog.count({ where }),
    ]);
    const actors = await this.db.adminUser.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    return paged(
      rows.map((r) => ({ id: r.id, actor_type: r.actorType, actor_name: r.actorAdmin?.fullName ?? (r.actorType === 'user' ? (r.actorUser?.publicId ?? 'User') : 'System'), action: r.action, entity_type: r.entityType, entity_id: r.entityId, entity_ref: r.entityRef, reason: r.reason, before_data: r.beforeData, after_data: r.afterData, ip_address: r.ipAddress, user_agent: r.userAgent, request_id: r.requestId, created_at: iso(r.createdAt) })),
      total,
      p,
      { actors: actors.map((a) => ({ id: a.id, name: a.fullName })) },
    );
  }

  async auditExport(ctx: AdminCtx, q: Q, res: Response) {
    const { from, to } = dateRange(q, 7);
    if (from && (to ?? new Date()).getTime() - from.getTime() > 366 * 86_400_000) throw new ApiError('EXPORT_TOO_LARGE');
    const where = this.auditWhere(ctx, q);
    const count = await this.db.auditLog.count({ where });
    if (count > 50_000) throw new ApiError('EXPORT_TOO_LARGE');
    if (q.count_only === '1') {
      ctx.audited = true;
      return res.json({ data: { rows: count } });
    }
    const env = adminEnv();
    if ((env.totpRequired || ctx.totpEnrolled) && (!ctx.reauthAt || ctx.reauthAt.getTime() + env.reauthWindowMinutes * 60_000 < Date.now())) throw new ApiError('ADMIN_REAUTH_REQUIRED');
    const rows = await this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, include: { actorAdmin: { select: { fullName: true } } } });
    const csv = toCsv(['created_at', 'actor_type', 'actor_name', 'action', 'entity_type', 'entity_ref', 'reason', 'ip_address', 'request_id'], rows.map((r) => [iso(r.createdAt), r.actorType, r.actorAdmin?.fullName ?? r.actorType, r.action, r.entityType, r.entityRef, r.reason, r.ipAddress, r.requestId]));
    await this.audit.record(ctx, { action: 'audit.export', entityType: 'audit_log', after: { filters: q, rows: rows.length, sha256: createHash('sha256').update(csv).digest('hex') } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${dhakaDateStr(new Date())}.csv"`);
    res.send(csv);
  }

  // ------------------------------------------------------------------ dashboard

  async dashboard(ctx: AdminCtx) {
    const now = new Date();
    const today = startOfDhakaDay(now);
    const financeOnly = !ctx.isSuper && ctx.roles.includes('finance_admin') && !ctx.roles.some((r) => ['ops_admin', 'moderator', 'support_agent'].includes(r));
    const c = this.db;
    const [kycPending, kycOverdue, emp, wdReq, wdProc, dOpen, dOver, rOpen, flagged, escalated, supportNew, adjPending] = await Promise.all([
      c.kycVerification.count({ where: { status: 'pending' } }),
      c.kycVerification.count({ where: { status: 'pending', reviewDueAt: { lt: now } } }),
      c.employerProfile.count({ where: { verificationStatus: 'pending' } }),
      c.withdrawal.count({ where: { status: 'requested' } }),
      c.withdrawal.count({ where: { status: 'processing' } }),
      c.dispute.count({ where: { status: { in: ['open', 'under_review'] } } }),
      c.dispute.count({ where: { status: { in: ['open', 'under_review'] }, slaDueAt: { lt: now } } }),
      c.jobReport.count({ where: { status: 'open' } }),
      c.job.count({ where: { moderationFlaggedAt: { not: null }, status: 'running' } }),
      c.submission.count({ where: { status: 'in_review', escalatedAt: { not: null } } }),
      c.contactMessage.count({ where: { status: 'new', ...(financeOnly ? { topic: 'payments_withdrawals' } : {}) } }),
      c.ledgerAdjustmentRequest.count({ where: { status: 'pending_approval', expiresAt: { gt: now } } }),
    ]);
    const queues = { kyc_pending: kycPending, kyc_overdue: kycOverdue, employer_verification: emp, withdrawals_requested: wdReq, withdrawals_processing: wdProc, disputes_open: dOpen, disputes_overdue: dOver, reports_open: rOpen, flagged_jobs: flagged, escalated_submissions: escalated, support_new: supportNew, adjustments_pending: adjPending, deposits_pending_approval: await c.adminPendingAction.count({ where: { objectType: 'deposit', status: 'pending' } }) };
    const [dep, pay, appr, newUsers] = await Promise.all([
      c.deposit.aggregate({ where: { completedAt: { gte: today } }, _sum: { creditedAmountUsd: true } }),
      c.withdrawal.aggregate({ where: { paidAt: { gte: today }, status: 'paid' }, _sum: { amountUsd: true } }),
      c.submission.count({ where: { status: 'approved', finalAt: { gte: today } } }),
      c.user.count({ where: { createdAt: { gte: today } } }),
    ]);
    const money = ctx.has('dashboard.money_read');
    const todayBlock: Record<string, unknown> = { approvals: appr, new_users: newUsers };
    if (money) Object.assign(todayBlock, { deposits_usd: m2(dep._sum.creditedAmountUsd), payouts_usd: m2(pay._sum.amountUsd) });

    const week = new Date(now.getTime() - 7 * 86_400_000);
    const [kycDec, disRes, paid7, running, inReview, fx] = await Promise.all([
      c.kycVerification.findMany({ where: { reviewedAt: { gte: week } }, select: { reviewedAt: true, reviewDueAt: true } }),
      c.dispute.findMany({ where: { resolvedAt: { gte: week } }, select: { resolvedAt: true, slaDueAt: true } }),
      c.withdrawal.findMany({ where: { paidAt: { gte: week } }, select: { paidAt: true, requestedAt: true } }),
      c.job.count({ where: { status: 'running' } }),
      c.submission.count({ where: { status: 'in_review' } }),
      c.exchangeRate.findFirst({ where: { quoteCurrency: 'BDT', direction: 'payout' }, orderBy: { effectiveFrom: 'desc' } }),
    ]);
    const pct = (ok: number, all: number) => (all ? Math.round((ok / all) * 100) : null);
    const hrs = paid7.map((w) => (w.paidAt!.getTime() - w.requestedAt.getTime()) / 3_600_000).sort((a, b) => a - b);
    const median = hrs.length ? (hrs.length % 2 ? hrs[(hrs.length - 1) / 2]! : (hrs[hrs.length / 2 - 1]! + hrs[hrs.length / 2]!) / 2) : null;
    const fxAge = fx ? Math.floor((now.getTime() - fx.effectiveFrom.getTime()) / 3_600_000) : null;
    const service = {
      kyc_within_sla_7d_pct: pct(kycDec.filter((k) => k.reviewedAt! <= k.reviewDueAt).length, kycDec.length),
      disputes_within_sla_7d_pct: pct(disRes.filter((d) => d.resolvedAt! <= d.slaDueAt).length, disRes.length),
      withdrawal_median_hours_7d: median === null ? null : Math.round(median * 10) / 10,
      jobs_running: running,
      in_review_total: inReview,
      fx_age_hours: ctx.hasAny('fx.write', 'payout_configs.read') ? fxAge : undefined,
    };

    // 14-day trend (Dhaka days): approvals, plus money when allowed.
    const start = startOfDhakaDay(now, 13);
    const days = [...Array(14)].map((_, i) => dhakaDateStr(new Date(start.getTime() + i * 86_400_000 + 3600_000)));
    const approvals = await c.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char(final_at AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS day, count(*) AS n FROM submissions WHERE status='approved' AND final_at >= ${start} GROUP BY 1`;
    const signups = await c.$queryRaw<{ day: string; n: bigint }[]>`SELECT to_char(created_at AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS day, count(*) AS n FROM users WHERE created_at >= ${start} GROUP BY 1`;
    const deps = money ? await c.$queryRaw<{ day: string; n: Prisma.Decimal }[]>`SELECT to_char(completed_at AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS day, COALESCE(sum(credited_amount_usd),0) AS n FROM deposits WHERE completed_at >= ${start} GROUP BY 1` : [];
    const pays = money ? await c.$queryRaw<{ day: string; n: Prisma.Decimal }[]>`SELECT to_char(paid_at AT TIME ZONE 'Asia/Dhaka','YYYY-MM-DD') AS day, COALESCE(sum(amount_usd),0) AS n FROM withdrawals WHERE status='paid' AND paid_at >= ${start} GROUP BY 1` : [];
    const series = (rows: { day: string; n: bigint | Prisma.Decimal }[]) => days.map((d) => Number(rows.find((r) => r.day === d)?.n ?? 0));
    const trend = { days, approvals: series(approvals), new_users: series(signups), ...(money ? { deposits_usd: series(deps), payouts_usd: series(pays) } : {}) };

    const alerts: { severity: string; code: string; message: string; link: string }[] = [];
    const finance = ctx.isSuper || ctx.roles.includes('finance_admin');
    const ops = ctx.isSuper || ctx.roles.includes('ops_admin');
    if (finance && fxAge !== null && fxAge >= 36) alerts.push({ severity: 'critical', code: 'fx_stale', message: 'The BDT rate is out of date, so BDT withdrawals are blocked. Add a rate.', link: '/settings?tab=fx' });
    else if (finance && fxAge !== null && fxAge >= 24) alerts.push({ severity: 'high', code: 'fx_stale_soon', message: `The BDT rate is ${fxAge} hours old. BDT withdrawals stop at 36 hours.`, link: '/settings?tab=fx' });
    if (finance) {
      const crit = await c.reconciliationItem.count({ where: { resolvedAt: null, severity: 'critical' } });
      if (crit) alerts.push({ severity: 'critical', code: 'recon_critical', message: "A critical reconciliation check failed. Payouts should stop until it's reviewed.", link: '/ledger?tab=reconciliation' });
      const stuckReq = await c.withdrawal.count({ where: { status: 'requested', requestedAt: { lt: new Date(now.getTime() - 24 * 3600_000) }, OR: [{ holdUntil: null }, { holdUntil: { lt: now } }] } });
      if (stuckReq) alerts.push({ severity: 'high', code: 'withdrawals_stuck_requested', message: `${stuckReq} withdrawal${stuckReq > 1 ? 's have' : ' has'} waited over 24 hours.`, link: '/withdrawals' });
      const stuckProc = await c.withdrawal.count({ where: { status: 'processing', processingAt: { lt: new Date(now.getTime() - 48 * 3600_000) } } });
      if (stuckProc) alerts.push({ severity: 'high', code: 'withdrawals_stuck_processing', message: `${stuckProc} withdrawal${stuckProc > 1 ? 's have' : ' has'} been processing over 48 hours.`, link: '/withdrawals?status=processing' });
      const mism = await c.deposit.count({ where: { needsReview: true } });
      if (mism) alerts.push({ severity: 'high', code: 'deposit_mismatch', message: `${mism} deposit${mism > 1 ? 's need' : ' needs'} review.`, link: '/deposits?needs_review=true' });
    }
    if (ops && kycOverdue) alerts.push({ severity: 'medium', code: 'kyc_overdue', message: `${kycOverdue} identity check${kycOverdue > 1 ? 's are' : ' is'} past the 24-hour target.`, link: '/kyc?overdue=true' });
    if ((ops || ctx.roles.includes('moderator')) && dOver) alerts.push({ severity: 'high', code: 'disputes_overdue', message: `${dOver} dispute${dOver > 1 ? 's are' : ' is'} past the 48-hour target.`, link: '/disputes?overdue=true' });
    const switches = await c.platformSetting.findMany({ where: { key: { in: ['withdrawals_paused', 'deposits_paused', 'banner_text'] } } });
    const sv = (k: string) => switches.find((s) => s.key === k)?.value;
    if (sv('withdrawals_paused') === true) alerts.push({ severity: 'critical', code: 'paused_withdrawals', message: 'Withdrawals are paused for all users.', link: '/settings' });
    if (sv('deposits_paused') === true) alerts.push({ severity: 'critical', code: 'paused_deposits', message: 'Deposits are paused for all users.', link: '/settings' });
    if (ops && typeof sv('banner_text') === 'string' && sv('banner_text')) alerts.push({ severity: 'info', code: 'banner_live', message: `Site banner is live: ${sv('banner_text')}`, link: '/settings' });

    return { queues, today: todayBlock, service, trend, alerts };
  }

  // ------------------------------------------------------------------ reports

  async financialSummary(q: Q) {
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : dhakaDateStr(new Date());
    const from = new Date(`${date}T00:00:00+06:00`);
    const to = new Date(from.getTime() + 86_400_000);
    const [dep, pay, kinds, neg, inflight, recon] = await Promise.all([
      this.db.deposit.aggregate({ where: { completedAt: { gte: from, lt: to } }, _sum: { creditedAmountUsd: true } }),
      this.db.withdrawal.aggregate({ where: { paidAt: { gte: from, lt: to }, status: 'paid' }, _sum: { amountUsd: true } }),
      this.db.walletAccount.groupBy({ by: ['kind'], where: { ownerUserId: { not: null } }, _sum: { balanceCached: true } }),
      this.db.walletAccount.aggregate({ where: { ownerUserId: { not: null }, balanceCached: { lt: 0 } }, _sum: { balanceCached: true } }),
      this.db.withdrawal.aggregate({ where: { status: { in: ['requested', 'processing'] } }, _sum: { amountUsd: true } }),
      this.db.reconciliationItem.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: { _all: true } }),
    ]);
    const k = (n: string) => m2(kinds.find((x) => x.kind === n)?._sum.balanceCached);
    const rc = (s: string) => recon.find((x) => x.severity === s)?._count._all ?? 0;
    return { date, summary: { deposits_usd: m2(dep._sum.creditedAmountUsd), payouts_usd: m2(pay._sum.amountUsd), customer_funds: { worker_earnings_usd: k('worker_earnings'), employer_available_usd: k('employer_available'), employer_reserved_usd: k('employer_reserved'), in_flight_usd: m2(inflight._sum.amountUsd), negative_balances_usd: dec(neg._sum.balanceCached).abs().toFixed(2) }, open_reconciliation_items: { critical: rc('critical'), high: rc('high'), medium: rc('medium') } }, reports: FINANCIAL_REPORTS };
  }

  /** Builds one report (Doc 09 §12). Values at 6 dp; withdrawals keep accounts masked. */
  private async build(code: string, from: Date, to: Date, tz: string, user?: string): Promise<{ header: string[]; rows: (string | number | null)[][] }> {
    const db = this.db;
    const fmt = (d: Date | null) => (d ? (tz === 'UTC' ? d.toISOString() : new Date(d.getTime() + 6 * 3600_000).toISOString().replace('Z', '+06:00')) : null);
    const dayExpr = tz === 'UTC' ? 'UTC' : 'Asia/Dhaka';
    switch (code) {
      case 'general_journal': {
        const tx = await db.ledgerTransaction.findMany({ where: { occurredAt: { gte: from, lt: to } }, orderBy: { seq: 'asc' }, take: 50_001, include: { ledgerEntries: { include: { account: { select: { kind: true, systemCode: true, ownerUser: { select: { publicId: true } } } } } } } });
        return { header: ['ref', 'occurred_at', 'type', 'account_kind', 'account', 'amount_exact'], rows: tx.flatMap((t) => t.ledgerEntries.map((e) => [t.publicRef, fmt(t.occurredAt), t.type, e.account.kind, e.account.systemCode ?? e.account.ownerUser?.publicId ?? null, m6(e.amount)])) };
      }
      case 'trial_balance': {
        const rows = await db.$queryRaw<{ kind: string; opening: Prisma.Decimal; debits: Prisma.Decimal; credits: Prisma.Decimal }[]>`
          SELECT a.kind::text AS kind,
            COALESCE(sum(e.amount) FILTER (WHERE e.created_at < ${from}),0) AS opening,
            COALESCE(sum(-e.amount) FILTER (WHERE e.created_at >= ${from} AND e.created_at < ${to} AND e.amount < 0),0) AS debits,
            COALESCE(sum(e.amount) FILTER (WHERE e.created_at >= ${from} AND e.created_at < ${to} AND e.amount > 0),0) AS credits
          FROM wallet_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY 1 ORDER BY 1`;
        return { header: ['account_kind', 'opening_exact', 'debits_exact', 'credits_exact', 'closing_exact'], rows: rows.map((r) => [r.kind, m6(r.opening), m6(r.debits), m6(r.credits), m6(dec(r.opening).minus(dec(r.debits)).plus(dec(r.credits)))]) };
      }
      case 'customer_funds': {
        const s = await this.financialSummary({ date: dhakaDateStr(new Date(to.getTime() - 1)) });
        const f = s.summary.customer_funds;
        return { header: ['metric', 'amount_usd'], rows: Object.entries(f).map(([k, v]) => [k, v]) };
      }
      case 'deposits': {
        const rows = await db.deposit.findMany({ where: { initiatedAt: { gte: from, lt: to } }, orderBy: { initiatedAt: 'asc' }, include: { employerUser: { select: { publicId: true } }, creditLedgerTx: { select: { publicRef: true } } } });
        return { header: ['ref', 'tx_ref', 'employer_id', 'method', 'provider', 'amount_usd', 'charge_bdt', 'fx_rate', 'status', 'provider_id', 'fee', 'completed_at', 'refunded_usd'], rows: rows.map((d) => [d.publicRef, d.creditLedgerTx?.publicRef ?? null, d.employerUser.publicId, d.method, d.provider, m6(d.amountUsd), d.chargeAmountBdt?.toString() ?? null, d.fxRate?.toString() ?? null, d.status, d.providerPaymentId, d.providerFee ? m6(d.providerFee) : null, fmt(d.completedAt), m6(d.refundedAmountUsd)]) };
      }
      case 'withdrawals': {
        const rows = await db.withdrawal.findMany({ where: { requestedAt: { gte: from, lt: to } }, orderBy: { requestedAt: 'asc' }, include: { user: { select: { publicId: true } }, requestLedgerTx: { select: { publicRef: true } }, processedByAdmin: { select: { fullName: true } } } });
        return { header: ['ref', 'tx_ref', 'worker_id', 'method', 'account_masked', 'amount_usd', 'fee_usd', 'fx_rate', 'payout_amount', 'payout_currency', 'trx_id', 'batch_id', 'status', 'requested_at', 'paid_at', 'finance_user'], rows: rows.map((w) => [w.publicRef, w.requestLedgerTx.publicRef, w.user.publicId, w.method, w.destinationMasked, m6(w.amountUsd), m6(w.feeUsd), w.fxRate.toString(), w.payoutAmount.toString(), w.payoutCurrency.trim(), w.providerTrxId, w.batchId, w.status, fmt(w.requestedAt), fmt(w.paidAt), w.processedByAdmin?.fullName ?? null]) };
      }
      case 'provider_settlement': {
        const rows = await db.providerSettlementLine.findMany({ where: { createdAt: { gte: from, lt: to } } });
        return { header: ['settlement_id', 'provider', 'provider_payment_id', 'gross', 'fee', 'net', 'currency', 'settled_on', 'match_status'], rows: rows.map((r) => [r.settlementId, r.provider, r.providerPaymentId, m6(r.grossAmount), m6(r.feeAmount), m6(r.netAmount), r.currency, r.settledOn.toISOString().slice(0, 10), r.matchStatus]) };
      }
      case 'platform_revenue':
      case 'referral_expense':
      case 'provider_fees': {
        const kind = code === 'platform_revenue' ? 'platform_revenue' : code === 'referral_expense' ? 'referral_expense' : 'gateway_fees';
        const rows = await db.$queryRawUnsafe<{ day: string; type: string; total: Prisma.Decimal; n: bigint }[]>(
          `SELECT to_char(e.created_at AT TIME ZONE '${dayExpr}','YYYY-MM-DD') AS day, t.type::text AS type, sum(e.amount) AS total, count(*) AS n FROM ledger_entries e JOIN wallet_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE a.kind='${kind}' AND e.created_at >= $1 AND e.created_at < $2 GROUP BY 1,2 ORDER BY 1`,
          from,
          to,
        );
        return { header: ['day', 'type', 'entries', 'total_exact'], rows: rows.map((r) => [r.day, r.type, Number(r.n), m6(r.total)]) };
      }
      case 'fx': {
        const rows = await db.exchangeRate.findMany({ where: { effectiveFrom: { lt: to } }, orderBy: { effectiveFrom: 'asc' } });
        return { header: ['effective_from', 'currency', 'direction', 'rate', 'source'], rows: rows.map((r) => [fmt(r.effectiveFrom), r.quoteCurrency.trim(), r.direction, r.rate.toString(), r.source]) };
      }
      case 'refunds_chargebacks': {
        const rows = await db.ledgerTransaction.findMany({ where: { type: 'deposit_refund', occurredAt: { gte: from, lt: to } }, include: { deposit: { select: { publicRef: true, provider: true } }, ledgerEntries: { where: { amount: { lt: 0 } } } } });
        return { header: ['ref', 'deposit', 'provider', 'reason', 'amount_exact', 'occurred_at'], rows: rows.map((t) => [t.publicRef, t.deposit?.publicRef ?? null, t.deposit?.provider ?? null, String((t.descriptionParams as Record<string, unknown>)?.reason ?? 'refund'), m6(t.ledgerEntries.reduce((a, e) => a.plus(dec(e.amount).abs()), new Decimal(0))), fmt(t.occurredAt)]) };
      }
      case 'adjustments': {
        const rows = await db.ledgerAdjustmentRequest.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { createdByAdmin: { select: { fullName: true } }, decidedByAdmin: { select: { fullName: true } }, account: { select: { kind: true, ownerUser: { select: { publicId: true } } } } } });
        return { header: ['id', 'owner', 'account', 'amount_exact', 'reason_code', 'status', 'maker', 'approver', 'created_at'], rows: rows.map((a) => [a.id, a.account.ownerUser?.publicId ?? null, a.account.kind, m6(a.amount), a.reasonCode, a.status, a.createdByAdmin.fullName, a.decidedByAdmin?.fullName ?? null, fmt(a.createdAt)]) };
      }
      case 'aged_balances': {
        const rows = await db.walletAccount.findMany({ where: { ownerUserId: { not: null }, balanceCached: { gt: 0 } }, select: { kind: true, balanceCached: true, lastEntryAt: true } });
        const b = (d: number) => (d <= 30 ? '0-30' : d <= 90 ? '31-90' : d <= 180 ? '91-180' : '180+');
        const map = new Map<string, Decimal>();
        for (const r of rows) {
          const days = r.lastEntryAt ? (Date.now() - r.lastEntryAt.getTime()) / 86_400_000 : 9999;
          const k = `${r.kind}|${b(days)}`;
          map.set(k, (map.get(k) ?? new Decimal(0)).plus(dec(r.balanceCached)));
        }
        return { header: ['account_kind', 'age_bucket_days', 'total_exact'], rows: [...map].map(([k, v]) => [...k.split('|'), m6(v)]) };
      }
      case 'withdrawal_sla': {
        const rows = await db.withdrawal.findMany({ where: { requestedAt: { gte: from, lt: to } }, select: { method: true, status: true, requestedAt: true, paidAt: true } });
        const by = new Map<string, { paid: number[]; total: number; rejected: number; failed: number }>();
        for (const w of rows) {
          const g = by.get(w.method) ?? { paid: [], total: 0, rejected: 0, failed: 0 };
          g.total++;
          if (w.paidAt) g.paid.push((w.paidAt.getTime() - w.requestedAt.getTime()) / 3_600_000);
          if (w.status === 'rejected') g.rejected++;
          if (w.status === 'failed') g.failed++;
          by.set(w.method, g);
        }
        const q = (a: number[], p: number) => (a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(1) : null);
        return { header: ['method', 'requests', 'paid', 'median_hours_to_paid', 'p95_hours_to_paid', 'rejected_pct', 'failed_pct'], rows: [...by].map(([m, g]) => [m, g.total, g.paid.length, q(g.paid, 0.5), q(g.paid, 0.95), ((g.rejected / g.total) * 100).toFixed(1), ((g.failed / g.total) * 100).toFixed(1)]) };
      }
      case 'kyc_sla': {
        const rows = await db.$queryRawUnsafe<{ day: string; submitted: bigint; decided: bigint; within: bigint; approved: bigint; rejected: bigint; median_h: number | null }[]>(
          `SELECT to_char(submitted_at AT TIME ZONE '${dayExpr}','YYYY-MM-DD') AS day, count(*) AS submitted, count(reviewed_at) AS decided, count(*) FILTER (WHERE reviewed_at <= review_due_at) AS within, count(*) FILTER (WHERE status='verified') AS approved, count(*) FILTER (WHERE status='rejected') AS rejected, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM reviewed_at - submitted_at)/3600) AS median_h FROM kyc_verifications WHERE submitted_at >= $1 AND submitted_at < $2 GROUP BY 1 ORDER BY 1`,
          from,
          to,
        );
        return { header: ['day', 'submitted', 'decided', 'median_hours', 'pct_within_24h', 'approved', 'rejected'], rows: rows.map((r) => [r.day, Number(r.submitted), Number(r.decided), r.median_h === null ? null : Number(r.median_h).toFixed(1), Number(r.decided) ? ((Number(r.within) / Number(r.decided)) * 100).toFixed(0) : null, Number(r.approved), Number(r.rejected)]) };
      }
      case 'dispute_sla': {
        const rows = await db.$queryRawUnsafe<{ day: string; opened: bigint; resolved: bigint; within: bigint; worker: bigint; employer: bigint; withdrawn: bigint }[]>(
          `SELECT to_char(opened_at AT TIME ZONE '${dayExpr}','YYYY-MM-DD') AS day, count(*) AS opened, count(resolved_at) AS resolved, count(*) FILTER (WHERE resolved_at <= sla_due_at) AS within, count(*) FILTER (WHERE status='resolved_worker') AS worker, count(*) FILTER (WHERE status='resolved_employer') AS employer, count(*) FILTER (WHERE status='withdrawn') AS withdrawn FROM disputes WHERE opened_at >= $1 AND opened_at < $2 GROUP BY 1 ORDER BY 1`,
          from,
          to,
        );
        return { header: ['day', 'opened', 'resolved', 'pct_within_48h', 'for_worker', 'for_employer', 'withdrawn'], rows: rows.map((r) => [r.day, Number(r.opened), Number(r.resolved), Number(r.resolved) ? ((Number(r.within) / Number(r.resolved)) * 100).toFixed(0) : null, Number(r.worker), Number(r.employer), Number(r.withdrawn)]) };
      }
      case 'moderation_activity': {
        const rows = await db.$queryRawUnsafe<{ day: string; action: string; n: bigint }[]>(
          `SELECT to_char(created_at AT TIME ZONE '${dayExpr}','YYYY-MM-DD') AS day, action, count(*) AS n FROM audit_logs WHERE action IN ('job.suspend','job.reinstate','job.admin_close','job.moderation_clear','job_report.dismiss','job_report.action') AND created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY 1`,
          from,
          to,
        );
        return { header: ['day', 'action', 'count'], rows: rows.map((r) => [r.day, r.action, Number(r.n)]) };
      }
      case 'support_queue': {
        const rows = await db.$queryRawUnsafe<{ day: string; topic: string; n: bigint; answered: bigint; spam: bigint }[]>(
          `SELECT to_char(created_at AT TIME ZONE '${dayExpr}','YYYY-MM-DD') AS day, topic::text AS topic, count(*) AS n, count(answered_at) AS answered, count(*) FILTER (WHERE status='spam') AS spam FROM contact_messages WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY 1`,
          from,
          to,
        );
        return { header: ['day', 'topic', 'new', 'answered', 'spam'], rows: rows.map((r) => [r.day, r.topic, Number(r.n), Number(r.answered), Number(r.spam)]) };
      }
      case 'employer_statement':
      case 'worker_statement': {
        if (!user) throw new ApiError('VALIDATION_FAILED', undefined, { user: ['Enter a user ID.'] });
        const u = await db.user.findUnique({ where: { publicId: user } });
        if (!u) throw new ApiError('VALIDATION_FAILED', undefined, { user: ["We can't find that user."] });
        const kinds = code === 'worker_statement' ? ['worker_earnings'] : ['employer_available', 'employer_reserved'];
        const rows = await db.ledgerEntry.findMany({ where: { account: { ownerUserId: u.id, kind: { in: kinds as ('worker_earnings' | 'employer_available' | 'employer_reserved')[] } }, createdAt: { gte: from, lt: to } }, orderBy: { txSeq: 'asc' }, include: { transaction: { select: { publicRef: true, type: true } }, account: { select: { kind: true } } } });
        return { header: ['ref', 'occurred_at', 'type', 'display_type', 'account', 'amount_exact', 'balance_after_exact'], rows: rows.map((e) => [e.transaction.publicRef, fmt(e.createdAt), e.transaction.type, e.displayType, e.account.kind, m6(e.amount), e.balanceAfter ? m6(e.balanceAfter) : null]) };
      }
      default:
        throw new ApiError('NOT_FOUND', 'Unknown report.');
    }
  }

  async report(ctx: AdminCtx, code: string, q: Q, res: Response) {
    const financial = FINANCIAL_REPORTS.includes(code);
    const operational = OPERATIONAL_REPORTS.includes(code);
    if (!financial && !operational) throw new ApiError('NOT_FOUND', 'Unknown report.');
    const canFin = ctx.has('reports.financial');
    if (!canFin && !(operational && ctx.has('reports.operational'))) throw new ApiError('ADMIN_FORBIDDEN');
    const format = q.format === 'csv' ? 'csv' : 'json';
    if (format === 'csv' && !canFin && ctx.roles.includes('moderator') && !ctx.roles.some((r) => ['ops_admin', 'finance_admin', 'analyst', 'super_admin'].includes(r))) throw new ApiError('ADMIN_FORBIDDEN');
    const { from: f, to: t } = dateRange(q, 30);
    const from = f ?? new Date(Date.now() - 30 * 86_400_000);
    const to = t ?? new Date();
    if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new ApiError('EXPORT_TOO_LARGE');
    const tz = q.timezone === 'UTC' ? 'UTC' : 'Asia/Dhaka';
    const built = await this.build(code, from, to, tz, q.user);
    if (built.rows.length > 50_000) throw new ApiError('EXPORT_TOO_LARGE');
    if (format === 'csv') {
      const env = adminEnv();
      if (PII_REPORTS.has(code) && (env.totpRequired || ctx.totpEnrolled) && (!ctx.reauthAt || ctx.reauthAt.getTime() + env.reauthWindowMinutes * 60_000 < Date.now())) throw new ApiError('ADMIN_REAUTH_REQUIRED');
      const body = `# report=${code} from=${dhakaDateStr(from)} to=${dhakaDateStr(new Date(to.getTime() - 1))} timezone=${tz}\r\n` + toCsv(built.header, built.rows).replace(/^﻿/, '');
      const csv = '﻿' + body;
      await this.audit.record(ctx, { action: 'report.export', entityType: 'report', entityRef: code, after: { report: code, from, to, format: 'csv', rows: built.rows.length, sha256: createHash('sha256').update(csv).digest('hex') } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${code}-${dhakaDateStr(from)}-${dhakaDateStr(to)}.csv"`);
      res.send(csv);
      return;
    }
    const p = paging(q, 50);
    res.json({ data: { report: code, from: dhakaDateStr(from), to: dhakaDateStr(new Date(to.getTime() - 1)), timezone: tz, header: built.header, rows: built.rows.slice(p.skip, p.skip + p.take) }, meta: { total: built.rows.length, page: p.page, per_page: p.perPage, total_pages: Math.max(1, Math.ceil(built.rows.length / p.perPage)) }, serverTime: new Date().toISOString() });
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminOpsController {
  constructor(private readonly svc: AdminOpsService) {}

  @Get('dashboard')
  @Perms('dashboard.read')
  dashboard(@Admin() ctx: AdminCtx) {
    return this.svc.dashboard(ctx);
  }

  @Get('admins')
  @Perms('admins.manage')
  admins(@Query() q: Q) {
    return this.svc.admins(q);
  }

  @Post('admins')
  @Perms('admins.manage')
  @Reauth()
  invite(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.invite(ctx, b ?? {});
  }

  @Patch('admins/:id')
  @Perms('admins.manage')
  @Reauth()
  rename(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.rename(ctx, id, b ?? {});
  }

  @Put('admins/:id/roles')
  @Perms('admins.manage')
  @Reauth()
  roles(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.setRoles(ctx, id, b ?? {});
  }

  @Post('admins/:id/disable')
  @HttpCode(200)
  @Perms('admins.manage')
  @Reauth()
  disable(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.setStatus(ctx, id, 'disabled', b ?? {});
  }

  @Post('admins/:id/enable')
  @HttpCode(200)
  @Perms('admins.manage')
  @Reauth()
  enable(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.setStatus(ctx, id, 'active', b ?? {});
  }

  @Post('admins/:id/reset-totp')
  @HttpCode(200)
  @Perms('admins.manage')
  @Reauth()
  resetTotp(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.resetTotp(ctx, id, b ?? {});
  }

  @Post('admins/:id/reset-password')
  @HttpCode(200)
  @Perms('admins.manage')
  @Reauth()
  resetPassword(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.resetPassword(ctx, id, b ?? {});
  }

  @Get('roles')
  @Perms('admins.manage')
  roleList() {
    return this.svc.roles();
  }

  @Get('audit-log')
  @Perms('audit.read')
  auditLog(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.auditLog(ctx, q);
  }

  @Get('audit-log/export')
  @Perms('audit.export')
  async auditExport(@Admin() ctx: AdminCtx, @Query() q: Q, @Res() res: Response) {
    await this.svc.auditExport(ctx, q, res);
  }

  @Get('reports/financial')
  @Perms('reports.financial')
  summary(@Query() q: Q) {
    return this.svc.financialSummary(q);
  }

  @Get('reports/financial/:report')
  @Perms('reports.financial', 'reports.operational')
  async report(@Admin() ctx: AdminCtx, @Param('report') code: string, @Query() q: Q, @Res() res: Response) {
    requirePerm(ctx, 'reports.financial', 'reports.operational');
    await this.svc.report(ctx, code, q, res);
  }
}
