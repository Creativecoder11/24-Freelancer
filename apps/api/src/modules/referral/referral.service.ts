import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Prisma } from '@24f/db';
import { formatDate, formatMoney, maskName, type ReferralStatus } from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { getEnv } from '../../config/env';
import { SettingsService } from '../settings/settings.service';
import { notifyDirect } from '../payout-methods/direct-notify';

const D = (v: Prisma.Decimal | Decimal.Value | null | undefined) => new Decimal((v ?? 0).toString());
const m2 = (v: Decimal) => v.toFixed(2, Decimal.ROUND_DOWN);
const OFFSET = 6 * 3_600_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type RefRow = Prisma.ReferralGetPayload<{ include: { referredUser: { select: { fullName: true } } } }>;

export interface FriendRow {
  id: string;
  name_masked: string;
  initials: string;
  joined_at: string;
  tasks: number;
  deposits_usd: string | null;
  earned_usd: string | null;
  status: ReferralStatus;
  can_remind: boolean;
  next_reminder_at: string | null;
  reminders_left: number;
  last_activity_at: string | null;
}

/** Referral dashboard (Doc 06 §5.14, Doc 08 §9.3). Single level, platform-paid commissions. */
@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async assertEnabled() {
    if (!(await this.settings.get<boolean>('referral_enabled', true))) throw new ApiError('FEATURE_DISABLED', 'The referral program is paused right now.');
  }

  private async rates() {
    const [task, dep, cooldownH] = await Promise.all([this.settings.number('referral_task_rate', 0.05), this.settings.number('referral_deposit_rate', 0.05), this.settings.number('referral_reminder_cooldown_hours', 168)]);
    return { task: new Decimal(task), dep: new Decimal(dep), cooldownH };
  }

  private remindState(r: { status: string; reminderCount: number; lastRemindedAt: Date | null }, cooldownH: number) {
    const next = r.lastRemindedAt ? new Date(r.lastRemindedAt.getTime() + cooldownH * 3_600_000) : null;
    const left = Math.max(0, 3 - r.reminderCount);
    const can = r.status === 'not_started' && left > 0 && (!next || next.getTime() <= Date.now());
    return { can, next: next && next.getTime() > Date.now() ? next : null, left };
  }

  /** Per-friend rows with tasks, deposits and earnings. */
  private async friendRows(userId: string, refs: RefRow[]): Promise<FriendRow[]> {
    if (!refs.length) return [];
    const { cooldownH } = await this.rates();
    const friendIds = refs.map((r) => r.referredUserId);
    const [tasks, comm] = await Promise.all([
      this.prisma.db.submission.groupBy({ by: ['workerUserId'], where: { workerUserId: { in: friendIds }, status: 'approved' }, _count: { _all: true } }),
      this.prisma.db.referralCommission.groupBy({ by: ['referralId', 'sourceType'], where: { referrerUserId: userId, status: 'credited' }, _sum: { amount: true, baseAmount: true }, _max: { createdAt: true } }),
    ]);
    return refs.map((r) => {
      const c = comm.filter((x) => x.referralId === r.id);
      const earned = c.reduce((s, x) => s.plus(D(x._sum.amount)), new Decimal(0));
      const deposits = D(c.find((x) => x.sourceType === 'deposit')?._sum.baseAmount);
      const lastComm = c.map((x) => x._max.createdAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
      const masked = maskName(r.referredUser.fullName);
      const rs = this.remindState(r, cooldownH);
      const last = [r.lastActivityAt, lastComm].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        id: r.id,
        name_masked: masked,
        initials: masked.replace(/\*/g, '').slice(0, 2).toUpperCase(),
        joined_at: r.createdAt.toISOString(),
        tasks: tasks.find((t) => t.workerUserId === r.referredUserId)?._count._all ?? 0,
        deposits_usd: deposits.gt(0) ? m2(deposits) : null,
        earned_usd: earned.gt(0) ? m2(earned) : null,
        status: r.status as ReferralStatus,
        can_remind: rs.can,
        next_reminder_at: rs.next?.toISOString() ?? null,
        reminders_left: rs.left,
        last_activity_at: last?.toISOString() ?? null,
      };
    });
  }

  private sortFriends(rows: FriendRow[]) {
    const order: Record<string, number> = { active: 0, not_started: 1, ineligible: 2 };
    return rows.sort((a, b) => order[a.status]! - order[b.status]! || D(b.earned_usd).cmp(D(a.earned_usd)) || b.joined_at.localeCompare(a.joined_at));
  }

  async summary(userId: string) {
    await this.assertEnabled();
    const { task, dep } = await this.rates();
    const [user, refs, comm] = await Promise.all([
      this.prisma.db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
      this.prisma.db.referral.findMany({ where: { referrerUserId: userId }, include: { referredUser: { select: { fullName: true } } } }),
      this.prisma.db.referralCommission.groupBy({ by: ['sourceType', 'status'], where: { referrerUserId: userId }, _sum: { amount: true } }),
    ]);
    const sum = (src: string | null, st: string) => comm.filter((c) => (src ? c.sourceType === src : true) && c.status === st).reduce((s, c) => s.plus(D(c._sum.amount)), new Decimal(0));
    const fromTasks = sum('task', 'credited');
    const fromDeposits = sum('deposit', 'credited');
    const friendIds = refs.filter((r) => r.status !== 'ineligible').map((r) => r.referredUserId);
    const pendingBase = friendIds.length
      ? await this.prisma.db.submission.aggregate({ where: { workerUserId: { in: friendIds }, status: 'in_review' }, _sum: { rewardUsd: true } })
      : { _sum: { rewardUsd: null } };
    const rows = this.sortFriends(await this.friendRows(userId, refs));
    const earners = rows.filter((r) => r.status === 'active').sort((a, b) => D(b.earned_usd).cmp(D(a.earned_usd)));
    const top = [...earners.slice(0, 3), ...rows.filter((r) => r.status === 'not_started')].slice(0, 4);
    if (top.length < 4) top.push(...earners.slice(3, 3 + (4 - top.length)));
    const code = user.referralCode ?? '';
    const link = `${getEnv().WEB_APP_URL.replace(/\/$/, '')}/r/${code}`;
    const pct = task.times(100).toDecimalPlaces(0).toString();
    return {
      code,
      link,
      public_link: `https://24freelancing.com/r/${code}`,
      task_rate: task.toString(),
      deposit_rate: dep.toString(),
      share_message: `I use 24 Freelancing to earn from small online tasks. Join with my link: ${link}`,
      stats: {
        friends_joined: refs.filter((r) => r.status !== 'ineligible').length,
        active_friends: refs.filter((r) => r.status === 'active').length,
        from_tasks_usd: m2(fromTasks),
        from_deposits_usd: m2(fromDeposits),
        total_earned_usd: m2(fromTasks.plus(fromDeposits)),
      },
      commission_status: {
        added_to_balance_usd: m2(fromTasks.plus(fromDeposits)),
        pending_usd: m2(D(pendingBase._sum.rewardUsd).times(task)),
        not_eligible_usd: m2(sum(null, 'ineligible')),
      },
      rate_label: `${pct}%`,
      top_friends: top,
    };
  }

  async friends(userId: string, q: { tab: 'all' | 'active' | 'not_started'; page: number; per_page: number }) {
    await this.assertEnabled();
    const refs = await this.prisma.db.referral.findMany({ where: { referrerUserId: userId }, include: { referredUser: { select: { fullName: true } } } });
    const rows = this.sortFriends(await this.friendRows(userId, refs));
    const filtered = q.tab === 'all' ? rows : rows.filter((r) => r.status === q.tab);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / q.per_page));
    return {
      data: filtered.slice((q.page - 1) * q.per_page, q.page * q.per_page),
      meta: {
        total,
        page: q.page,
        per_page: q.per_page,
        total_pages: totalPages,
        has_more: q.page < totalPages,
        counts: { all: rows.length, active: rows.filter((r) => r.status === 'active').length, not_started: rows.filter((r) => r.status === 'not_started').length },
      },
    };
  }

  private async owned(userId: string, id: string) {
    const r = await this.prisma.db.referral.findFirst({ where: { id, referrerUserId: userId }, include: { referredUser: { select: { fullName: true } } } });
    if (!r) throw new ApiError('NOT_FOUND', 'We couldn’t find that friend.');
    return r;
  }

  async friend(userId: string, id: string) {
    await this.assertEnabled();
    const { task, dep } = await this.rates();
    const r = await this.owned(userId, id);
    const [row] = await this.friendRows(userId, [r]);
    const comms = await this.prisma.db.referralCommission.findMany({ where: { referralId: r.id, status: 'credited' }, orderBy: { createdAt: 'desc' } });
    const local = new Date(Date.now() + OFFSET);
    const months = [2, 1, 0].map((back) => {
      const y = local.getUTCFullYear();
      const m = local.getUTCMonth() - back;
      const start = new Date(Date.UTC(y, m, 1) - OFFSET);
      const end = new Date(Date.UTC(y, m + 1, 1) - OFFSET);
      const amt = comms.filter((c) => (c.creditedAt ?? c.createdAt) >= start && (c.creditedAt ?? c.createdAt) < end).reduce((s, c) => s.plus(D(c.amount)), new Decimal(0));
      const label = new Date(Date.UTC(y, m, 1));
      return { month: label.toISOString().slice(0, 7), label: MONTHS[label.getUTCMonth()]!, amount_usd: m2(amt), is_current: back === 0 };
    });
    // Recent commission grouped per Dhaka day and source (A-30).
    const groups = new Map<string, { date: string; source_type: 'task' | 'deposit'; tasks: number; base: Decimal; amount: Decimal }>();
    for (const c of comms) {
      const date = new Date((c.creditedAt ?? c.createdAt).getTime() + OFFSET).toISOString().slice(0, 10);
      const key = `${date}|${c.sourceType}`;
      const g = groups.get(key) ?? { date, source_type: c.sourceType as 'task' | 'deposit', tasks: 0, base: new Decimal(0), amount: new Decimal(0) };
      g.tasks += c.sourceType === 'task' ? 1 : 0;
      g.base = g.base.plus(D(c.baseAmount));
      g.amount = g.amount.plus(D(c.amount));
      groups.set(key, g);
    }
    const pctT = task.times(100).toDecimalPlaces(0).toString();
    const pctD = dep.times(100).toDecimalPlaces(0).toString();
    const recent = [...groups.values()].slice(0, 5).map((g) => ({
      date: g.date,
      source_type: g.source_type,
      label: g.source_type === 'task' ? `${pctT}% of ${g.tasks} task${g.tasks === 1 ? '' : 's'}` : `${pctD}% of ${formatMoney(m2(g.base))} deposit`,
      tasks: g.tasks,
      amount_usd: m2(g.amount),
    }));
    return { ...row!, earned_usd: row!.earned_usd ?? '0.00', monthly_earnings: months, recent_commission: recent };
  }

  async remind(userId: string, id: string) {
    await this.assertEnabled();
    const { cooldownH } = await this.rates();
    const r = await this.owned(userId, id);
    if (r.status !== 'not_started') throw new ApiError('FRIEND_ALREADY_ACTIVE');
    const st = this.remindState(r, cooldownH);
    if (!st.can) {
      const msg = st.left === 0 ? 'You’ve already sent 3 reminders to this friend.' : `You sent a reminder recently. Try again on ${formatDate(st.next ?? new Date())}.`;
      throw new ApiError('REMINDER_COOLDOWN', msg, undefined, { next_allowed_at: st.next?.toISOString() ?? null, reminders_left: st.left });
    }
    const now = new Date();
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const u = await tx.referral.updateMany({ where: { id: r.id, reminderCount: r.reminderCount }, data: { reminderCount: { increment: 1 }, lastRemindedAt: now, updatedAt: now } });
      if (u.count !== 1) throw new ApiError('REMINDER_COOLDOWN');
      await notifyDirect(tx, {
        userId: r.referredUserId,
        type: 'referral_reminder',
        category: 'system',
        title: 'Ready to earn your first reward?',
        body: 'Your friend invited you to 24 Freelancing. Pick a short task and get paid when it’s approved.',
        link: '/worker/jobs',
      });
      return tx.referral.findUniqueOrThrow({ where: { id: r.id } });
    });
    const next = this.remindState(updated, cooldownH);
    return { sent: true, next_allowed_at: new Date(now.getTime() + cooldownH * 3_600_000).toISOString(), reminders_left: next.left };
  }
}
