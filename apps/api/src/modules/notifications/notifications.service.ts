import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@24f/db';
import {
  LOCKED_PREFERENCE_MESSAGE,
  type NotificationCategory,
  type NotificationPreferenceRow,
  type NotificationPreferences,
  type NotificationPrefKey,
  type NotificationRow,
  type NotificationsMeta,
  type NotificationsQuery,
  type UnreadCount,
} from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/api-error';
import { SettingsService } from '../settings/settings.service';
import { LOCKED_PREF_KEYS, NOTIFICATION_CATALOGUE, PREFERENCE_DEFAULTS, render, type CatalogueEntry, type NotificationType } from './notification-catalogue';

type Tx = Prisma.TransactionClient | PrismaClient;
type Audience = 'worker' | 'employer';

export interface NotifyOptions {
  /** One notification per (user, dedupe key), Doc 04 §9.4. */
  dedupeKey?: string;
  /** Run inside the caller's transaction so the notice commits with the business change. */
  tx?: Tx;
  /** Overrides the catalogue's audience (e.g. account notices follow the active mode). */
  audience?: Audience;
  /** Extra safe data stored on the row (never account or document numbers, Doc 05 §7.3). */
  data?: Record<string, unknown>;
}

const CATEGORIES: NotificationCategory[] = ['tasks', 'payments', 'referrals', 'system'];

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const d = new Date(at ?? '');
    if (Number.isNaN(d.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at: d, id };
  } catch {
    return null;
  }
}

