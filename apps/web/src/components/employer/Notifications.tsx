'use client';
import NextLink from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Icon, Skeleton, Switch, TabPanel, Tabs, cn, toast, useStaggerIn, type IconName } from '@24f/ui';
import { formatRelative, notificationGroup } from '@24f/shared';
import { api, apiFetch, errorText, ek, useQueryClient, type Notification } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';

type Tab = 'all' | 'tasks' | 'payments' | 'system';
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tasks', label: 'Submissions' },
  { value: 'payments', label: 'Payments' },
  { value: 'system', label: 'System' },
];
const ICON: Record<string, IconName> = { tasks: 'inbox', payments: 'wallet', referrals: 'gift', system: 'info' };
const TILE: Record<string, string> = {
  tasks: 'bg-warning-subtle text-fg-warning',
  payments: 'bg-success-subtle text-fg-success',
  referrals: 'bg-accent-subtle text-fg-accent',
  system: 'bg-info-subtle text-fg-info',
};
interface Meta {
  next_cursor: string | null;
  counts: Record<'all' | 'tasks' | 'payments' | 'referrals' | 'system', number>;
  unread: number;
}
interface Pref {
  pref_key: string;
  label: string;
  helper?: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  is_locked: boolean;
}

/** SCR-EMP-ND1 Employer notifications (same layout as SCR-WRK-09; tabs per A-33; prefs from 44:1223). */
export function EmployerNotifications() {
  useEmployerHeader({ title: 'Notifications', subtitle: 'Updates on submissions, payments and your account.' });
  const sp = useSearchParams();
  const qc = useQueryClient();
  const tab = (TABS.map((t) => t.value) as string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'all';
  const list = useInfiniteQuery({
    queryKey: ek.notifications(tab),
    queryFn: ({ pageParam }) => apiFetch<Notification[], Meta>('/notifications', { query: { audience: 'employer', category: tab, cursor: pageParam || undefined, per_page: 20 } }),
    initialPageParam: '' as string,
    getNextPageParam: (l) => l.meta?.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const meta = list.data?.pages[0]?.meta;
  const stagger = useStaggerIn<HTMLDivElement>([tab, rows.length], { selector: '[data-n]' });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['employer', 'notifications'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}), onSuccess: refresh });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all', { audience: 'employer', ...(tab !== 'all' ? { category: tab } : {}) }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: 'All caught up' });
      void refresh();
    },
    onError: (e) => toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) }),
  });

  const groups: [string, Notification[]][] = [];
  for (const n of rows) {
    const g = notificationGroup(n.created_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(n);
    else groups.push([g, [n]]);
  }

  return (
    <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,1fr)_352px] [&>*]:min-w-0">
      <div>
        <div className="flex items-end justify-between gap-3">
          <Tabs
            label="Notification type"
            panelId="ntf-panel"
            value={tab}
            tabs={TABS.map((t) => ({ ...t, count: t.value === 'all' ? meta?.counts.all : meta?.counts[t.value] }))}
            hrefFor={(t) => (t === 'all' ? '/employer/notifications' : `/employer/notifications?tab=${t}`)}
            className="min-w-0 flex-1"
          />
          {meta && meta.unread > 0 ? (
            <Button variant="tertiary" size="S" leadingIcon="check" loading={readAll.isPending} onClick={() => readAll.mutate()} className="mb-1 shrink-0">
              Mark all read
            </Button>
          ) : null}
        </div>
        <TabPanel id="ntf-panel" className="mt-6">
          {list.isError ? (
            <ErrorPanel onRetry={() => list.refetch()} />
          ) : !list.data ? (
            <div className="space-y-3 rounded-card border border-line bg-surface p-4" aria-busy="true" aria-label="Loading notifications">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton.NotificationItem key={i} />
              ))}
            </div>
          ) : !rows.length ? (
            <div className="rounded-card border border-line bg-surface">
              <EmptyState icon="bell" title="No notifications yet" body="We’ll let you know when workers submit, and when payments land." />
            </div>
          ) : (
            <div ref={stagger} className="space-y-6">
              {groups.map(([g, items]) => (
                <section key={g} aria-label={g}>
                  <h2 className="mb-2 text-overline uppercase text-fg-tertiary">{g}</h2>
                  <ul className="divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs">
                    {items.map((n) => (
                      <li key={n.id} data-n className={cn('relative flex gap-3 px-4 py-4 tablet:px-5', !n.read_at && 'bg-brand-subtle/40')}>
                        <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-[12px]', TILE[n.category])}>
                          <Icon name={ICON[n.category] ?? 'bell'} size={20} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-start justify-between gap-3">
                            <span className={cn('text-label-md text-fg', !n.read_at && 'font-semibold')}>
                              {n.link_path ? (
                                <NextLink
                                  href={n.link_path}
                                  onClick={() => !n.read_at && readOne.mutate(n.id)}
                                  className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:shadow-focus"
                                >
                                  {n.title}
                                </NextLink>
                              ) : (
                                n.title
                              )}
                            </span>
                            <span className="shrink-0 text-body-xs text-fg-tertiary">{formatRelative(n.created_at)}</span>
                          </p>
                          <p className="mt-0.5 text-body-sm text-fg-secondary">{n.body}</p>
                        </div>
                        {!n.read_at ? (
                          <span className="relative z-[1] mt-1.5 flex items-start">
                            <button type="button" onClick={() => readOne.mutate(n.id)} aria-label={`Mark “${n.title}” as read`} className="grid size-6 place-items-center rounded-full focus-visible:shadow-focus focus-visible:outline-none">
                              <span aria-hidden className="size-2 rounded-full bg-brand" />
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {list.hasNextPage ? (
                <div className="text-center">
                  <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </TabPanel>
      </div>
      <Preferences />
    </div>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<{ employer: Pref[] }>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (p: { pref_key: string; enabled: boolean }) => api.put('/notifications/preferences', { preferences: [{ pref_key: p.pref_key, in_app_enabled: p.enabled, email_enabled: p.enabled }] }),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['notification-prefs'] });
      const prev = qc.getQueryData<{ employer: Pref[] }>(['notification-prefs']);
      if (prev) qc.setQueryData(['notification-prefs'], { ...prev, employer: prev.employer.map((x) => (x.pref_key === p.pref_key ? { ...x, in_app_enabled: p.enabled, email_enabled: p.enabled } : x)) });
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notification-prefs'], ctx.prev);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) });
    },
    onSuccess: () => toast.show({ tone: 'success', title: 'Preferences saved.' }),
  });
  return (
    <section aria-labelledby="np-h" className="h-fit rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6 desktop:sticky desktop:top-24">
      <h2 id="np-h" className="text-h5 text-fg">
        Notify me about
      </h2>
      <p className="mt-0.5 text-body-sm text-fg-secondary">In the app and by email.</p>
      <div className="mt-2">
        {prefs.isLoading ? (
          <Skeleton height={200} radius={12} className="mt-3" />
        ) : prefs.isError ? (
          <p className="mt-3 text-body-sm text-fg-secondary">We couldn’t load your preferences.</p>
        ) : (
          prefs.data?.employer.map((p) => (
            <Switch
              key={p.pref_key}
              label={p.label}
              description={p.helper}
              checked={p.in_app_enabled || p.email_enabled}
              locked={p.is_locked}
              lockedReason="Payout and security alerts can’t be turned off."
              onCheckedChange={(v) => save.mutate({ pref_key: p.pref_key, enabled: v })}
              className="border-b border-line-subtle py-4 last:border-b-0"
            />
          ))
        )}
      </div>
    </section>
  );
}
