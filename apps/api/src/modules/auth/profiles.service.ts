import { Injectable } from '@nestjs/common';
import type { ActiveMode, SessionUser } from '@24f/shared';
import type { Prisma, WalletAccountKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';

type Tx = Prisma.TransactionClient;

export const WORKER_WALLETS: WalletAccountKind[] = ['worker_earnings'];
export const EMPLOYER_WALLETS: WalletAccountKind[] = ['employer_available', 'employer_reserved'];

/** Where onboarding resumes for a given step (Doc 03 §2.5 `onboardingPath`). */
export function onboardingPath(step: number, mode: ActiveMode): string {
  if (step <= 1) return '/onboarding/role';
  if (mode === 'employer') return '/onboarding/business';
  if (step === 2) return '/onboarding/interests';
  return '/onboarding/payout';
}

export function overviewPath(mode: ActiveMode) {
  return mode === 'employer' ? '/employer' : '/worker';
}

export function nextPathFor(u: { onboardingCompletedAt: Date | null; onboardingStep: number; activeMode: ActiveMode | string }) {
  const mode = u.activeMode as ActiveMode;
  return u.onboardingCompletedAt ? overviewPath(mode) : onboardingPath(u.onboardingStep, mode);
}

export function sessionUser(u: {
  publicId: string;
  fullName: string | null;
  activeMode: string;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
}): SessionUser {
  return {
    public_id: u.publicId,
    full_name: u.fullName ?? '',
    active_mode: u.activeMode as ActiveMode,
    onboarding_step: u.onboardingStep,
    next_path: nextPathFor({ ...u, activeMode: u.activeMode as ActiveMode }),
  };
}

/** Lazy worker/employer profile creation and wallet accounts (Doc 04 §4.2). */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async ensureWallets(userId: string, kinds: WalletAccountKind[], t: Tx = this.prisma.db) {
    await t.walletAccount.createMany({ data: kinds.map((kind) => ({ ownerUserId: userId, kind })), skipDuplicates: true });
  }

  async ensureWorkerProfile(userId: string, t: Tx = this.prisma.db) {
    await t.workerProfile.createMany({ data: [{ userId }], skipDuplicates: true });
    await this.ensureWallets(userId, WORKER_WALLETS, t);
  }

  /** Returns true when the profile was created by this call. */
  async ensureEmployerProfile(userId: string, t: Tx = this.prisma.db): Promise<boolean> {
    const existing = await t.employerProfile.findUnique({ where: { userId }, select: { userId: true } });
    if (!existing) {
      const user = await t.user.findUnique({ where: { id: userId }, select: { fullName: true } });
      const [reviewWindow, autoApprove] = await Promise.all([
        this.settings.number('review_window_default', 72),
        this.settings.get<boolean>('auto_approve_default', true),
      ]);
      const res = await t.employerProfile.createMany({
        data: [
          {
            userId,
            businessName: (user?.fullName ?? 'New employer').slice(0, 80),
            defaultReviewWindowHours: reviewWindow,
            defaultAutoApprove: autoApprove === true || String(autoApprove) === 'true',
          },
        ],
        skipDuplicates: true,
      });
      await this.ensureWallets(userId, EMPLOYER_WALLETS, t);
      return res.count === 1;
    }
    await this.ensureWallets(userId, EMPLOYER_WALLETS, t);
    return false;
  }
}