/**
 * In-app notifications (Doc 04 §9, Doc 06 §5.15). Other modules call `notify()`:
 *
 *   await notifications.notify('task_approved', workerId, { reward: '$0.120', job, employer, ref }, { tx });
 *
 * Preferences gate non-mandatory types; a missing preference row means the catalogue default.
 * Email delivery is queued by the email module (Doc 11 §7.4) when it exists; this service only
 * records the in-app row and logs the email intent.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  async notify(type: NotificationType, userId: string, vars: Record<string, string | number | null | undefined> = {}, opts: NotifyOptions = {}) {
    const def: CatalogueEntry = NOTIFICATION_CATALOGUE[type];
    const tx = opts.tx ?? this.prisma.db;
    try {
      let inApp = true;
      let email = !!def.email;
      if (!def.mandatory && def.prefKey) {
        const pref = await tx.notificationPreference.findUnique({ where: { userId_prefKey: { userId, prefKey: def.prefKey } } });
        const fallback = this.defaultFor(def.prefKey);
        inApp = pref ? pref.inAppEnabled : fallback;
        email = email && (pref ? pref.emailEnabled : fallback);
      }
      if (!inApp) return null;
      let audience: Audience = opts.audience ?? (def.audience === 'active' ? 'worker' : def.audience);
      if (!opts.audience && def.audience === 'active') {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { activeMode: true } });
        audience = (u?.activeMode as Audience) ?? 'worker';
      }
      if (opts.dedupeKey) {
        const dup = await tx.notification.findFirst({ where: { userId, dedupeKey: opts.dedupeKey }, select: { id: true } });
        if (dup) return null;
      }
      const days = await this.settings.number('notification_retention_days', 90);
      const row = await tx.notification.create({
        data: {
          userId,
          audience,
          category: def.category,
          type,
          title: render(def.title, vars).slice(0, 120),
          body: render(def.body, vars).slice(0, 300),
          linkPath: def.link ? render(def.link, vars).slice(0, 300) : null,
          isMandatory: !!def.mandatory,
          data: (opts.data ?? {}) as Prisma.InputJsonValue,
          dedupeKey: opts.dedupeKey ?? null,
          expiresAt: new Date(Date.now() + days * 86_400_000),
        },
      });
      if (email) this.log.debug(`email intent ${type} → ${userId}`);
      return row;
    } catch (e) {
      // A notification must never break the business action that triggered it.
      this.log.warn(`notify ${type} failed: ${e instanceof Error ? e.message : String(e)}`);
      if (opts.tx) throw e;
      return null;
    }
  }

  private defaultFor(key: NotificationPrefKey): boolean {
    const row = [...PREFERENCE_DEFAULTS.worker, ...PREFERENCE_DEFAULTS.employer].find((p) => p.pref_key === key);
    return row?.on ?? true;
  }

  // ---------------------------------------------------------------------------
  // Read APIs
  // ---------------------------------------------------------------------------

  private async audienceFor(userId: string, audience?: Audience): Promise<Audience> {
    if (audience) return audience;
    const u = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { activeMode: true } });
    return (u?.activeMode as Audience) ?? 'worker';
  }

  async list(userId: string, q: NotificationsQuery): Promise<{ data: NotificationRow[]; meta: NotificationsMeta }> {
    const db = this.prisma.db;
    const audience = await this.audienceFor(userId, q.audience);
    const now = new Date();
    const base: Prisma.NotificationWhereInput = { userId, audience, expiresAt: { gt: now } };
    const where: Prisma.NotificationWhereInput = q.category === 'all' ? base : { ...base, category: q.category };
    const cur = decodeCursor(q.cursor);
    const pageWhere: Prisma.NotificationWhereInput = cur
      ? { AND: [where, { OR: [{ createdAt: { lt: cur.at } }, { createdAt: cur.at, id: { lt: cur.id } }] }] }
      : where;

    const [rows, grouped, unread] = await Promise.all([
      db.notification.findMany({ where: pageWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.per_page + 1 }),
      db.notification.groupBy({ by: ['category'], where: base, _count: { _all: true } }),
      db.notification.count({ where: { ...base, readAt: null } }),
    ]);
    const counts = { all: 0, tasks: 0, payments: 0, referrals: 0, system: 0 } as NotificationsMeta['counts'];
    for (const g of grouped) {
      counts[g.category as NotificationCategory] = g._count._all;
      counts.all += g._count._all;
    }
    const hasMore = rows.length > q.per_page;
    const page = rows.slice(0, q.per_page);
    const last = page[page.length - 1];
    return {
      data: page.map((n) => ({
        id: n.id,
        category: n.category as NotificationCategory,
        type: n.type,
        title: n.title,
        body: n.body,
        link_path: n.linkPath,
        is_mandatory: n.isMandatory,
        read_at: n.readAt?.toISOString() ?? null,
        created_at: n.createdAt.toISOString(),
      })),
      meta: {
        total: q.category === 'all' ? counts.all : counts[q.category],
        per_page: q.per_page,
        next_cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        has_more: hasMore,
        counts,
        unread,
      },
    };
  }

  async unreadCount(userId: string, audience?: Audience): Promise<UnreadCount> {
    const rows = await this.prisma.db.notification.groupBy({
      by: ['audience'],
      where: { userId, readAt: null, expiresAt: { gt: new Date() } },
      _count: { _all: true },
    });
    const by = { worker: 0, employer: 0 };
    for (const r of rows) by[r.audience as Audience] = r._count._all;
    const a = await this.audienceFor(userId, audience);
    return { unread: by[a], by_audience: by };
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.db.notification.findFirst({ where: { id, userId } });
    if (!n) throw new ApiError('NOT_FOUND');
    const readAt = n.readAt ?? new Date();
    if (!n.readAt) await this.prisma.db.notification.update({ where: { id }, data: { readAt } });
    const unread = await this.prisma.db.notification.count({ where: { userId, audience: n.audience, readAt: null, expiresAt: { gt: new Date() } } });
    return { id, read_at: readAt.toISOString(), unread };
  }

  async markAllRead(userId: string, body: { audience?: Audience; category?: string }) {
    const audience = await this.audienceFor(userId, body.audience);
    const where: Prisma.NotificationWhereInput = { userId, audience, readAt: null, ...(body.category ? { category: body.category as NotificationCategory } : {}) };
    const res = await this.prisma.db.notification.updateMany({ where, data: { readAt: new Date() } });
    const unread = await this.prisma.db.notification.count({ where: { userId, audience, readAt: null, expiresAt: { gt: new Date() } } });
    return { marked: res.count, unread };
  }

  // ---------------------------------------------------------------------------
  // Preferences (C-11: payout updates locked on)
  // ---------------------------------------------------------------------------

  async preferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.prisma.db.notificationPreference.findMany({ where: { userId } });
    const map = new Map(rows.map((r) => [r.prefKey as NotificationPrefKey, r]));
    const build = (aud: Audience): NotificationPreferenceRow[] =>
      PREFERENCE_DEFAULTS[aud].map((d) => {
        const r = map.get(d.pref_key);
        const locked = !!d.locked;
        return {
          pref_key: d.pref_key,
          label: d.label,
          ...(d.helper ? { helper: d.helper } : {}),
          in_app_enabled: locked ? true : (r?.inAppEnabled ?? d.on),
          email_enabled: locked ? true : (r?.emailEnabled ?? d.on),
          is_locked: locked,
        };
      });
    return { worker: build('worker'), employer: build('employer') };
  }

  async updatePreferences(userId: string, prefs: { pref_key: string; enabled?: boolean; in_app_enabled?: boolean; email_enabled?: boolean }[]) {
    const fields: Record<string, string[]> = {};
    prefs.forEach((p, i) => {
      const key = p.pref_key as NotificationPrefKey;
      const values = [p.enabled, p.in_app_enabled, p.email_enabled].filter((v) => v !== undefined);
      if (LOCKED_PREF_KEYS.has(key) && values.some((v) => v === false)) fields[`preferences.${i}.enabled`] = [LOCKED_PREFERENCE_MESSAGE];
      if (!values.length) fields[`preferences.${i}`] = ['Choose on or off.'];
    });
    if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', LOCKED_PREFERENCE_MESSAGE, fields);
    const current = await this.preferences(userId);
    const all = [...current.worker, ...current.employer];
    const updated: Omit<NotificationPreferenceRow, 'label' | 'helper'>[] = [];
    await this.prisma.db.$transaction(async (tx) => {
      for (const p of prefs) {
        const key = p.pref_key as NotificationPrefKey;
        const cur = all.find((r) => r.pref_key === key);
        const inApp = p.enabled ?? p.in_app_enabled ?? cur?.in_app_enabled ?? true;
        const email = p.enabled ?? p.email_enabled ?? cur?.email_enabled ?? true;
        const locked = LOCKED_PREF_KEYS.has(key);
        await tx.notificationPreference.upsert({
          where: { userId_prefKey: { userId, prefKey: key } },
          create: { userId, prefKey: key, inAppEnabled: inApp, emailEnabled: email, isLocked: locked },
          update: { inAppEnabled: inApp, emailEnabled: email, isLocked: locked, updatedAt: new Date() },
        });
        updated.push({ pref_key: key, in_app_enabled: inApp, email_enabled: email, is_locked: locked });
      }
    });
    return { updated };
  }

  /** Categories in display order (for clients). */
  static categories() {
    return CATEGORIES;
  }
}
