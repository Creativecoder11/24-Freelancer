'use client';
/** SCR-REF-02 Invited friends (Figma 43:737) with the friend panel (43:954). */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDate, formatMoney, formatRelative } from '@24f/shared';
import { Button, Drawer, EmptyState, Pagination, Skeleton, StatusBadge, Tabs, cn, useStaggerIn } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { BarChart } from '@/components/wallet/parts';
import { useFriend, useFriends, useReferralSummary, type Friend } from './api';
import { FriendAvatar, RemindButton } from './shared';
import { copyInvite } from './ReferralPage';

const HEADER = { title: 'Invited friends', subtitle: 'Everyone who joined with your link. Names are partly hidden for privacy.', backHref: '/worker/referral' };
type Tab = 'all' | 'active' | 'not_started';

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1280px)');
    const f = () => setD(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return d;
}

export function FriendsPage() {
  useWorkerHeader(HEADER);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (['all', 'active', 'not_started'].includes(params.get('tab') ?? '') ? params.get('tab') : 'all') as Tab;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useFriends(new URLSearchParams({ tab, page: String(page), per_page: '10' }));
  const rows = list.data?.data ?? [];
  const desktop = useIsDesktop();
  const friendParam = params.get('friend');
  const selected = friendParam ?? (desktop ? (rows[0]?.id ?? null) : null);
  const listRef = useStaggerIn<HTMLTableSectionElement>([tab, page, rows.length]);

  const set = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(p)) (v === null ? next.delete(k) : next.set(k, v));
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const counts = list.data?.meta.counts;

  return (
    <div className="mx-auto grid w-full max-w-[1104px] gap-6 desktop:grid-cols-[minmax(0,720px)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Tabs
          label="Friends"
          panelId="friends-panel"
          value={tab}
          onChange={(v) => set({ tab: v === 'all' ? null : v, page: null, friend: null })}
          tabs={[
            { value: 'all', label: 'All', count: counts?.all },
            { value: 'active', label: 'Active', count: counts?.active },
            { value: 'not_started', label: 'Not started', count: counts?.not_started },
          ]}
        />
        <div id="friends-panel" role="tabpanel">
          {list.isError ? (
            <LoadError error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            <div className="rounded-card border border-line bg-surface p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton.TableRow key={i} columns={6} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-card border border-line bg-surface">
              {counts?.all ? (
                <EmptyState compact icon="users" title="No friends in this list." />
              ) : (
                <EmptyState icon="users" title="No friends yet" body="Share your link. You earn 5% when they complete tasks or make deposits." action={<CopyLinkButton />} />
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-xs">
              <table className="hidden w-full table-fixed text-left tablet:table">
                <caption className="sr-only">Invited friends</caption>
                <colgroup>
                  <col className="w-[27%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line-subtle bg-subtle">
                    {['Friend', 'Joined', 'Tasks', 'Deposits', 'You earned', 'Status'].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-4 py-4 text-overline uppercase text-fg-tertiary first:pl-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={listRef} className="divide-y divide-line-subtle">
                  {rows.map((f) => (
                    <tr
                      key={f.id}
                      tabIndex={0}
                      aria-selected={f.id === selected}
                      onClick={() => set({ friend: f.id })}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set({ friend: f.id }))}
                      className={cn('h-[72px] cursor-pointer text-body-md text-fg outline-none transition-colors hover:bg-subtle focus-visible:bg-brand-subtle', f.id === selected && 'bg-brand-subtle hover:bg-brand-subtle')}
                    >
                      <td className="px-4 pl-5">
                        <span className="flex items-center gap-3">
                          <FriendAvatar f={f} />
                          <span className="truncate text-label-md">{f.name_masked}</span>
                        </span>
                      </td>
                      <td className="px-4 text-fg-secondary">{formatDate(f.joined_at)}</td>
                      <td className="px-4 tabular-nums">{f.tasks}</td>
                      <td className="px-4 tabular-nums">{f.deposits_usd ? formatMoney(f.deposits_usd) : '—'}</td>
                      <td className="px-4 text-label-md tabular-nums text-fg-success">{f.earned_usd ? formatMoney(f.earned_usd) : <span className="text-fg-secondary">—</span>}</td>
                      <td className="px-4">
                        <StatusBadge enum="referral_status" code={f.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-line-subtle tablet:hidden">
                {rows.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => set({ friend: f.id })} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                      <FriendAvatar f={f} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-label-md text-fg">{f.name_masked}</span>
                        <span className="block text-body-xs text-fg-tertiary">
                          Joined {formatDate(f.joined_at)} · {f.tasks} {f.tasks === 1 ? 'task' : 'tasks'}
                          {f.deposits_usd ? ` · ${formatMoney(f.deposits_usd)} deposit` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-label-md tabular-nums text-fg-success">{f.earned_usd ? formatMoney(f.earned_usd) : '—'}</span>
                        <StatusBadge enum="referral_status" code={f.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="text-body-sm text-fg-secondary">Commission: 5% of approved task rewards and 5% of deposits.</p>
        {list.data && list.data.meta.total_pages > 1 ? (
          <Pagination page={page} totalPages={list.data.meta.total_pages} total={list.data.meta.total} perPage={10} itemLabel="friends" hrefFor={(p) => `${pathname}?${new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), page: String(p) })}`} />
        ) : null}
      </div>
      {desktop ? (
        <aside aria-label="Friend details" className="h-fit rounded-card border border-line bg-surface p-6 shadow-xs desktop:sticky desktop:top-[100px]">
          {selected ? <FriendPanel id={selected} row={rows.find((r) => r.id === selected)} /> : <EmptyState compact icon="users" title="Select a friend" />}
        </aside>
      ) : (
        <Drawer open={!!friendParam} onOpenChange={(o) => !o && set({ friend: null })} title="Friend" width={360}>
          {friendParam ? <FriendPanel id={friendParam} row={rows.find((r) => r.id === friendParam)} /> : null}
        </Drawer>
      )}
    </div>
  );
}

function CopyLinkButton() {
  const s = useReferralSummary();
  return (
    <Button size="M" disabled={!s.data} onClick={() => s.data && copyInvite(s.data.link)}>
      Copy link
    </Button>
  );
}

function FriendPanel({ id, row }: { id: string; row?: Friend }) {
  const q = useFriend(id);
  const d = q.data;
  if (q.isError) return <p className="text-body-sm text-fg-tertiary">We couldn’t load this friend.</p>;
  if (!d) {
    return (
      <div aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton width={56} height={56} radius={28} />
          <Skeleton width={140} height={20} />
        </div>
        <Skeleton height={92} className="mt-6" radius={14} />
        <Skeleton height={140} className="mt-6" />
      </div>
    );
  }
  const activity = d.last_activity_at ? `active ${formatRelative(d.last_activity_at).replace(/^just now$/, 'today')}` : d.status === 'not_started' ? 'not started yet' : null;
  return (
    <div>
      <div className="flex items-center gap-4">
        <FriendAvatar f={d} size="XL" />
        <div className="min-w-0">
          <p className="text-label-lg text-fg">{d.name_masked}</p>
          <p className="text-body-sm text-fg-secondary">
            Joined {formatDate(d.joined_at)}
            {activity ? ` · ${activity}` : ''}
          </p>
        </div>
      </div>
      {d.status === 'not_started' ? (
        <div className="mt-6 rounded-[14px] bg-subtle p-4">
          <p className="text-body-md text-fg-secondary">They haven’t started yet. A reminder can help.</p>
          <div className="mt-3">
            <RemindButton f={row ?? d} size="M" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-[14px] bg-success-subtle p-4">
            <p className="text-body-sm text-fg-secondary">You’ve earned from {d.name_masked}</p>
            <p className="mt-1 font-display text-num-xl text-fg-success tabular-nums">{formatMoney(d.earned_usd)}</p>
          </div>
          <h3 className="mt-6 text-label-md text-fg">Monthly earnings</h3>
          <div className="mx-auto mt-3 max-w-[280px]">
            <BarChart
              label={`Monthly earnings from ${d.name_masked}`}
              height={130}
              showValues
              barWidth={40}
              bars={d.monthly_earnings.map((m) => ({ key: m.month, label: m.label, axis: m.label, value: Number(m.amount_usd), highlight: m.is_current, tooltip: `${m.label} · ${formatMoney(m.amount_usd)}` }))}
            />
          </div>
          <h3 className="mt-6 text-label-md text-fg">Recent commission</h3>
          {d.recent_commission.length ? (
            <ul className="mt-2 divide-y divide-line-subtle">
              {d.recent_commission.map((c) => (
                <li key={c.date + c.source_type} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block text-body-md text-fg">{c.label}</span>
                    <span className="block text-body-xs text-fg-tertiary">{formatDate(`${c.date}T06:00:00Z`)}</span>
                  </span>
                  <span className="text-label-md tabular-nums text-fg-success">+{formatMoney(c.amount_usd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-body-sm text-fg-tertiary">No commission yet.</p>
          )}
        </>
      )}
    </div>
  );
}
