'use client';
/**
 * SCR-WRK-09 Notifications (Figma 31:2483): tabs with counts, date-grouped list with unread state,
 * mark one / all as read, Load more (20 per page), and the preference switches (payout locked on).
 */
import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferences, NotificationRow, NotificationsMeta } from '@24f/shared';
import { NOTIFICATION_TABS, formatRelative, notificationGroup, type NotificationTab } from '@24f/shared';
import { Button, EmptyState, Icon, LinkButton, LoadMore, Skeleton, Switch, TabPanel, Tabs, cn, useStaggerIn, useToast } from '@24f/ui';
import { api, apiFetch, ApiError } from '@/lib/api/client';
import { useNotificationPrefs, wk } from '../data';
import { LoadError, MobileTitle, Panel } from '../ui';

const TAB_LABEL: Record<NotificationTab, string> = { all: 'All', tasks: 'Tasks', payments: 'Payments', referrals: 'Referrals', system: 'System' };
const GROUP_LABEL: Record<string, string> = { TODAY: 'Today', YESTERDAY: 'Yesterday', 'EARLIER THIS WEEK': 'Earlier this week', OLDER: 'Earlier' };

type Page = { data: NotificationRow[]; meta: NotificationsMeta };

export function NotificationsPage() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const tab = ((NOTIFICATION_TABS as readonly string[]).includes(sp.get('tab') ?? '') ? sp.get('tab') : 'all') as NotificationTab;

  const q = useInfiniteQuery<Page, ApiError>({
    queryKey: wk.notifications(tab),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const r = await apiFetch<NotificationRow[], NotificationsMeta>('/notifications', { query: { audience: 'worker', category: tab, cursor: pageParam as string | null, per_page: 20 } });
      return { data: r.data, meta: r.meta as NotificationsMeta };
    },
    getNextPageParam: (last) => (last.meta.has_more ? last.meta.next_cursor : undefined),
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const meta = q.data?.pages[0]?.meta;
  const unread = meta?.unread ?? 0;
  const listRef = useStaggerIn<HTMLDivElement>([tab, q.data?.pages.length ?? 0]);

  /** Optimistically mark rows read; `all` also zeroes the unread count. */
  const patchRows = (match: (r: NotificationRow) => boolean, all = false) =>
    qc.setQueriesData<{ pages: Page[]; pageParams: unknown[] }>({ queryKey: ['notifications', 'worker'] }, (old) => {
      if (!old) return old;
      const at = new Date().toISOString();
      const changed = old.pages.reduce((n, p) => n + p.data.filter((r) => !r.read_at && match(r)).length, 0);
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          data: p.data.map((r) => (!r.read_at && match(r) ? { ...r, read_at: at } : r)),
          meta: { ...p.meta, unread: all ? 0 : Math.max(0, p.meta.unread - changed) },
        })),
      };
    });

  const readAll = useMutation<unknown, ApiError>({
    mutationFn: () => api.post('/notifications/read-all', { audience: 'worker', ...(tab !== 'all' ? { category: tab } : {}) }),
    onMutate: () => void patchRows(() => true, tab === 'all'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: wk.overview });
    },
    onError: () => toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' }),
  });

  const open = async (n: NotificationRow) => {
    if (!n.read_at) {
      patchRows((r) => r.id === n.id);
      api
        .post(`/notifications/${n.id}/read`)
        .then(() => {
          void qc.invalidateQueries({ queryKey: wk.unread });
          void qc.invalidateQueries({ queryKey: ['notifications', 'worker'] });
        })
        .catch(() => undefined);
    }
    if (n.link_path) router.push(n.link_path);
  };

  const groups = useMemo(() => {
    const out: { key: string; items: NotificationRow[] }[] = [];
    for (const r of rows) {
      const g = notificationGroup(r.created_at);
      const last = out[out.length - 1];
      if (last && last.key === g) last.items.push(r);
      else out.push({ key: g, items: [r] });
    }
    return out;
  }, [rows]);

  return (
    <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <MobileTitle title="Notifications" />
        <div className="flex items-end justify-between gap-4">
          <Tabs<NotificationTab>
            label="Notification categories"
            panelId="ntf-panel"
            value={tab}
            hrefFor={(v) => (v === 'all' ? pathname : `${pathname}?tab=${v}`)}
            tabs={NOTIFICATION_TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: meta?.counts[t] }))}
            className="min-w-0 flex-1 max-tablet:-mx-5 max-tablet:px-5"
          />
          {unread > 0 ? (
            <LinkButton onClick={() => readAll.mutate()} disabled={readAll.isPending} className="mb-3 shrink-0 font-semibold max-tablet:hidden">
              Mark all as read
            </LinkButton>
          ) : null}
        </div>
        {unread > 0 ? (
          <LinkButton onClick={() => readAll.mutate()} disabled={readAll.isPending} className="mt-3 font-semibold tablet:hidden">
            Mark all as read
          </LinkButton>
        ) : null}

        <TabPanel id="ntf-panel" className="mt-5">
          {q.isError && !q.data ? (
            <LoadError error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <div className="overflow-hidden rounded-card border border-line bg-surface" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton.NotificationItem key={i} />
              ))}
            </div>
          ) : rows.length ? (
            <>
              <div ref={listRef} className="overflow-hidden rounded-card border border-line bg-surface shadow-xs">
                {groups.map((g) => (
                  <section key={g.key} aria-label={GROUP_LABEL[g.key]}>
                    <h3 className="border-b border-line-subtle bg-subtle px-5 py-2.5 text-overline uppercase text-fg-tertiary">{GROUP_LABEL[g.key]}</h3>
                    <ul className="divide-y divide-line-subtle">
                      {g.items.map((n) => (
                        <li key={n.id} className="border-b border-line-subtle last:border-b-0">
                          <Item n={n} onOpen={() => void open(n)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="mt-4">
                <LoadMore label="Load more" loading={q.isFetchingNextPage} hasMore={!!q.hasNextPage} onClick={() => void q.fetchNextPage()} />
              </div>
            </>
          ) : (
            <div className="rounded-card border border-line bg-surface">
              <EmptyState icon="bell" title="You’re all caught up" body="New updates on tasks and payouts will show up here." />
            </div>
          )}
        </TabPanel>
      </div>

      <aside className="min-w-0">
        <Preferences />
      </aside>
    </div>
  );
}

function Item({ n, onOpen }: { n: NotificationRow; onOpen: () => void }) {
  const unread = !n.read_at;
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-label-md text-fg', unread && 'font-semibold')}>{n.title}</span>
        <span className="mt-0.5 block text-body-sm text-fg-secondary">{n.body}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-3">
        <time dateTime={n.created_at} className="text-body-xs text-fg-tertiary">
          {formatRelative(n.created_at, Date.now(), { dayStyle: 'weekday' })}
        </time>
        {unread ? (
          <span className="size-2 rounded-full bg-brand" aria-hidden>
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </span>
    </>
  );
  const cls = cn(
    'flex w-full items-start gap-4 px-5 py-4 text-left transition-colors focus-visible:shadow-[inset_var(--fl-shadow-focus)] focus-visible:outline-none',
    unread ? 'bg-brand-subtle hover:bg-brand-muted' : 'bg-surface hover:bg-subtle',
  );
  return (
    <button type="button" onClick={onOpen} className={cls} aria-label={`${unread ? 'Unread: ' : ''}${n.title}. ${n.body}`}>
      {inner}
    </button>
  );
}

function Preferences() {
  const p = useNotificationPrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation<unknown, ApiError, { key: string; on: boolean }, { prev?: NotificationPreferences }>({
    mutationFn: ({ key, on }) => api.put('/notifications/preferences', { preferences: [{ pref_key: key, enabled: on }] }),
    onMutate: async ({ key, on }) => {
      await qc.cancelQueries({ queryKey: wk.prefs });
      const prev = qc.getQueryData<NotificationPreferences>(wk.prefs);
      qc.setQueryData<NotificationPreferences>(wk.prefs, (old) =>
        old ? { ...old, worker: old.worker.map((r) => (r.pref_key === key ? { ...r, in_app_enabled: on, email_enabled: on } : r)) } : old,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(wk.prefs, ctx.prev);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: e.fields && Object.values(e.fields)[0]?.[0] ? Object.values(e.fields)[0]![0] : 'Your changes are still here. Try again.' });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: wk.prefs }),
  });

  return (
    <Panel aria-labelledby="pref-h" className="p-5">
      <h2 id="pref-h" className="flex items-center gap-2 text-label-lg text-fg">
        <Icon name="filter" size={20} />
        What you get notified about
      </h2>
      {p.isError && !p.data ? (
        <div className="mt-4">
          <p className="text-body-sm text-fg-secondary">We couldn’t load this.</p>
          <Button size="S" variant="secondary" className="mt-2" onClick={() => p.refetch()}>
            Try again
          </Button>
        </div>
      ) : !p.data ? (
        <div className="mt-4 space-y-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width="100%" height={20} />
          ))}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-line-subtle">
          {p.data.worker.map((r) => (
            <li key={r.pref_key} className="py-2.5">
              <Switch
                label={r.label}
                checked={r.in_app_enabled || r.email_enabled}
                locked={r.is_locked}
                lockedReason="Payout and security alerts can’t be turned off."
                onCheckedChange={(on) => m.mutate({ key: r.pref_key, on })}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-body-xs text-fg-tertiary">Delivered in-app and by email. Payout and security alerts can’t be turned off.</p>
      <Button size="S" variant="secondary" href="/worker/settings#notifications" className="mt-3">
        All settings
      </Button>
    </Panel>
  );
}

