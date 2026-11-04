'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Portal,
  Select,
  Skeleton,
  StatusBadge,
  StickyActionBar,
  TabPanel,
  Tabs,
  cn,
  gsap,
  prefersReducedMotion,
  toast,
  useMediaQuery,
  useEscape,
  useFocusTrap,
  useScrollLock,
  useStaggerIn,
} from '@24f/ui';
import { formatDateTime, formatMoney, formatRelative, formatReward } from '@24f/shared';
import { api, apiFetch, ApiError, ek, errorText, idemKey, invalidateEmployer, useQueryClient, type ProofItem, type SubDetail, type SubListMeta, type SubRow } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel } from './common';
import { RejectDialog, type RejectTarget } from './RejectDialog';

type Tab = 'to_review' | 'approved' | 'rejected';
const TABS: { value: Tab; label: string }[] = [
  { value: 'to_review', label: 'To review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const hoursUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000));
const short = (t: string, n = 32) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** SCR-EMP-09 Review submissions (Figma 40:1798, mobile 48:1336) + SCR-EMP-10 reject modal. */
export function Review() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const twoPane = useMediaQuery('(min-width: 1024px)', true);
  const job = sp.get('job') ?? '';
  const tab: Tab = (['to_review', 'approved', 'rejected'] as const).includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'to_review';
  const subParam = sp.get('sub');

  const list = useInfiniteQuery({
    queryKey: ek.subs(job, tab),
    queryFn: ({ pageParam }) => apiFetch<SubRow[], SubListMeta>('/employer/submissions', { query: { job: job || undefined, tab, cursor: pageParam || undefined, per_page: 20 } }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.meta?.next_cursor ?? undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const meta = list.data?.pages[0]?.meta;
  const selected = subParam && rows.some((r) => r.ref === subParam) ? subParam : (subParam ?? rows[0]?.ref ?? null);

  const header = meta?.header;
  const autoH = header?.auto_approve_at ? hoursUntil(header.auto_approve_at) : null;
  useEmployerHeader({
    title: 'Review submissions',
    subtitle: header
      ? header.job_title
        ? `${short(header.job_title)} · ${header.waiting} waiting${autoH !== null && header.waiting ? ` · auto-approve in ${autoH} h` : ''}`
        : `${header.waiting} waiting across ${header.jobs_waiting} ${header.jobs_waiting === 1 ? 'job' : 'jobs'}.`
      : undefined,
    hideTabBar: !twoPane && tab === 'to_review' && rows.length > 0,
  });

  const href = (p: Partial<{ job: string; tab: Tab; sub: string | null }>) => {
    const u = new URLSearchParams();
    const j = p.job ?? job;
    const t = p.tab ?? tab;
    const s = p.sub === undefined ? selected : p.sub;
    if (j) u.set('job', j);
    if (t !== 'to_review') u.set('tab', t);
    if (s) u.set('sub', s);
    return `/employer/submissions${u.size ? `?${u}` : ''}`;
  };
  const select = (ref: string | null) => router.replace(href({ sub: ref }), { scroll: false });

  // ------------------------------------------------------------ bulk selection
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => setChecked(new Set()), [job, tab]);
  const checkedRows = rows.filter((r) => checked.has(r.ref));
  const bulkTotal = checkedRows.reduce((s, r) => s + Number(r.unit_cost_usd), 0);
  const [bulkOpen, setBulkOpen] = useState(false);

  const refresh = () => invalidateEmployer(qc);

  const nextAfter = (ref: string, serverNext?: string | null) => {
    const i = rows.findIndex((r) => r.ref === ref);
    return rows[i + 1]?.ref ?? rows[i - 1]?.ref ?? serverNext ?? null;
  };

  const approve = useMutation({
    mutationFn: (ref: string) =>
      api.post<{ next_ref: string | null; paid_usd: string }>(`/employer/submissions/${ref}/approve`, {}, { headers: { 'Idempotency-Key': idemKey() }, query: { job: job || undefined } }),
    onSuccess: (r, ref) => {
      toast.show({ tone: 'success', title: `Approved · ${formatReward(r.paid_usd)}`, body: 'The reward moved to the worker.' });
      setChecked((c) => {
        const n = new Set(c);
        n.delete(ref);
        return n;
      });
      select(nextAfter(ref, r.next_ref));
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALREADY_DECIDED') toast.show({ tone: 'warning', title: 'This submission was already decided. We’ve refreshed the list.' });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) });
      void refresh();
    },
  });

  const bulk = useMutation({
    mutationFn: (refs: string[]) =>
      api.post<{ approved_count: number; skipped_count: number; failed_count: number; total_paid_usd: string }>('/employer/submissions/bulk-approve', { refs }, { headers: { 'Idempotency-Key': idemKey() } }),
    onSuccess: (r) => {
      setBulkOpen(false);
      setChecked(new Set());
      const bad = r.skipped_count + r.failed_count;
      if (bad > 0)
        toast.show({ tone: 'warning', title: `${r.approved_count} approved, ${bad} couldn’t be`, body: 'They were already decided. We’ve refreshed the list.' });
      else toast.show({ tone: 'success', title: `Approved ${r.approved_count} · ${formatMoney(r.total_paid_usd)}`, body: 'The rewards moved to the workers.' });
      select(null);
      void refresh();
    },
    onError: (e) => {
      setBulkOpen(false);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e) });
      void refresh();
    },
  });

  // ------------------------------------------------------------ detail + reject
  const detail = useQuery({
    queryKey: ek.sub(selected ?? ''),
    queryFn: () => api.get<SubDetail>(`/employer/submissions/${selected}`, { query: { job: job || undefined, tab } }),
    enabled: !!selected,
  });
  const d = detail.data && detail.data.ref === selected ? detail.data : null;
  const [reject, setReject] = useState<RejectTarget | null>(null);
  const [viewer, setViewer] = useState<ProofItem['file'] | null>(null);
  const openReject = (x: SubDetail | null = d) => {
    if (!x || x.status !== 'in_review') return;
    setReject({ ref: x.ref, workerName: x.worker.name_masked, reward: x.unit_cost_usd, jobPublicId: job || undefined, canFix: x.can_allow_fix, fixDefault: x.fix_default });
  };

  // Keyboard: A approve · R reject · J next · K previous (not in fields or dialogs).
  const keyState = useRef({ d, rows, selected, busy: approve.isPending, openReject, select, approve: (ref: string) => approve.mutate(ref) });
  keyState.current = { d, rows, selected, busy: approve.isPending, openReject, select, approve: (ref: string) => approve.mutate(ref) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const s = keyState.current;
      const k = e.key.toLowerCase();
      const i = s.rows.findIndex((r) => r.ref === s.selected);
      if (k === 'j' && i < s.rows.length - 1) (e.preventDefault(), s.select(s.rows[i + 1]!.ref));
      else if (k === 'k' && i > 0) (e.preventDefault(), s.select(s.rows[i - 1]!.ref));
      else if (k === 'a' && s.d?.status === 'in_review' && !s.busy) (e.preventDefault(), s.approve(s.d.ref));
      else if (k === 'r' && s.d?.status === 'in_review') (e.preventDefault(), s.openReject(s.d));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, tab]);

  const listRef = useStaggerIn<HTMLUListElement>([job, tab, list.data?.pages.length], { selector: '[data-row]' });
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!d || !detailRef.current || prefersReducedMotion()) return;
    gsap.fromTo(detailRef.current, { autoAlpha: 0, x: 8 }, { autoAlpha: 1, x: 0, duration: 0.28, ease: 'power2.out', clearProps: 'all' });
  }, [d?.ref]);

  // Load more on scroll (20 per page).
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.hasNextPage) return;
    const io = new IntersectionObserver((en) => en[0]?.isIntersecting && !list.isFetchingNextPage && void list.fetchNextPage(), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list, rows.length]);

  const jobOptions = [
    { value: '', label: `All jobs (${meta?.job_options.reduce((n, j) => n + j.waiting, 0) ?? 0} waiting)` },
    ...(meta?.job_options ?? []).map((j) => ({ value: j.public_id, label: `${short(j.title, 44)} (${j.waiting} waiting)` })),
  ];
  const noJobs = meta && meta.job_options.length === 0;
  const pos = d?.pager.position ?? null;

  const detailPane = !selected ? null : detail.isError ? (
    <ErrorPanel onRetry={() => detail.refetch()} className="rounded-card border border-line bg-surface" />
  ) : !d ? (
    <div className="rounded-card border border-line bg-surface p-6" aria-busy="true" aria-label="Loading submission">
      <div className="flex items-center gap-4">
        <Skeleton width={56} height={56} radius={28} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} width="30%" />
          <Skeleton height={14} width="60%" />
        </div>
      </div>
      <Skeleton height={48} radius={12} className="mt-6" />
      <Skeleton height={260} radius={12} className="mt-6" />
    </div>
  ) : (
    <Detail
      d={d}
      refEl={detailRef}
      onPrev={() => d.pager.prev_ref && select(d.pager.prev_ref)}
      onNext={() => d.pager.next_ref && select(d.pager.next_ref)}
      onApprove={() => approve.mutate(d.ref)}
      approving={approve.isPending && approve.variables === d.ref}
      onReject={() => openReject()}
      onView={setViewer}
      twoPane={twoPane}
    />
  );

  return (
    <div className={cn(!twoPane && tab === 'to_review' && rows.length > 0 && 'pb-28')}>
      {/* Mobile header (48:1336) */}
      {!twoPane && header ? (
        <div className="mb-4 tablet:hidden">
          <p className="text-h5 text-fg">{header.job_title ?? 'All jobs'}</p>
          <p className="text-body-sm text-fg-secondary">
            {tab === 'to_review' && pos ? `${pos} of ${d?.pager.of ?? header.waiting} waiting` : `${header.waiting} waiting`}
            {autoH !== null && header.waiting ? ` · auto-approve in ${autoH} h` : ''}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 laptop:grid-cols-[minmax(0,400px)_minmax(0,1fr)] laptop:items-end laptop:gap-6">
        <div className={cn(!twoPane && 'max-tablet:hidden')}>
          <Select label="Job" options={jobOptions} value={job} onChange={(v) => router.replace(href({ job: v, sub: null }), { scroll: false })} searchable={jobOptions.length > 8} />
        </div>
        <Tabs label="Submission status" panelId="rev-panel" value={tab} tabs={TABS.map((t) => ({ ...t, count: meta?.counts[t.value] }))} hrefFor={(t) => href({ tab: t, sub: null })} />
      </div>

      <TabPanel id="rev-panel" className="mt-6">
        {list.isError ? (
          <ErrorPanel onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <div className="grid gap-6 laptop:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
            <Skeleton height={480} radius={16} />
            <Skeleton height={480} radius={16} className="max-laptop:hidden" />
          </div>
        ) : noJobs ? (
          <div className="rounded-card border border-line bg-surface">
            <EmptyState icon="inbox" title="Nothing to review yet" body="Submissions appear here once you publish a job." action={<Button href="/employer/jobs/new">Post a job</Button>} />
          </div>
        ) : !rows.length ? (
          <div className="rounded-card border border-line bg-surface">
            {tab === 'to_review' ? (
              <EmptyState icon="check-circle" title="All caught up" body="No submissions are waiting for your review." action={<Button variant="secondary" href="/employer/jobs">View my jobs</Button>} />
            ) : (
              <EmptyState compact icon="inbox" title={tab === 'approved' ? 'No approved submissions yet.' : 'No rejected submissions.'} />
            )}
          </div>
        ) : (
          <div className="grid gap-6 laptop:grid-cols-[minmax(0,400px)_minmax(0,1fr)] laptop:items-start">
            {/* Queue */}
            <section aria-label="Queue" className={cn('flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xs laptop:sticky laptop:top-24 laptop:max-h-[calc(100dvh-120px)]', !twoPane && 'hidden')}>
              {tab === 'to_review' ? (
                <div className="flex min-h-[64px] items-center gap-3 border-b border-line-subtle bg-brand-subtle px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-5 shrink-0 accent-[var(--fl-bg-brand)]"
                    checked={checkedRows.length > 0 && checkedRows.length === rows.length}
                    ref={(el) => {
                      if (el) el.indeterminate = checkedRows.length > 0 && checkedRows.length < rows.length;
                    }}
                    onChange={(e) => setChecked(e.target.checked ? new Set(rows.slice(0, 100).map((r) => r.ref)) : new Set())}
                  />
                  <span className="flex-1 text-body-sm text-fg">{checkedRows.length ? `${checkedRows.length} selected` : 'Select all'}</span>
                  {checkedRows.length ? (
                    <Button size="S" onClick={() => setBulkOpen(true)}>
                      Approve {checkedRows.length} · {formatMoney(bulkTotal.toFixed(6))}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-line-subtle overflow-y-auto" aria-label="Submissions">
                {rows.map((r) => (
                  <QueueRow key={r.ref} r={r} active={r.ref === selected} selectable={tab === 'to_review'} checked={checked.has(r.ref)} onCheck={(v) => setChecked((c) => {
                    const n = new Set(c);
                    if (v) n.add(r.ref);
                    else n.delete(r.ref);
                    return n;
                  })} onSelect={() => select(r.ref)} />
                ))}
                {list.hasNextPage ? (
                  <li ref={sentinel} className="p-4 text-center">
                    <Button variant="tertiary" size="S" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                      Load more
                    </Button>
                  </li>
                ) : null}
              </ul>
              {tab === 'to_review' ? <p className="border-t border-line-subtle px-4 py-4 text-body-xs text-fg-tertiary">Unreviewed submissions are approved automatically when the review window ends.</p> : null}
            </section>

            <div className="min-w-0">{detailPane}</div>
          </div>
        )}
      </TabPanel>

      {/* Mobile sticky actions */}
      {!twoPane && d && d.status === 'in_review' ? (
        <StickyActionBar className="laptop:hidden">
          <Button variant="secondary" size="L" onClick={() => openReject()} className="flex-1">
            Reject…
          </Button>
          <Button size="L" onClick={() => approve.mutate(d.ref)} loading={approve.isPending} className="flex-[1.6]">
            Approve · {formatReward(d.unit_cost_usd)}
          </Button>
        </StickyActionBar>
      ) : null}

      <RejectDialog
        target={reject}
        onOpenChange={(o) => !o && setReject(null)}
        onRejected={(ref, res) => {
          setReject(null);
          select(res.status === 'already_decided' ? ref : nextAfter(ref, res.next_ref));
          void refresh();
        }}
      />
      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Approve ${checkedRows.length} submissions?`}
        description={`${formatMoney(bulkTotal.toFixed(6))} moves from your budget to the workers. This can’t be undone.`}
        busy={bulk.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => !bulk.isPending && setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => bulk.mutate(checkedRows.map((r) => r.ref))} loading={bulk.isPending} loadingText="Approving…">
              Approve {checkedRows.length} · {formatMoney(bulkTotal.toFixed(6))}
            </Button>
          </>
        }
      />
      <ImageViewer file={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

function QueueRow({ r, active, selectable, checked, onCheck, onSelect }: { r: SubRow; active: boolean; selectable: boolean; checked: boolean; onCheck: (v: boolean) => void; onSelect: () => void }) {
  return (
    <li data-row className={cn('relative flex items-start gap-3 px-4 py-4 transition-colors', active ? 'bg-brand-subtle' : 'hover:bg-subtle')}>
      {active ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand" /> : null}
      {selectable ? (
        <input
          type="checkbox"
          aria-label={`Select submission from ${r.worker_name_masked}`}
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="relative z-[1] mt-3 size-5 shrink-0 accent-[var(--fl-bg-brand)]"
        />
      ) : null}
      <Avatar initials={r.worker_initials} size="M" tone="brand" />
      <button type="button" onClick={onSelect} aria-current={active ? 'true' : undefined} className="min-w-0 flex-1 text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:shadow-focus">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-label-md text-fg">
            {r.worker_name_masked}
            {r.attempt_no > 1 ? <span className="ml-2 text-label-sm font-medium text-fg-info">Attempt {r.attempt_no}</span> : null}
          </span>
          <span className="shrink-0 text-body-xs text-fg-tertiary">{formatRelative(r.decided_at ?? r.submitted_at)}</span>
        </span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-secondary">{r.preview ? `“${r.preview}”` : r.proof_label}</span>
        {r.sub_label || r.decision_source === 'auto' ? (
          <span className="mt-1 block text-body-xs text-fg-tertiary">{r.decision_source === 'auto' ? 'Auto-approved' : r.sub_label}</span>
        ) : null}
      </button>
    </li>
  );
}

function Detail({
  d,
  refEl,
  onPrev,
  onNext,
  onApprove,
  approving,
  onReject,
  onView,
  twoPane,
}: {
  d: SubDetail;
  refEl: React.RefObject<HTMLDivElement | null>;
  onPrev: () => void;
  onNext: () => void;
  onApprove: () => void;
  approving: boolean;
  onReject: () => void;
  onView: (f: ProofItem['file']) => void;
  twoPane: boolean;
}) {
  const [showPrev, setShowPrev] = useState(false);
  const att = d.attempt;
  const items = att?.proof_items ?? [];
  const decided = d.status !== 'in_review';
  return (
    <article ref={refEl} aria-label={`Submission from ${d.worker.name_masked}`} className="flex flex-col rounded-card border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-subtle p-4 tablet:flex-nowrap tablet:p-6">
        <Avatar initials={d.worker.initials} size={twoPane ? 'L' : 'M'} tone="brand" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-h5 text-fg">
            {d.worker.name_masked}
            {att && att.attempt_no > 1 ? <StatusBadge tone="info" label={`Attempt ${att.attempt_no}`} /> : null}
            {decided ? <StatusBadge enum="submission_status_employer" code={d.status} label={d.decision?.decision_source === 'auto' ? 'Auto-approved' : undefined} /> : null}
          </p>
          <p className="mt-0.5 text-body-sm text-fg-secondary">
            {d.worker.approval_rate_pct !== null ? `${d.worker.approval_rate_pct}% approval rate · ` : ''}
            {d.worker.tasks_done} tasks done · submitted {formatRelative(d.submitted_at)}
          </p>
          <p className="mt-0.5 truncate text-body-xs text-fg-tertiary">{d.job.title}</p>
        </div>
        {d.pager.of > 0 ? (
          <div className="flex shrink-0 items-center gap-2 max-tablet:w-full max-tablet:justify-end">
            <span className="text-body-sm tabular-nums text-fg-secondary">
              {d.pager.position ?? '–'} of {d.pager.of}
            </span>
            <IconButton icon="chevron-left" size="S" variant="secondary" aria-label="Previous submission (K)" disabled={!d.pager.prev_ref} onClick={onPrev} />
            <IconButton icon="chevron-right" size="S" variant="secondary" aria-label="Next submission (J)" disabled={!d.pager.next_ref} onClick={onNext} />
          </div>
        ) : null}
      </header>

      <div className="space-y-6 p-4 tablet:p-6">
        {att?.change_note ? (
          <section>
            <h3 className="text-label-md text-fg">What did you change?</h3>
            <p className="mt-1.5 rounded-[12px] bg-info-subtle px-4 py-3 text-body-md text-fg">“{att.change_note}”</p>
          </section>
        ) : null}
        {items.map((p, i) => (
          <ProofBlock key={`${p.proof_type}-${i}`} p={p} onView={onView} />
        ))}
        {att?.worker_note ? (
          <section>
            <h3 className="text-label-md text-fg">Note from worker</h3>
            <p className="mt-1.5 text-body-md text-fg-secondary">“{att.worker_note}”</p>
          </section>
        ) : null}
        {d.auto_check && d.auto_check.state !== 'pending' ? (
          <Alert tone={d.auto_check.state === 'passed' ? 'success' : 'warning'}>
            <span className="text-body-md text-fg">{d.auto_check.state === 'passed' ? d.auto_check.summary : d.auto_check.items.some((i) => i.check === 'link_opens' && i.result === 'warn') ? 'We couldn’t open this link. Check it before you decide.' : d.auto_check.summary}</span>
          </Alert>
        ) : null}
        {d.duplicate_suspected && !d.auto_check ? <Alert tone="warning">This image looks like another worker’s upload on this job.</Alert> : null}
        {d.previous_attempts.length ? (
          <section>
            <button type="button" onClick={() => setShowPrev((v) => !v)} aria-expanded={showPrev} className="inline-flex items-center gap-1.5 text-label-md text-fg-brand hover:underline">
              <Icon name={showPrev ? 'chevron-up' : 'chevron-down'} size={16} />
              View previous attempt
            </button>
            {showPrev
              ? d.previous_attempts.map((a) => (
                  <div key={a.attempt_no} className="mt-3 space-y-3 rounded-[12px] border border-line-subtle p-4">
                    <p className="text-label-md text-fg">
                      Attempt {a.attempt_no} · {formatDateTime(a.submitted_at)}
                    </p>
                    {a.reason_label ? (
                      <p className="text-body-sm text-fg-secondary">
                        <span className="font-semibold text-fg-danger">{a.reason_label}:</span> {a.reason_text}
                      </p>
                    ) : null}
                    {a.proof_items.map((p, i) => (
                      <ProofBlock key={i} p={p} onView={onView} />
                    ))}
                  </div>
                ))
              : null}
          </section>
        ) : null}
        {decided && d.decision ? (
          <section className="rounded-[12px] bg-subtle px-4 py-3 text-body-sm">
            <p className="text-label-md text-fg">
              {d.status === 'approved' ? (d.decision.decision_source === 'auto' ? 'Auto-approved' : 'Approved') : d.status === 'needs_fix' ? 'Fix requested' : 'Rejected · final'} · {formatDateTime(d.decision.decided_at)}
            </p>
            {d.decision.reason_label ? (
              <p className="mt-1 text-fg-secondary">
                <span className="font-semibold text-fg">{d.decision.reason_label}:</span> {d.decision.reason_text}
              </p>
            ) : null}
            {d.decision.resubmit_deadline ? <p className="mt-1 text-fg-tertiary">Can resubmit until {formatDateTime(d.decision.resubmit_deadline)}</p> : null}
            {d.dispute ? <p className="mt-1 text-fg-info">Dispute {d.dispute.ref} · {d.dispute.status.replace(/_/g, ' ')}</p> : null}
          </section>
        ) : null}
      </div>

      {!decided && twoPane ? (
        <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-line-subtle p-5 tablet:px-6">
          <p className="flex-1 text-body-sm text-fg-tertiary">
            <kbd className="font-sans">A</kbd> approve · <kbd className="font-sans">R</kbd> reject · <kbd className="font-sans">J</kbd> next
          </p>
          <Button variant="secondary" size="L" onClick={onReject} className="min-w-[140px]">
            Reject…
          </Button>
          <Button size="L" onClick={onApprove} loading={approving} loadingText="Approving…" className="min-w-[200px]">
            Approve · {formatReward(d.unit_cost_usd)}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

function ProofBlock({ p, onView }: { p: ProofItem; onView: (f: ProofItem['file']) => void }) {
  const [broken, setBroken] = useState(false);
  if (p.proof_type === 'link' && p.link_url) {
    return (
      <section>
        <h3 className="text-label-md text-fg">{p.title === 'Link' ? 'Sheet link' : p.title}</h3>
        <div className="mt-2 flex items-center gap-3 rounded-[12px] bg-subtle py-2 pl-4 pr-2">
          <span className="min-w-0 flex-1 truncate text-body-md text-fg">{p.link_url.replace(/^https?:\/\//, '')}</span>
          <Button size="S" variant="secondary" trailingIcon="external-link" href={p.link_url} aria-label={`Open ${p.link_url} in a new tab`} onClick={(e) => {
            e.preventDefault();
            window.open(p.link_url!, '_blank', 'noopener,noreferrer');
          }}>
            Open
          </Button>
        </div>
      </section>
    );
  }
  if (p.proof_type === 'text') {
    return (
      <section>
        <h3 className="text-label-md text-fg">{p.title}</h3>
        <p className="mt-1.5 whitespace-pre-wrap rounded-[12px] bg-subtle px-4 py-3 text-body-md text-fg">{p.text_value ?? '—'}</p>
      </section>
    );
  }
  const f = p.file;
  const isImage = f?.mime_type.startsWith('image/');
  return (
    <section>
      <h3 className="text-label-md text-fg">{p.title}</h3>
      {!f || f.purged ? (
        <p className="mt-1.5 text-body-sm text-fg-tertiary">This file is no longer available.</p>
      ) : isImage && f.url && !broken ? (
        <div className="relative mt-2 overflow-hidden rounded-[12px] border border-line bg-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.thumbnail_url ?? f.url} alt={`${p.title} from the worker`} onError={() => setBroken(true)} className="max-h-[360px] w-full object-contain" />
          <span className="absolute bottom-3 right-3">
            <Button size="S" variant="secondary" leadingIcon="search" onClick={() => onView(f)}>
              Full size
            </Button>
          </span>
        </div>
      ) : isImage ? (
        <p className="mt-1.5 flex items-center gap-2 rounded-[12px] bg-subtle px-4 py-3 text-body-sm text-fg-secondary">
          <Icon name="image" size={16} /> We couldn’t load this image.
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-3 rounded-[12px] bg-subtle py-2 pl-4 pr-2">
          <Icon name="file-text" size={20} className="text-fg-tertiary" />
          <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{f.filename}</span>
          {f.url ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-label-md text-fg">
              <Icon name="download" size={16} /> Download
            </a>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Full-size proof viewer (lightbox): Esc closes, focus trapped, GSAP fade-in. */
function ImageViewer({ file, onClose }: { file: ProofItem['file'] | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const open = !!file;
  useScrollLock(open);
  useFocusTrap(panel, open);
  useEscape(open, onClose);
  useEffect(() => {
    if (open && panel.current && !prefersReducedMotion()) gsap.fromTo(panel.current, { autoAlpha: 0, scale: 0.98 }, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'power2.out' });
  }, [open]);
  if (!file?.url) return null;
  return (
    <Portal>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={file.filename} tabIndex={-1} className="fixed inset-0 z-[600] flex flex-col bg-scrim outline-none">
        <div className="flex items-center justify-between gap-3 bg-inverse px-4 py-3 text-fg-inverse">
          <p className="min-w-0 truncate text-label-md">{file.filename}</p>
          <div className="flex items-center gap-2">
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-label-md hover:bg-inverse-raised">
              <Icon name="external-link" size={16} /> Open
            </a>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-[10px] hover:bg-inverse-raised focus-visible:shadow-focus-inverse focus-visible:outline-none">
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" onClick={onClose}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.url} alt={file.filename} className="max-h-full max-w-full rounded-[8px] bg-surface object-contain shadow-xl" onClick={(e) => e.stopPropagation()} />
        </div>
      </div>
    </Portal>
  );
}
