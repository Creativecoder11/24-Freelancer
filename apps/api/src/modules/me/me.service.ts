import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma, type InterestTime as DbInterestTime } from '@prisma/client';
import {
  greetingPart,
  initials,
  maskName,
  maskPhoneAuth,
  type ActiveMode,
  type CategorySlug,
  type KycStatus,
  type Me,
  type SessionRow,
  type UserStatus,
} from '@24f/shared';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ApiError } from '../../common/api-error';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { nextPathFor, overviewPath, ProfilesService } from '../auth/profiles.service';
import type { AuthUser } from '../auth/jwt-auth.guard';

const toDbTime = (v: string | null | undefined): DbInterestTime | null | undefined =>
  v === undefined ? undefined : v === null ? null : ((v === '15_60' ? 'v15_60' : v) as DbInterestTime);
const fromDbTime = (v: string | null | undefined) => (v === 'v15_60' ? '15_60' : (v ?? null));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const usd2 = (d: Prisma.Decimal | null | undefined) => (d ? new Prisma.Decimal(d).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN).toFixed(2) : '0.00');

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly profiles: ProfilesService,
  ) {}

  private async user(id: string) {
    const u = await this.prisma.db.user.findUnique({ where: { id } });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    return u;
  }

  /** GET /me (Doc 06 §5.2). */
  async me(id: string): Promise<Me> {
    const u = await this.prisma.db.user.findUnique({
      where: { id },
      include: {
        workerProfile: true,
        employerProfile: true,
        walletAccounts: { select: { kind: true, balanceCached: true } },
        userInterests: { include: { category: { select: { slug: true } } } },
      },
    });
    if (!u) throw new ApiError('UNAUTHENTICATED');
    const now = new Date();
    const [restriction, workerTasks, employerSubs, unread] = await Promise.all([
      this.prisma.db.accountRestriction.findFirst({
        where: { userId: id, liftedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        orderBy: { startsAt: 'desc' },
        include: { appeals: { select: { id: true } } },
      }),
      this.prisma.db.submission.count({ where: { workerUserId: id, status: { in: ['in_review', 'needs_fix'] } } }),
      this.prisma.db.submission.count({ where: { employerUserId: id, status: 'in_review' } }),
      this.prisma.db.notification.count({ where: { userId: id, readAt: null, expiresAt: { gt: now } } }),
    ]);
    const bal = (k: string) => u.walletAccounts.find((w) => w.kind === k)?.balanceCached ?? null;
    const employerTotal = new Prisma.Decimal(bal('employer_available') ?? 0).plus(bal('employer_reserved') ?? 0);
    const env = getEnv();
    const secret = env.LIVECHAT_IDENTITY_SECRET;
    const ep = u.employerProfile;
    const webUrl = env.WEB_APP_URL.replace(/\/$/, '');

    return {
      public_id: u.publicId,
      full_name: u.fullName ?? '',
      name_masked: maskName(u.fullName),
      initials: initials(u.fullName),
      avatar_url: null,
      email: u.email,
      email_verified_at: iso(u.emailVerifiedAt),
      phone_masked: u.phoneE164 ? maskPhoneAuth(u.phoneE164) : null,
      phone_verified_at: iso(u.phoneVerifiedAt),
      country_code: u.countryCode,
      status: u.status as UserStatus,
      restriction: restriction
        ? {
            kind: restriction.kind as 'restricted' | 'suspended',
            public_message: restriction.publicMessage,
            ends_at: iso(restriction.endsAt),
            can_appeal: restriction.appeals.length === 0,
          }
        : null,
      active_mode: u.activeMode as ActiveMode,
      default_mode: u.defaultMode as ActiveMode,
      email_digest_enabled: u.emailDigestEnabled,
      two_step_enabled: u.twoStepEnabled,
      withdrawal_password_required: true,
      password_changed_at: iso(u.passwordChangedAt),
      kyc_status: u.kycStatus as KycStatus,
      kyc_verified_at: iso(u.kycVerifiedAt),
      referral_code: u.referralCode,
      referral_link: u.referralCode ? `${webUrl}/r/${u.referralCode}` : null,
      interests: u.userInterests.map((i) => i.category.slug as CategorySlug),
      interest_time: fromDbTime(u.workerProfile?.interestTime),
      interest_device: u.workerProfile?.interestDevice ?? null,
      onboarding_step: u.onboardingStep,
      onboarding_completed_at: iso(u.onboardingCompletedAt),
      setup_card_dismissed_at: iso(u.setupCardDismissedAt),
      has_worker_profile: !!u.workerProfile,
      has_employer_profile: !!ep,
      employer: ep ? { business_name: ep.businessName, initials: initials(ep.businessName), employer_verified: !!ep.employerVerifiedAt } : null,
      balances: { worker_available_usd: usd2(bal('worker_earnings')), employer_deposit_total_usd: usd2(employerTotal) },
      badges: { worker_tasks: workerTasks, employer_submissions: employerSubs, notifications_unread: unread },
      greeting_part: greetingPart(),
      livechat_identity_hash: secret ? createHmac('sha256', secret).update(u.publicId).digest('hex') : null,
      terms_reaccept_required: false,
    };
  }

  /** PATCH /me. */
  async update(id: string, dto: { full_name?: string; country_code?: string }) {
    const u = await this.prisma.db.user.update({
      where: { id },
      data: { ...(dto.full_name !== undefined ? { fullName: dto.full_name } : {}), ...(dto.country_code ? { countryCode: dto.country_code } : {}), updatedAt: new Date() },
    });
    return { public_id: u.publicId, full_name: u.fullName ?? '', name_masked: maskName(u.fullName), country_code: u.countryCode };
  }

  /** PATCH /me/preferences. The first switch to a mode creates that profile. */
  async preferences(
    id: string,
    dto: { active_mode?: ActiveMode; default_mode?: ActiveMode | null; email_digest_enabled?: boolean; setup_card_dismissed?: boolean },
  ) {
    let employerCreated = false;
    if (dto.active_mode === 'employer') employerCreated = await this.profiles.ensureEmployerProfile(id);
    if (dto.active_mode === 'worker') await this.profiles.ensureWorkerProfile(id);
    const current = await this.user(id);
    const data: Prisma.UserUpdateInput = { updatedAt: new Date() };
    if (dto.active_mode) data.activeMode = dto.active_mode;
    // default_mode null = "Last used": the column is not nullable, so it follows active_mode.
    if (dto.default_mode !== undefined) data.defaultMode = dto.default_mode ?? dto.active_mode ?? current.activeMode;
    if (dto.email_digest_enabled !== undefined) data.emailDigestEnabled = dto.email_digest_enabled;
    if (dto.setup_card_dismissed !== undefined) data.setupCardDismissedAt = dto.setup_card_dismissed ? new Date() : null;
    const u = await this.prisma.db.user.update({ where: { id }, data });
    return {
      active_mode: u.activeMode as ActiveMode,
      default_mode: dto.default_mode === null ? null : (u.defaultMode as ActiveMode),
      email_digest_enabled: u.emailDigestEnabled,
      employer_profile_created: employerCreated,
      next_path: overviewPath(u.activeMode as ActiveMode),
    };
  }

  private async replaceInterests(id: string, slugs: string[]) {
    const cats = await this.prisma.db.category.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
    await this.prisma.db.$transaction([
      this.prisma.db.userInterest.deleteMany({ where: { userId: id } }),
      this.prisma.db.userInterest.createMany({ data: cats.map((c) => ({ userId: id, categoryId: c.id })), skipDuplicates: true }),
    ]);
    return slugs.filter((s) => cats.some((c) => c.slug === s));
  }

  /** PUT /me/interests. */
  async interests(id: string, dto: { categories: string[]; interest_time?: string | null; interest_device?: string | null }) {
    await this.profiles.ensureWorkerProfile(id);
    const interests = await this.replaceInterests(id, dto.categories);
    if (dto.interest_time !== undefined || dto.interest_device !== undefined) {
      await this.prisma.db.workerProfile.update({
        where: { userId: id },
        data: {
          ...(dto.interest_time !== undefined ? { interestTime: toDbTime(dto.interest_time) } : {}),
          ...(dto.interest_device !== undefined ? { interestDevice: (dto.interest_device as 'phone' | 'desktop' | null) ?? null } : {}),
          updatedAt: new Date(),
        },
      });
    }
    return { interests };
  }

  /** POST /me/onboarding (FR-ONB-001…005). */
  async onboarding(id: string, dto: Record<string, unknown> & { step: string }) {
    const u = await this.user(id);
    const now = new Date();
    const data: Prisma.UserUpdateInput = { updatedAt: now };
    switch (dto.step) {
      case 'role': {
        const role = dto.role as ActiveMode;
        if (role === 'employer') await this.profiles.ensureEmployerProfile(id);
        else await this.profiles.ensureWorkerProfile(id);
        data.activeMode = role;
        data.defaultMode = role;
        data.onboardingStep = Math.max(u.onboardingStep, 2);
        break;
      }
      case 'interests': {
        await this.interests(id, {
          categories: (dto.categories as string[]) ?? [],
          interest_time: dto.interest_time as string | null | undefined,
          interest_device: dto.interest_device as string | null | undefined,
        });
        data.onboardingStep = Math.max(u.onboardingStep, 3);
        break;
      }
      case 'payout':
        // Payout methods are owned by the wallet module (encrypted account storage). Until it
        // lands, onboarding offers "Skip for now" only.
        throw new ApiError('FEATURE_DISABLED', 'Add a payout method later in Settings.');
      case 'business': {
        await this.profiles.ensureEmployerProfile(id);
        await this.prisma.db.employerProfile.update({
          where: { userId: id },
          data: {
            businessName: dto.business_name as string,
            websiteUrl: (dto.website_url as string | null) ?? null,
            industry: (dto.industry as string | null) ?? null,
            updatedAt: now,
          },
        });
        data.activeMode = 'employer';
        data.onboardingStep = 4;
        data.onboardingCompletedAt = u.onboardingCompletedAt ?? now;
        break;
      }
      case 'skip': {
        data.onboardingStep = 4;
        data.onboardingCompletedAt = u.onboardingCompletedAt ?? now;
        break;
      }
      default:
        throw new ApiError('VALIDATION_FAILED', undefined, { step: ['Unknown step.'] });
    }
    const updated = await this.prisma.db.user.update({ where: { id }, data });
    return {
      onboarding_step: updated.onboardingStep,
      onboarding_completed_at: iso(updated.onboardingCompletedAt),
      active_mode: updated.activeMode as ActiveMode,
      next_path: nextPathFor(updated),
    };
  }

  // ----- sessions -----

  async listSessions(user: AuthUser): Promise<SessionRow[]> {
    const current = await this.sessions.get(user.sessionId);
    const rows = await this.prisma.db.authSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
    });
    const seen = new Set<string>();
    return rows
      .filter((r) => (seen.has(r.familyId) ? false : (seen.add(r.familyId), true)))
      .map((r) => ({
        id: r.id,
        device_label: r.deviceLabel ?? 'Unknown device',
        city: r.city,
        is_current: !!current && r.familyId === current.familyId,
        last_active_at: r.lastActiveAt.toISOString(),
      }))
      .sort((a, b) => Number(b.is_current) - Number(a.is_current));
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    const row = await this.prisma.db.authSession.findFirst({
      where: { id: sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new ApiError('SESSION_NOT_FOUND');
    const current = await this.sessions.get(user.sessionId);
    if (current && current.familyId === row.familyId) throw new ApiError('INVALID_STATE', 'Use Log out to end this session.');
    await this.sessions.revokeFamily(row.familyId, 'user_revoked');
    return { revoked: true };
  }

  async revokeOthers(user: AuthUser) {
    const current = await this.sessions.get(user.sessionId);
    const n = await this.sessions.revokeAll(user.id, 'revoke_others', current?.familyId);
    return { revoked_count: n };
  }

  // ----- security -----

  async changePassword(id: string, dto: { current_password: string; new_password: string }) {
    await this.passwords.verifyForSensitiveAction(id, dto.current_password, 'password_change', 'current_password');
    this.passwords.assertPolicy(dto.new_password, 'new_password');
    await this.passwords.assertNotReused(id, dto.new_password, 'new_password');
    const at = await this.passwords.setPassword(id, await this.passwords.hash(dto.new_password));
    return { password_changed_at: at.toISOString() };
  }

  async security(id: string, dto: { two_step_enabled: boolean; password?: string }) {
    const u = await this.user(id);
    if (u.twoStepEnabled && !dto.two_step_enabled) {
      await this.passwords.verifyForSensitiveAction(id, dto.password, 'two_step_off', 'password');
    }
    const updated = await this.prisma.db.user.update({ where: { id }, data: { twoStepEnabled: dto.two_step_enabled, updatedAt: new Date() } });
    return { two_step_enabled: updated.twoStepEnabled, withdrawal_password_required: true };
  }
}
