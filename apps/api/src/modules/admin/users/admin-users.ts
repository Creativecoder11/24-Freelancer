import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@24f/db';
import { maskEmail, maskName, maskPhoneAuth } from '@24f/shared';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { SessionService } from '../../auth/session.service';
import { invalidateUserStatus } from '../../auth/jwt-auth.guard';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, Reauth, requirePerm, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { AdminNotifier } from '../core/notify';
import { bool, dec, iso, m2, needEnum, needReason, needText, paged, paging, type Q } from '../core/helpers';
import { AdminJobsService } from '../jobs/admin-jobs';

export const RESTRICTION_CODES = ['fraud_suspected', 'duplicate_account', 'policy_violation', 'chargeback', 'spam_or_abuse', 'identity_unverified', 'other'] as const;

const maskPhone = (p: string | null) => (p ? maskPhoneAuth(p) : null);

/** Users and appeals (Doc 06 §6.3, Doc 09 SCR-ADM-03/04, §7). */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notify: AdminNotifier,
    private readonly jobs: AdminJobsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async byPublicId(publicId: string) {
    const u = await this.db.user.findUnique({ where: { publicId } });
    if (!u) throw new ApiError('NOT_FOUND', `We can't find user ${publicId}.`);
    return u;
  }

  private async riskFlags(userIds: string[]) {
    const map = new Map<string, Set<string>>(userIds.map((id) => [id, new Set<string>()]));
    if (!userIds.length) return map;
    const wds = await this.db.withdrawal.findMany({ where: { userId: { in: userIds }, riskFlags: { isEmpty: false } }, select: { userId: true, riskFlags: true } });
    for (const w of wds) w.riskFlags.forEach((f) => map.get(w.userId)?.add(f));
    const refs = await this.db.referral.findMany({ where: { referredUserId: { in: userIds }, riskFlags: { isEmpty: false } }, select: { referredUserId: true, riskFlags: true } });
    for (const r of refs) r.riskFlags.forEach((f) => map.get(r.referredUserId)?.add(`referral:${f}`));
    return map;
  }

  async list(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const term = (q.q ?? '').trim();
    if (!term && !ctx.has('users.read') && ctx.roles.includes('support_agent') && ctx.roles.length === 1) {
      return paged([], 0, p, { prompt: true });
    }
    const where: Prisma.UserWhereInput = {};
    if (term) {
      if (/^\d{6}$/.test(term)) where.publicId = term;
      else if (term.includes('@')) where.email = { equals: term, mode: 'insensitive' };
      else if (/^\+?[\d\s-]{6,}$/.test(term)) where.phoneE164 = { contains: term.replace(/\D/g, '').replace(/^0/, '') };
      else where.OR = [{ fullName: { contains: term, mode: 'insensitive' } }, { publicId: { startsWith: term } }];
    }
    if (q.status) where.status = q.status as Prisma.EnumUserStatusFilter['equals'];
    if (q.kyc_status) where.kycStatus = q.kyc_status as Prisma.EnumKycStatusFilter['equals'];
    if (bool(q.flagged)) {
      where.AND = [{ OR: [{ withdrawals: { some: { riskFlags: { isEmpty: false } } } }, { referralByReferredUser: { riskFlags: { isEmpty: false } } }] }];
    }
    const sort = q.sort === 'last_login_at' ? { lastLoginAt: 'asc' as const } : q.sort === '-last_login_at' ? { lastLoginAt: 'desc' as const } : q.sort === 'created_at' ? { createdAt: 'asc' as const } : { createdAt: 'desc' as const };
    const [rows, total] = await Promise.all([
      this.db.user.findMany({ where, orderBy: sort, skip: p.skip, take: p.take, include: { employerProfile: { select: { userId: true } } } }),
      this.db.user.count({ where }),
    ]);
    const flags = await this.riskFlags(rows.map((r) => r.id));
    return paged(
      rows.map((u) => ({
        public_id: u.publicId,
        name_masked: u.anonymisedAt ? 'Anonymised' : maskName(u.fullName),
        email_masked: u.email ? maskEmail(u.email) : null,
        phone_masked: maskPhone(u.phoneE164),
        status: u.status,
        kyc_status: u.kycStatus,
        has_employer_profile: !!u.employerProfile,
        risk_flags: [...(flags.get(u.id) ?? [])],
        created_at: iso(u.createdAt),
        last_login_at: iso(u.lastLoginAt),
      })),
      total,
      p,
    );
  }

  async detail(ctx: AdminCtx, publicId: string) {
    const u = await this.db.user.findUnique({
      where: { publicId },
      include: {
        employerProfile: true,
        workerProfile: true,
        walletAccounts: true,
        accountRestrictions: { orderBy: { createdAt: 'desc' }, include: { createdByAdmin: { select: { fullName: true } }, liftedByAdmin: { select: { fullName: true } } } },
        appeals: { orderBy: { createdAt: 'desc' }, include: { restriction: { select: { kind: true } } } },
        authSessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: 'desc' } },
        referralByReferredUser: { include: { referrerUser: { select: { publicId: true } } } },
      },
    });
    if (!u) throw new ApiError('NOT_FOUND', `We can't find user ${publicId}.`);
    const bal = (k: string) => u.walletAccounts.find((w) => w.kind === k)?.balanceCached;
    const [pending, inFlight, subs, jobsPosted, wdPaid, depDone, friends] = await Promise.all([
      this.db.submission.aggregate({ where: { workerUserId: u.id, status: 'in_review' }, _sum: { rewardUsd: true } }),
      this.db.withdrawal.aggregate({ where: { userId: u.id, status: { in: ['requested', 'processing'] } }, _sum: { amountUsd: true } }),
      this.db.submission.count({ where: { workerUserId: u.id } }),
      this.db.job.count({ where: { employerUserId: u.id, status: { not: 'draft' } } }),
      this.db.withdrawal.count({ where: { userId: u.id, status: 'paid' } }),
      this.db.deposit.count({ where: { employerUserId: u.id, status: 'completed' } }),
      this.db.referral.count({ where: { referrerUserId: u.id } }),
    ]);
    const flags = await this.riskFlags([u.id]);
    const unmasked = ctx.isSuper && !u.anonymisedAt;
    if (unmasked) await this.audit.safe(ctx, { action: 'user.view_pii', entityType: 'user', entityId: u.id, entityRef: u.publicId, after: { fields: ['full_name', 'email', 'phone'] } });
    const decided = (u.workerProfile?.approved30d ?? 0) + (u.workerProfile?.rejected30d ?? 0);
    return {
      public_id: u.publicId,
      name_masked: u.anonymisedAt ? 'Anonymised' : maskName(u.fullName),
      email_masked: u.anonymisedAt ? 'Anonymised' : u.email ? maskEmail(u.email) : null,
      phone_masked: u.anonymisedAt ? 'Anonymised' : maskPhone(u.phoneE164),
      unmasked: unmasked ? { full_name: u.fullName, email: u.email, phone: u.phoneE164 } : null,
      country_code: u.countryCode,
      status: u.status,
      kyc_status: u.kycStatus,
      active_mode: u.activeMode,
      has_employer_profile: !!u.employerProfile,
      business_name: u.employerProfile?.businessName ?? null,
      email_verified: !!u.emailVerifiedAt,
      phone_verified: !!u.phoneVerifiedAt,
      two_step_enabled: u.twoStepEnabled,
      terms_version: u.termsVersion,
      created_at: iso(u.createdAt),
      last_login_at: iso(u.lastLoginAt),
      closed_at: iso(u.closedAt),
      anonymised: !!u.anonymisedAt,
      balances: ctx.has('users.read')
        ? {
            worker_available_usd: m2(bal('worker_earnings')),
            worker_pending_usd: m2(pending._sum.rewardUsd),
            worker_in_flight_usd: m2(inFlight._sum.amountUsd),
            employer_available_usd: dec(bal('employer_available')).toFixed(2),
            employer_reserved_usd: m2(bal('employer_reserved')),
          }
        : null,
      stats: { submissions: subs, approval_rate_pct: decided >= 5 ? (u.workerProfile?.approvalRatePct ?? null) : null, jobs_posted: jobsPosted, withdrawals_paid: wdPaid, deposits_completed: depDone },
      restrictions: u.accountRestrictions.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason_code: r.reasonCode,
        internal_note: r.internalNote,
        public_message: r.publicMessage,
        starts_at: iso(r.startsAt),
        ends_at: iso(r.endsAt),
        created_by: r.createdByAdmin.fullName,
        lifted_at: iso(r.liftedAt),
        lifted_by: r.liftedByAdmin?.fullName ?? null,
        active: !r.liftedAt && (!r.endsAt || r.endsAt > new Date()),
      })),
      appeals: u.appeals.map((a) => ({ id: a.id, kind: a.restriction.kind, message: a.message, status: a.status, decision_note: a.decisionNote, decided_at: iso(a.decidedAt), created_at: iso(a.createdAt), restriction_id: a.restrictionId })),
      sessions: u.authSessions.map((s) => ({ id: s.id, device_label: s.deviceLabel ?? 'Unknown device', city: s.city, last_active_at: iso(s.lastActiveAt) })),
      referral: { code: u.referralCode, referred_by: u.referralByReferredUser?.referrerUser.publicId ?? null, friends },
      risk_flags: [...(flags.get(u.id) ?? [])],
    };
  }

  async reveal(ctx: AdminCtx, publicId: string, b: { reason?: string; fields?: string[] }) {
    const reason = needReason(b.reason);
    const fields = (b.fields ?? []).filter((f) => ['full_name', 'email', 'phone'].includes(f));
    if (!fields.length) throw new ApiError('VALIDATION_FAILED', undefined, { fields: ['Choose at least one field.'] });
    const { count } = await this.redis.hit(`admin:reveal:${ctx.id}`, 3600).catch(() => ({ count: 0, ttl: 0 }));
    if (count > 30) throw new ApiError('RATE_LIMITED');
    const u = await this.byPublicId(publicId);
    if (u.anonymisedAt) throw new ApiError('INVALID_STATE', 'This account is anonymised.');
    await this.audit.record(ctx, { action: 'user.reveal_pii', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason, after: { fields } });
    return {
      full_name: fields.includes('full_name') ? u.fullName : undefined,
      email: fields.includes('email') ? u.email : undefined,
      phone: fields.includes('phone') ? u.phoneE164 : undefined,
    };
  }

  private parseRestrictBody(b: Record<string, unknown>) {
    const reason_code = needEnum(b.reason_code, RESTRICTION_CODES, 'reason_code');
    const reason = needReason(b.reason, 1000);
    const public_message = needText(b.public_message, 300, 'public_message', 'Enter a message for the user.');
    let ends_at: Date | null = null;
    if (b.ends_at) {
      ends_at = new Date(String(b.ends_at));
      if (Number.isNaN(ends_at.getTime()) || ends_at <= new Date()) throw new ApiError('VALIDATION_FAILED', undefined, { ends_at: ['Choose a date in the future.'] });
    }
    return { reason_code, reason, public_message, ends_at };
  }

  async restrict(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const i = this.parseRestrictBody(b);
    const u = await this.byPublicId(publicId);
    if (u.status !== 'active') throw new ApiError('INVALID_STATE', 'Only active accounts can be restricted.');
    const r = await this.db.$transaction(async (tx) => {
      const r = await tx.accountRestriction.create({ data: { userId: u.id, kind: 'restricted', reasonCode: i.reason_code, internalNote: i.reason, publicMessage: i.public_message, endsAt: i.ends_at, createdByAdminId: ctx.id } });
      await tx.user.update({ where: { id: u.id }, data: { status: 'restricted' } });
      await this.audit.record(ctx, { action: 'user.restrict', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason: i.reason, before: { status: u.status }, after: { status: 'restricted', restriction_id: r.id, reason_code: i.reason_code } }, tx);
      return r;
    });
    await invalidateUserStatus(this.redis, u.id);
    await this.notify.user(u.id, { type: 'account_restricted', title: 'Your account is restricted', body: i.public_message, mandatory: true, linkPath: '/help' });
    return { public_id: u.publicId, status: 'restricted', restriction_id: r.id, ends_at: iso(r.endsAt) };
  }

  async suspend(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const i = this.parseRestrictBody(b);
    const u = await this.byPublicId(publicId);
    if (u.status !== 'active' && u.status !== 'restricted') throw new ApiError('INVALID_STATE', 'This account is already suspended or closed.');
    const far = new Date(Date.now() + 100 * 365 * 86_400_000);
    const r = await this.db.$transaction(async (tx) => {
      const r = await tx.accountRestriction.create({ data: { userId: u.id, kind: 'suspended', reasonCode: i.reason_code, internalNote: i.reason, publicMessage: i.public_message, endsAt: i.ends_at, createdByAdminId: ctx.id } });
      await tx.user.update({ where: { id: u.id }, data: { status: 'suspended' } });
      const wds = await tx.withdrawal.findMany({ where: { userId: u.id, status: 'requested' }, select: { id: true } });
      for (const w of wds) {
        await tx.withdrawal.update({ where: { id: w.id }, data: { holdUntil: far } });
        await tx.withdrawalEvent.create({ data: { withdrawalId: w.id, fromStatus: 'requested', toStatus: 'requested', actorType: 'admin', actorAdminId: ctx.id, note: 'Held: account suspended', data: { hold: 'suspension' } } });
      }
      return { r, held: wds.length };
    });
    const revoked = await this.sessions.revokeAll(u.id, 'suspended');
    await invalidateUserStatus(this.redis, u.id);
    const running = await this.db.job.findMany({ where: { employerUserId: u.id, status: { in: ['running', 'paused'] } }, select: { publicId: true } });
    for (const j of running) await this.jobs.suspend(ctx, j.publicId, { reason: 'The employer account was suspended.' }, { silentAudit: false }).catch(() => undefined);
    await this.audit.record(ctx, { action: 'user.suspend', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason: i.reason, before: { status: u.status }, after: { status: 'suspended', restriction_id: r.r.id, sessions_revoked: revoked, withdrawals_held: r.held, jobs_suspended: running.length } });
    await this.notify.user(u.id, { type: 'account_suspended', title: 'Your account is suspended', body: i.public_message, mandatory: true });
    return { public_id: u.publicId, status: 'suspended', restriction_id: r.r.id, sessions_revoked: revoked, withdrawals_held: r.held };
  }

  async reinstate(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const u = await this.byPublicId(publicId);
    if (u.status !== 'restricted' && u.status !== 'suspended') throw new ApiError('INVALID_STATE', 'This account is not restricted or suspended.');
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.accountRestriction.updateMany({ where: { userId: u.id, liftedAt: null }, data: { liftedAt: now, liftedByAdminId: ctx.id } });
      await tx.user.update({ where: { id: u.id }, data: { status: 'active' } });
      const held = await tx.withdrawal.findMany({ where: { userId: u.id, status: 'requested', holdUntil: { gt: new Date(Date.now() + 50 * 365 * 86_400_000) } }, select: { id: true } });
      for (const w of held) await tx.withdrawal.update({ where: { id: w.id }, data: { holdUntil: null } });
      await this.audit.record(ctx, { action: 'user.reinstate', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason, before: { status: u.status }, after: { status: 'active', lifted_at: now } }, tx);
    });
    await invalidateUserStatus(this.redis, u.id);
    await this.notify.user(u.id, { type: 'account_reinstated', title: 'Your account is active again', body: 'You can use 24 Freelancing as usual.', mandatory: true });
    return { public_id: u.publicId, status: 'active', lifted_at: now.toISOString() };
  }

  async reset2fa(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const u = await this.byPublicId(publicId);
    if (!u.twoStepEnabled) throw new ApiError('INVALID_STATE', 'Two-step verification is already off.');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { twoStepEnabled: false } });
      await tx.trustedDevice.deleteMany({ where: { userId: u.id } });
      await this.audit.record(ctx, { action: 'user.reset_2fa', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason, before: { two_step_enabled: true }, after: { two_step_enabled: false } }, tx);
    });
    const revoked = await this.sessions.revokeAll(u.id, 'admin_reset_2fa');
    await this.notify.user(u.id, {
      type: 'security_2fa_reset',
      title: 'Two-step verification turned off',
      body: "Two-step verification was turned off on your account by our support team. If this wasn't requested by you, contact us now.",
      mandatory: true,
    });
    return { public_id: u.publicId, two_step_enabled: false, sessions_revoked: revoked };
  }

  async revokeSessions(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const reason = needReason(b.reason);
    const u = await this.byPublicId(publicId);
    const revoked = await this.sessions.revokeAll(u.id, 'admin_revoke');
    await this.db.trustedDevice.deleteMany({ where: { userId: u.id } });
    await this.audit.record(ctx, { action: 'user.sessions_revoke', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason, after: { count: revoked } });
    await this.notify.user(u.id, { type: 'security_signed_out', title: 'You were signed out everywhere', body: 'Our team signed your account out of every device. Sign in again to continue.', mandatory: true });
    return { public_id: u.publicId, sessions_revoked: revoked };
  }

  async contact(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const kind = needEnum(b.kind, ['email', 'phone'] as const, 'kind');
    const reason = needReason(b.reason);
    let value = needText(b.value, 254, 'value', kind === 'email' ? 'Enter a valid email.' : 'Enter a valid phone number.');
    if (kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new ApiError('VALIDATION_FAILED', undefined, { value: ['Enter a valid email.'] });
    if (kind === 'phone') {
      const d = value.replace(/\D/g, '');
      const local = d.startsWith('880') ? d.slice(3) : d.replace(/^0/, '');
      if (!/^1[3-9]\d{8}$/.test(local)) throw new ApiError('VALIDATION_FAILED', undefined, { value: ['Enter a valid Bangladesh mobile number.'] });
      value = `+880${local}`;
    }
    const u = await this.byPublicId(publicId);
    if (u.status === 'closed') throw new ApiError('INVALID_STATE');
    const taken = await this.db.user.findFirst({ where: kind === 'email' ? { email: { equals: value, mode: 'insensitive' }, id: { not: u.id } } : { phoneE164: value, id: { not: u.id } } });
    if (taken) throw new ApiError('IDENTIFIER_TAKEN', 'This email or phone is on another account.', { value: ['This email or phone is on another account.'] });
    const old = kind === 'email' ? u.email : u.phoneE164;
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: kind === 'email' ? { email: value, emailVerifiedAt: null } : { phoneE164: value, phoneVerifiedAt: null } });
      await this.audit.record(ctx, { action: 'user.contact_change', entityType: 'user', entityId: u.id, entityRef: u.publicId, reason, before: { [kind]: old }, after: { [kind]: value } }, tx);
    });
    await this.notify.user(u.id, { type: 'security_contact_changed', title: `Your ${kind} was changed`, body: `Our support team changed the ${kind} on your account. If you didn't ask for this, contact us now.`, mandatory: true });
    return { public_id: u.publicId, kind, value_masked: kind === 'email' ? maskEmail(value) : maskPhoneAuth(value), verified: false };
  }

  async logAppeal(ctx: AdminCtx, publicId: string, b: Record<string, unknown>) {
    const message = needText(b.message, 1000, 'message', 'Enter 20 to 1,000 characters.', 20);
    const u = await this.byPublicId(publicId);
    const r = await this.db.accountRestriction.findFirst({ where: { userId: u.id, liftedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!r) throw new ApiError('INVALID_STATE', 'This account has no active restriction, or already has an open appeal.');
    const open = await this.db.appeal.findFirst({ where: { restrictionId: r.id, status: { in: ['open', 'under_review'] } } });
    if (open) throw new ApiError('INVALID_STATE', 'This account has no active restriction, or already has an open appeal.');
    const a = await this.db.$transaction(async (tx) => {
      const a = await tx.appeal.create({ data: { userId: u.id, restrictionId: r.id, message } });
      await this.audit.record(ctx, { action: 'appeal.create', entityType: 'appeal', entityId: a.id, entityRef: u.publicId, after: { message_length: message.length, restriction_id: r.id } }, tx);
      return a;
    });
    return { id: a.id, status: a.status, restriction_id: r.id };
  }

  async appeals(q: Q) {
    const p = paging(q);
    const status = (q.status ?? 'open') as Prisma.EnumAppealStatusFilter['equals'];
    const where: Prisma.AppealWhereInput = q.status === 'all' ? {} : { status };
    const [rows, total, open, ur] = await Promise.all([
      this.db.appeal.findMany({ where, orderBy: { createdAt: 'asc' }, skip: p.skip, take: p.take, include: { user: { select: { publicId: true, fullName: true } }, restriction: { select: { kind: true, reasonCode: true } } } }),
      this.db.appeal.count({ where }),
      this.db.appeal.count({ where: { status: 'open' } }),
      this.db.appeal.count({ where: { status: 'under_review' } }),
    ]);
    return paged(
      rows.map((a) => ({ id: a.id, user_public_id: a.user.publicId, user_name_masked: maskName(a.user.fullName), kind: a.restriction.kind, reason_code: a.restriction.reasonCode, message: a.message, status: a.status, decision_note: a.decisionNote, created_at: iso(a.createdAt) })),
      total,
      p,
      { counts: { open, under_review: ur } },
    );
  }

  async decideAppeal(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const outcome = needEnum(b.outcome, ['upheld', 'denied'] as const, 'outcome');
    const note = needText(b.decision_note, 500, 'decision_note', 'Enter a note for the user.');
    const a = await this.db.appeal.findUnique({ where: { id }, include: { user: true } });
    if (!a) throw new ApiError('NOT_FOUND');
    if (a.status === 'upheld' || a.status === 'denied') throw new ApiError('ALREADY_DECIDED', 'This appeal was already decided.');
    const now = new Date();
    let userStatus = a.user.status;
    await this.db.$transaction(async (tx) => {
      await tx.appeal.update({ where: { id }, data: { status: outcome, decisionNote: note, decidedAt: now, decidedByAdminId: ctx.id } });
      if (outcome === 'upheld') {
        await tx.accountRestriction.update({ where: { id: a.restrictionId }, data: { liftedAt: now, liftedByAdminId: ctx.id } });
        const still = await tx.accountRestriction.findFirst({ where: { userId: a.userId, liftedAt: null }, orderBy: { createdAt: 'desc' } });
        userStatus = still ? (still.kind === 'suspended' ? 'suspended' : 'restricted') : 'active';
        await tx.user.update({ where: { id: a.userId }, data: { status: userStatus } });
      }
      await this.audit.record(ctx, { action: 'appeal.decide', entityType: 'appeal', entityId: id, entityRef: a.user.publicId, reason: note, after: { status: outcome, user_status: userStatus } }, tx);
    });
    await invalidateUserStatus(this.redis, a.userId);
    await this.notify.user(a.userId, { type: 'appeal_decided', title: outcome === 'upheld' ? 'Your appeal was upheld' : 'Your appeal was denied', body: note, mandatory: true });
    return { id, status: outcome, user_status: userStatus };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get('users')
  @Perms('users.read_masked', 'users.read')
  list(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.list(ctx, q);
  }

  @Get('users/:publicId')
  @Perms('users.read_masked', 'users.read')
  detail(@Admin() ctx: AdminCtx, @Param('publicId') id: string) {
    return this.svc.detail(ctx, id);
  }

  @Post('users/:publicId/reveal')
  @HttpCode(200)
  @Perms('users.reveal')
  reveal(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: { reason?: string; fields?: string[] }) {
    return this.svc.reveal(ctx, id, b ?? {});
  }

  @Post('users/:publicId/restrict')
  @HttpCode(200)
  @Perms('users.restrict')
  restrict(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.restrict(ctx, id, b ?? {});
  }

  @Post('users/:publicId/suspend')
  @HttpCode(200)
  @Perms('users.suspend')
  suspend(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.suspend(ctx, id, b ?? {});
  }

  @Post('users/:publicId/reinstate')
  @HttpCode(200)
  @Perms('users.suspend')
  reinstate(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reinstate(ctx, id, b ?? {});
  }

  @Post('users/:publicId/reset-2fa')
  @HttpCode(200)
  @Perms('users.security')
  @Reauth()
  reset2fa(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reset2fa(ctx, id, b ?? {});
  }

  @Post('users/:publicId/sessions/revoke')
  @HttpCode(200)
  @Perms('users.security')
  revoke(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.revokeSessions(ctx, id, b ?? {});
  }

  @Post('users/:publicId/contact')
  @HttpCode(200)
  @Perms('users.contact')
  @Reauth()
  contact(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.contact(ctx, id, b ?? {});
  }

  @Post('users/:publicId/appeals')
  @Perms('appeals.log')
  logAppeal(@Admin() ctx: AdminCtx, @Param('publicId') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.logAppeal(ctx, id, b ?? {});
  }

  @Get('appeals')
  @Perms('appeals.read')
  appeals(@Query() q: Q) {
    return this.svc.appeals(q);
  }

  @Post('appeals/:id/decide')
  @HttpCode(200)
  @Perms('appeals.decide')
  decide(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    requirePerm(ctx, 'appeals.decide');
    return this.svc.decideAppeal(ctx, id, b ?? {});
  }
}
