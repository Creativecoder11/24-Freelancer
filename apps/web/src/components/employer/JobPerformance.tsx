'use client';
import NextLink from 'next/link';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ActionMenu, Alert, Button, CountUp, EmptyState, Icon, IconButton, Skeleton, StatusBadge, cn, gsap, useGSAP, MOTION_OK, useStaggerIn } from '@24f/ui';
import { formatDate, formatMoney, formatRelative, formatReward } from '@24f/shared';
import { ApiError, usePerformance, type Performance } from './api';
import { useEmployerHeader } from './shell';
import { ErrorPanel, endsLabel } from './common';
import { useJobActions, type ActionJob } from './JobActions';

/** SCR-EMP-08 Job performance details (Figma 36:1826). */
export function JobPerformance({ publicId }: { publicId: string }) {
  const q = usePerformance(publicId);
  useEmployerHeader({ title: 'Job performance', subtitle: q.data?.job.title, backHref: '/employer/jobs' });
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon="briefcase" title="We can’t find that job." body="It may have been deleted, or it belongs to another account." action={<Button href="/employer/jobs">Back to My jobs</Button>} />
        </div>
      );
    return <ErrorPanel onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <PerfSkeleton />;
  return <Body d={q.data} />;
}

function Body({ d }: { d: Performance }) {
  const router = useRouter();
  const actions = useJobActions({ onDeleted: () => router.push('/employer/jobs') });
  const j = d.job;
  const aj: ActionJob = { public_id: j.public_id, title: j.title, status: j.status, reward_usd: j.reward_usd, slots_total: j.slots_total, approved: d.kpis.approved, allowed_actions: j.allowed_actions };
  const a = j.allowed_actions;
  const root = useStaggerIn<HTMLDivElement>([], { selector: '[data-stagger]' });
  const meta = [
    j.published_at ? `Posted ${formatDate(j.published_at)}` : 'Not published',
    `Job ID ${j.public_id}`,
    `${formatReward(j.reward_usd)} per task`,
    j.status === 'running' ? endsLabel(j.ends_at, 'ends').replace(/^E/, 'e') : j.status === 'paused' ? 'paused' : j.ends_at ? `ended ${formatDate(j.ends_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const overflow = actions.menuItems(aj).filter((i) => i.key === 'close' || (i.key === 'dup' && a.includes('add_slots')));
  return (
    <div ref={root} className="space-y-6">
      <NextLink href="/employer/jobs" className="hidden items-center gap-2 text-label-md text-fg-secondary hover:text-fg tablet:inline-flex">
        <Icon name="arrow-left" size={20} />
        Back to My jobs
      </NextLink>

      {j.status === 'paused' && j.pause_reason === 'low_deposit' ? (
        <Alert tone="warning" title="Paused · low deposit. Add funds to resume." action={<Button size="S" href={`/employer/wallet?return=${encodeURIComponent(`/employer/jobs/${j.public_id}`)}`}>Add funds</Button>} />
      ) : null}
      {j.status === 'suspended' || (j.status === 'paused' && j.pause_reason === 'admin') ? <Alert tone="danger" title="Suspended by admin. Contact support." /> : null}

      <section data-stagger className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6 desktop:flex-row desktop:items-center desktop:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge enum="job_status" code={j.status} />
            <p className="text-body-sm text-fg-secondary">{meta}</p>
          </div>
          <h2 className="mt-2 font-display text-h4 text-fg tablet:text-h3">{j.title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {a.includes('pause') ? (
            <Button variant="secondary" onClick={() => actions.open('pause', aj)}>
              Pause job
            </Button>
          ) : null}
          {a.includes('resume') ? (
            <Button variant="secondary" onClick={() => actions.open('resume', aj)}>
              Resume job
            </Button>
          ) : null}
          {a.includes('edit') ? (
            <Button variant="secondary" href={`/employer/jobs/${j.public_id}/edit?step=1`}>
              Edit job
            </Button>
          ) : null}
          {a.includes('add_slots') ? (
            <Button onClick={() => actions.open('slots', aj)} className="min-w-[140px]">
              Add slots
            </Button>
          ) : null}
          {a.includes('duplicate') && !a.includes('add_slots') ? (
            <Button variant="secondary" loading={actions.duplicating} onClick={() => actions.menuItems(aj).find((i) => i.key === 'dup')?.onSelect?.()}>
              Duplicate
            </Button>
          ) : null}
          {overflow.length ? <ActionMenu label="More job actions" items={overflow} trigger={<IconButton icon="more" variant="secondary" aria-label="More job actions" tooltip={false} />} /> : null}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 desktop:grid-cols-6 desktop:gap-4">
        <Kpi label="To review" n={d.kpis.to_review} tone="text-fg-warning" />
        <Kpi label="Approved" n={d.kpis.approved} tone="text-fg-success" />
        <Kpi label="Rejected" n={d.kpis.rejected} tone="text-fg-danger" />
        <Kpi label="Spent" money={d.kpis.spent_usd} />
        <Kpi label="Budget left" money={d.kpis.budget_left_usd} />
        <div data-stagger className="rounded-card border border-line bg-surface p-4 shadow-xs tablet:p-5">
          <p className="text-body-sm text-fg-secondary">Avg. review time</p>
          <p className="mt-1 font-display text-num-lg tabular-nums text-fg">{d.kpis.avg_review_hours === null ? '—' : `${d.kpis.avg_review_hours} h`}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,1fr)_352px] [&>*]:min-w-0">
        <StackedChart days={d.chart.days} yMax={d.chart.y_max} />
        <Funnel f={d.funnel} />
        <Reasons reasons={d.rejection_reasons} />
        <section data-stagger aria-labelledby="set-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
          <h3 id="set-h" className="text-h5 text-fg">
            Settings
          </h3>
          <dl className="mt-4 space-y-3 text-body-sm">
            {[
              ['Reward', formatReward(d.settings.reward_usd)],
              ['Slots', String(d.settings.slots_total)],
              ['Review window', `${d.settings.review_window_hours} h${d.settings.auto_approve ? ' · auto-approve' : ''}`],
              ['Resubmissions', d.settings.allow_resubmission ? 'Allowed' : 'Not allowed'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-fg-secondary">{k}</dt>
                <dd className="font-semibold tabular-nums text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {d.review_cta.visible ? (
        <section data-stagger className="flex flex-col gap-4 rounded-card bg-brand-subtle p-5 tablet:flex-row tablet:items-center tablet:justify-between tablet:px-6">
          <div>
            <p className="text-h5 text-fg">
              {d.review_cta.waiting} {d.review_cta.waiting === 1 ? 'submission' : 'submissions'} waiting
              {d.review_cta.oldest_submitted_at ? ` · oldest ${formatRelative(d.review_cta.oldest_submitted_at).replace(' ago', '')} ago` : ''}
            </p>
            {d.review_cta.auto_approve_at ? (
              <p className="mt-0.5 text-body-sm text-fg-secondary">Auto-approved in {hoursUntil(d.review_cta.auto_approve_at)} h if not reviewed.</p>
            ) : (
              <p className="mt-0.5 text-body-sm text-fg-secondary">Auto-approve is off. Submissions wait for your decision.</p>
            )}
          </div>
          <Button href={`/employer/submissions?job=${j.public_id}`} className="min-w-[140px]">
            Review now
          </Button>
        </section>
      ) : null}
      {actions.dialogs}
    </div>
  );
}

const hoursUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000));

function Kpi({ label, n, money, tone }: { label: string; n?: number; money?: string; tone?: string }) {
  return (
    <div data-stagger className="rounded-card border border-line bg-surface p-4 shadow-xs tablet:p-5">
      <p className="text-body-sm text-fg-secondary">{label}</p>
      <p className={cn('mt-1 font-display text-num-lg tabular-nums', tone ?? 'text-fg')}>
        {money !== undefined ? <CountUp value={Number(money)} format={(x) => formatMoney(x.toFixed(6))} /> : <CountUp value={n ?? 0} format={(x) => String(Math.round(x))} />}
      </p>
    </div>
  );
}

function StackedChart({ days, yMax }: { days: Performance['chart']['days']; yMax: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const H = 160;
  const max = Math.max(1, yMax);
  const ticks = Array.from(new Set([0, Math.round(max / 4), Math.round(max / 2), Math.round((3 * max) / 4), max])).sort((a, b) => a - b);
  const shown = days.slice(-14);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('[data-col]', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, stagger: 0.05, ease: 'power3.out' });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [days] },
  );
  const empty = shown.every((d) => d.approved + d.rejected + d.waiting === 0);
  return (
    <section data-stagger aria-labelledby="spd-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="spd-h" className="text-h5 text-fg">
          Submissions per day
        </h3>
        <ul className="flex gap-4 text-body-xs text-fg-secondary" aria-label="Legend">
          {[
            ['Approved', 'bg-success-bright'],
            ['Rejected', 'bg-danger'],
            ['Waiting', 'bg-warning'],
          ].map(([l, c]) => (
            <li key={l} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2.5 rounded-[3px]', c)} />
              {l}
            </li>
          ))}
        </ul>
      </div>
      {empty ? (
        <EmptyState compact icon="bar-chart" title="No submissions yet." className="mt-4" />
      ) : (
        <div ref={ref} className="mt-6 flex gap-3">
          <div className="relative w-6 shrink-0 text-right text-body-xs tabular-nums text-fg-tertiary" style={{ height: H }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
                {t}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-x-0 top-0" style={{ height: H }} aria-hidden>
              {ticks.map((t) => (
                <span key={t} className="absolute inset-x-0 h-px bg-line-subtle" style={{ top: H - (t / max) * H }} />
              ))}
            </div>
            <ul className="relative flex items-end gap-2 tablet:gap-4" style={{ height: H }} aria-label="Submissions per day">
              {shown.map((d) => {
                const tot = d.approved + d.rejected + d.waiting;
                return (
                  <li key={d.date} className="flex h-full flex-1 items-end justify-center" aria-label={`${d.label}: ${d.approved} approved, ${d.rejected} rejected, ${d.waiting} waiting`} tabIndex={0}>
                    <span data-col className="flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: `${(tot / max) * 100}%` }}>
                      {d.approved ? <span className="bg-success-bright" style={{ flex: d.approved }} /> : null}
                      {d.waiting ? <span className="bg-warning" style={{ flex: d.waiting }} /> : null}
                      {d.rejected ? <span className="bg-danger" style={{ flex: d.rejected }} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex gap-2 text-center text-body-xs text-fg-tertiary tablet:gap-4" aria-hidden>
              {shown.map((d, i) => (
                <span key={d.date} className="flex-1 truncate">
                  {shown.length <= 7 || i % 2 === 0 ? d.label : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Funnel({ f }: { f: Performance['funnel'] }) {
  const ref = useRef<HTMLElement>(null);
  const rows: [string, number][] = [
    ['Opened the job', f.opened],
    ['Started (slot reserved)', f.started],
    ['Submitted proof', f.submitted],
    ['Approved', f.approved],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1]));
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from('[data-fbar]', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.7, stagger: 0.08, ease: 'power3.out', delay: 0.1 });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [f] },
  );
  return (
    <section ref={ref} data-stagger aria-labelledby="fun-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <h3 id="fun-h" className="text-h5 text-fg">
        From view to approval
      </h3>
      <ul className="mt-4 space-y-4">
        {rows.map(([l, n]) => (
          <li key={l}>
            <div className="flex justify-between text-body-sm">
              <span className="text-fg-secondary">{l}</span>
              <span className="font-semibold tabular-nums text-fg">{n.toLocaleString('en-US')}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${l}: ${n}`}>
              <span data-fbar className="block h-full rounded-full bg-brand" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-body-xs text-fg-tertiary">Opened → submitted: {f.opened_to_submitted_percent !== null ? `${f.opened_to_submitted_percent}%` : '—'}</p>
    </section>
  );
}

function Reasons({ reasons }: { reasons: Performance['rejection_reasons'] }) {
  const max = Math.max(1, ...reasons.map((r) => r.count));
  return (
    <section data-stagger aria-labelledby="rr-h" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
      <h3 id="rr-h" className="text-h5 text-fg">
        Rejection reasons
      </h3>
      <p className="mt-0.5 text-body-sm text-fg-secondary">Clear reasons help workers fix their work and keep your approval quality high.</p>
      <ul className="mt-4 space-y-3">
        {reasons.map((r) => (
          <li key={r.code} className="grid grid-cols-[minmax(0,1fr)_24px] items-center gap-4 tablet:grid-cols-[200px_minmax(0,1fr)_24px]">
            <span className="text-body-sm text-fg">{r.label}</span>
            <span className="hidden h-2 overflow-hidden rounded-full bg-muted tablet:block" aria-hidden>
              <span className="block h-full rounded-full bg-danger" style={{ width: `${(r.count / max) * 100}%`, opacity: r.count ? 1 : 0 }} />
            </span>
            <span className="text-right text-label-md tabular-nums text-fg">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PerfSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading job">
      <Skeleton height={112} radius={16} />
      <div className="grid grid-cols-2 gap-3 desktop:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height={96} radius={16} />
        ))}
      </div>
      <div className="grid gap-6 desktop:grid-cols-[1fr_352px]">
        <Skeleton height={320} radius={16} />
        <Skeleton height={320} radius={16} />
      </div>
    </div>
  );
}
