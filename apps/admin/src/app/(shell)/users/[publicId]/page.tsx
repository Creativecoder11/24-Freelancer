'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { ActionMenu, Alert, Avatar, Button, EmptyState, StatCard, Tabs, initialsFrom } from '@24f/ui';
import { usePageHeader, WriteOnly } from '@/components/shell';
import { ActionDialog, ErrorState, Gate, KV, RefLink, Section, Table, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { d, dt, exact, rel, reward, usd } from '@/lib/fmt';
import { adjustSpec, appealSpec, contactSpec, decideAppealSpec, reinstateSpec, reset2faSpec, restrictSpec, revealSpec, signOutSpec, suspendSpec } from '../user-actions';

interface Detail {
  public_id: string; name_masked: string; email_masked: string | null; phone_masked: string | null; unmasked: { full_name: string | null; email: string | null; phone: string | null } | null;
  country_code: string; status: string; kyc_status: string; active_mode: string; has_employer_profile: boolean; business_name: string | null; email_verified: boolean; phone_verified: boolean; two_step_enabled: boolean; terms_version: string; created_at: string; last_login_at: string | null; closed_at: string | null; anonymised: boolean;
  balances: Record<string, string> | null;
  stats: { submissions: number; approval_rate_pct: number | null; jobs_posted: number; withdrawals_paid: number; deposits_completed: number };
  restrictions: { id: string; kind: string; reason_code: string; internal_note: string | null; public_message: string; starts_at: string; ends_at: string | null; created_by: string; lifted_at: string | null; lifted_by: string | null; active: boolean }[];
  appeals: { id: string; kind: string; message: string; status: string; decision_note: string | null; created_at: string }[];
  sessions: { id: string; device_label: string; city: string | null; last_active_at: string }[];
  referral: { code: string | null; referred_by: string | null; friends: number };
  risk_flags: string[];
}

/** SCR-ADM-04 User detail (Doc 09 §6, §7). */
function UserDetail({ publicId }: { publicId: string }) {
  const { can, tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'overview');
  const { data, error, loading, reload, hardReload } = useApi<Detail>(`/admin/users/${publicId}`, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null);
  usePageHeader(data ? (revealed?.full_name ?? data.unmasked?.full_name ?? data.name_masked) : 'User', data ? `ID ${data.public_id} · Joined ${d(data.created_at)}` : undefined);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 5 * 60_000);
    return () => clearTimeout(t);
  }, [revealed]);
  if (error?.code === 'NOT_FOUND') return <EmptyState icon="users" title={`We can't find user ${publicId}`} action={<Button href="/users">Back to users</Button>} />;
  if (error && !data) return <ErrorState error={error} onRetry={hardReload} />;
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-muted" aria-busy />;
  const closed = data.status === 'closed';
  const active = data.restrictions.find((r) => r.active);
  const openAppeal = data.appeals.some((a) => a.status === 'open' || a.status === 'under_review');
  const show = (k: 'full_name' | 'email' | 'phone', masked: string | null) => revealed?.[k] ?? data.unmasked?.[k] ?? masked ?? '—';
  const tabs = [
    { value: 'overview', label: 'Overview' },
    ...(data.balances ? [{ value: 'wallet', label: 'Wallet' }] : []),
    { value: 'work', label: 'Work' },
    { value: 'money', label: 'Money' },
    { value: 'referrals', label: 'Referrals' },
    { value: 'sessions', label: 'Sessions', count: data.sessions.length },
    { value: 'moderation', label: 'Moderation' },
  ];
  return (
    <Gate perms={['users.read_masked', 'users.read']}>
      <section className="rounded-card border border-line bg-surface p-5 shadow-xs">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar initials={initialsFrom(data.name_masked)} size="L" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-h5 text-fg">{show('full_name', data.name_masked)}</p>
              <AdminBadge kind="user" code={data.status} />
              <AdminBadge kind="kyc" code={data.kyc_status} />
              {data.risk_flags.map((f) => <span key={f} className="rounded-full bg-danger-subtle px-2 text-label-sm leading-6 text-fg-danger">{f}</span>)}
            </div>
            <p className="text-body-sm text-fg-secondary">{show('email', data.email_masked)} · {show('phone', data.phone_masked)}</p>
            {!data.anonymised && can('users.reveal') && !data.unmasked ? (
              <Button size="S" variant="tertiary" leadingIcon="eye" onClick={() => setSpec(revealSpec(publicId, setRevealed))}>Reveal</Button>
            ) : null}
          </div>
          {!closed ? (
            <WriteOnly>
              <div className="flex flex-wrap gap-2">
                {can('users.restrict') && data.status === 'active' ? <Button variant="secondary" onClick={() => setSpec(restrictSpec(publicId, reload))}>Restrict</Button> : null}
                {can('users.suspend') && ['active', 'restricted'].includes(data.status) ? <Button variant="destructive" onClick={() => setSpec(suspendSpec(publicId, data.sessions.length, reload))}>Suspend</Button> : null}
                {can('users.suspend') && ['restricted', 'suspended'].includes(data.status) ? <Button onClick={() => setSpec(reinstateSpec(publicId, reload))}>Reinstate</Button> : null}
                <ActionMenu
                  label="More actions"
                  trigger={<Button variant="secondary" trailingIcon="chevron-down">More</Button>}
                  items={[
                    ...(can('appeals.log') && active && !openAppeal ? [{ key: 'appeal', label: 'Log an appeal', onSelect: () => setSpec(appealSpec(publicId, reload)) }] : []),
                    ...(can('ledger.adjust') ? [{ key: 'adjust', label: 'Adjust balance', onSelect: () => setSpec(adjustSpec({ userId: publicId, balances: data.balances ?? undefined }, reload)) }] : []),
                    ...(can('users.contact') ? [{ key: 'contact', label: 'Change contact', onSelect: () => setSpec(contactSpec(publicId, reload)) }] : []),
                    ...(can('users.security') && data.two_step_enabled ? [{ key: '2fa', label: 'Reset two-step', tone: 'danger' as const, onSelect: () => setSpec(reset2faSpec(publicId, reload)) }] : []),
                    ...(can('users.security') && data.sessions.length ? [{ key: 'out', label: 'Sign out everywhere', tone: 'danger' as const, onSelect: () => setSpec(signOutSpec(publicId, data.sessions.length, reload)) }] : []),
                  ]}
                />
              </div>
            </WriteOnly>
          ) : can('ledger.adjust') ? (
            <Button variant="secondary" onClick={() => setSpec(adjustSpec({ userId: publicId, balances: data.balances ?? undefined }, reload))}>Adjust balance</Button>
          ) : null}
        </div>
        {active ? (
          <Alert tone={active.kind === 'suspended' ? 'danger' : 'warning'} className="mt-4" title={`${active.kind === 'suspended' ? 'Suspended' : 'Restricted'} · ${LABELS.restriction[active.reason_code] ?? active.reason_code}`}>
            {active.public_message} {active.ends_at ? `Ends ${dt(active.ends_at)}.` : 'No end date.'}
          </Alert>
        ) : null}
        {closed ? <Alert tone="info" className="mt-4">This account was closed on {d(data.closed_at)}. Personal data is anonymised after 30 days.</Alert> : null}
      </section>

      <Tabs label="User detail" value={tab} panelId="u-tab" className="mt-6" onChange={(v) => u.set({ tab: v === 'overview' ? null : v })} tabs={tabs} />
      <div id="u-tab" className="mt-5">
        {tab === 'overview' ? (
          <div className="space-y-5">
            <div className="grid gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
              <StatCard type="default" label="Submissions" value={String(data.stats.submissions)} compact countUp />
              <StatCard type="default" label="Approval rate" value={data.stats.approval_rate_pct === null ? '—' : `${data.stats.approval_rate_pct}%`} compact countUp />
              <StatCard type="default" label="Jobs posted" value={String(data.stats.jobs_posted)} compact countUp />
              <StatCard type="default" label="Withdrawals paid" value={String(data.stats.withdrawals_paid)} compact countUp />
              <StatCard type="default" label="Deposits completed" value={String(data.stats.deposits_completed)} compact countUp />
            </div>
            <Section title="Profile">
              <KV cols={3} items={[['Country', data.country_code], ['Email verified', data.email_verified ? 'Yes' : 'No'], ['Phone verified', data.phone_verified ? 'Yes' : 'No'], ['Two-step', data.two_step_enabled ? 'On' : 'Off'], ['Active mode', data.active_mode === 'employer' ? 'Employer' : 'Worker'], ['Terms version', data.terms_version], ['Business', data.business_name ?? '—'], ['Last login', rel(data.last_login_at)], ['Joined', dt(data.created_at)]]} />
            </Section>
          </div>
        ) : null}
        {tab === 'wallet' && data.balances ? <WalletTab publicId={publicId} b={data.balances} /> : null}
        {tab === 'work' ? <WorkTab publicId={publicId} /> : null}
        {tab === 'money' ? <MoneyTab publicId={publicId} /> : null}
        {tab === 'referrals' ? (
          <Section title="Referral">
            <KV cols={3} items={[['Code', data.referral.code ?? '—'], ['Referred by', data.referral.referred_by ? <RefLink href={`/users/${data.referral.referred_by}`}>{data.referral.referred_by}</RefLink> : '—'], ['Friends', String(data.referral.friends)]]} />
            {can('referrals.read') ? <Button className="mt-4" size="S" variant="secondary" href={`/referrals?referrer=${publicId}`}>Open referrals</Button> : null}
          </Section>
        ) : null}
        {tab === 'sessions' ? (
          <Table caption="Sessions" rows={data.sessions} rowKey={(s) => s.id} empty={<EmptyState title="No active sessions" compact />} cols={[{ key: 'd', header: 'Device', cell: (s) => s.device_label }, { key: 'c', header: 'City', cell: (s) => s.city ?? '—' }, { key: 'l', header: 'Last active', cell: (s) => rel(s.last_active_at) }]} />
        ) : null}
        {tab === 'moderation' ? <ModerationTab data={data} publicId={publicId} onDecide={(id) => setSpec(decideAppealSpec(id, reload))} /> : null}
      </div>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

function WalletTab({ publicId, b }: { publicId: string; b: Record<string, string> }) {
  const { can } = useSession();
  const deposit = (Number(b.employer_available_usd) + Number(b.employer_reserved_usd)).toFixed(2);
  const ledger = useApi<{ ref: string; type: string; occurred_at: string; entries: { owner_public_id: string | null; amount_exact: string; account_kind: string }[] }[]>(can('ledger.read') ? '/admin/ledger' : null, { user: publicId, per_page: 20 });
  const neg = (v: string) => (Number(v) < 0 ? 'text-fg-danger' : '');
  return (
    <div className="space-y-5">
      <div className="grid gap-4 tablet:grid-cols-3">
        <StatCard type="default" label="Available to withdraw" value={usd(b.worker_available_usd)} compact className={neg(b.worker_available_usd!)} />
        <StatCard type="default" label="Pending review" value={usd(b.worker_pending_usd)} compact />
        <StatCard type="default" label="Withdrawals on the way" value={usd(b.worker_in_flight_usd)} compact />
        <StatCard type="default" label="Available for new jobs" value={usd(b.employer_available_usd)} compact className={neg(b.employer_available_usd!)} />
        <StatCard type="default" label="Reserved for running jobs" value={usd(b.employer_reserved_usd)} compact />
        <StatCard type="default" label="Deposit balance" value={usd(deposit)} meta="Available + reserved" compact />
      </div>
      {can('ledger.read') ? (
        <Section title="Ledger · last 20" actions={<Button size="S" variant="secondary" href={`/ledger?user=${publicId}`}>Open full ledger</Button>}>
          <Table caption="Ledger" rows={ledger.data} loading={ledger.loading} rowKey={(r) => r.ref} empty={<EmptyState title="No transactions found." compact />} cols={[{ key: 'r', header: 'Reference', cell: (r) => <RefLink href={`/ledger?ref=${r.ref}`}>{r.ref}</RefLink> }, { key: 't', header: 'Type', cell: (r) => LABELS.ledgerType[r.type] ?? r.type }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => <span className="adm-mono">{exact(r.entries.find((e) => e.owner_public_id === publicId)?.amount_exact ?? null)}</span> }, { key: 'w', header: 'When', cell: (r) => dt(r.occurred_at) }]} />
        </Section>
      ) : null}
    </div>
  );
}

function WorkTab({ publicId }: { publicId: string }) {
  const { can } = useSession();
  const [sub, setSub] = useState<'submissions' | 'jobs'>('submissions');
  const subs = useApi<{ ref: string; job_public_id: string; status: string; reward_usd: string; submitted_at: string }[]>(sub === 'submissions' && can('submissions.read') ? '/admin/submissions' : null, { worker: publicId, per_page: 10 });
  const jobs = useApi<{ public_id: string; title: string; status: string; published_at: string | null }[]>(sub === 'jobs' ? '/admin/jobs' : null, { employer: publicId, per_page: 10 });
  return (
    <div>
      <Tabs label="Work" value={sub} onChange={setSub} panelId="work-p" className="mb-3" tabs={[{ value: 'submissions', label: 'Submissions' }, { value: 'jobs', label: 'Jobs' }]} />
      <div id="work-p">
        {sub === 'submissions' ? (
          <Table caption="Submissions" rows={subs.data} loading={subs.loading} rowKey={(r) => r.ref} empty={<EmptyState title="No submissions" compact />} cols={[{ key: 'r', header: 'Reference', cell: (r) => <RefLink href={`/submissions?ref=${r.ref}`}>{r.ref}</RefLink> }, { key: 'j', header: 'Job', cell: (r) => r.job_public_id }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="submission" code={r.status} /> }, { key: 'w', header: 'Reward', align: 'right', cell: (r) => reward(r.reward_usd) }, { key: 'd', header: 'Submitted', cell: (r) => dt(r.submitted_at) }]} />
        ) : (
          <Table caption="Jobs" rows={jobs.data} loading={jobs.loading} rowKey={(r) => r.public_id} empty={<EmptyState title="No jobs posted" compact />} cols={[{ key: 'j', header: 'Job', cell: (r) => <RefLink href={`/jobs/${r.public_id}`}>{r.public_id}</RefLink> }, { key: 't', header: 'Title', cell: (r) => r.title }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="job" code={r.status} /> }, { key: 'p', header: 'Published', cell: (r) => dt(r.published_at) }]} />
        )}
      </div>
    </div>
  );
}

function MoneyTab({ publicId }: { publicId: string }) {
  const [sub, setSub] = useState<'withdrawals' | 'deposits'>('withdrawals');
  const w = useApi<{ ref: string; status: string; amount_usd: string; method: string; requested_at: string }[]>(sub === 'withdrawals' ? '/admin/withdrawals' : null, { q: publicId, per_page: 10 });
  const dep = useApi<{ ref: string; status: string; amount_usd: string; method_label: string; initiated_at: string }[]>(sub === 'deposits' ? '/admin/deposits' : null, { q: publicId, per_page: 10 });
  return (
    <div>
      <Tabs label="Money" value={sub} onChange={setSub} panelId="money-p" className="mb-3" tabs={[{ value: 'withdrawals', label: 'Withdrawals' }, { value: 'deposits', label: 'Deposits' }]} />
      <div id="money-p">
        {sub === 'withdrawals' ? (
          <Table caption="Withdrawals" rows={w.data} loading={w.loading} error={w.error} rowKey={(r) => r.ref} empty={<EmptyState title="No withdrawals" compact />} cols={[{ key: 'r', header: 'Reference', cell: (r) => <RefLink href={`/withdrawals?ref=${r.ref}&tab=all`}>{r.ref}</RefLink> }, { key: 'm', header: 'Method', cell: (r) => LABELS.method[r.method] }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => usd(r.amount_usd) }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="withdrawal" code={r.status} /> }, { key: 'd', header: 'Requested', cell: (r) => dt(r.requested_at) }]} />
        ) : (
          <Table caption="Deposits" rows={dep.data} loading={dep.loading} error={dep.error} rowKey={(r) => r.ref} empty={<EmptyState title="No deposits" compact />} cols={[{ key: 'r', header: 'Reference', cell: (r) => <RefLink href={`/deposits?ref=${r.ref}`}>{r.ref}</RefLink> }, { key: 'm', header: 'Method', cell: (r) => r.method_label }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => usd(r.amount_usd) }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="deposit" code={r.status} /> }, { key: 'd', header: 'Started', cell: (r) => dt(r.initiated_at) }]} />
        )}
      </div>
    </div>
  );
}

function ModerationTab({ data, publicId, onDecide }: { data: Detail; publicId: string; onDecide: (id: string) => void }) {
  const { can } = useSession();
  const audit = useApi<{ id: string; action: string; actor_name: string; reason: string | null; created_at: string }[]>(can('audit.read') ? '/admin/audit-log' : null, { entity_ref: publicId, from: '2020-01-01' });
  return (
    <div className="space-y-5">
      <Section title="Restriction history">
        <Table caption="Restrictions" rows={data.restrictions} rowKey={(r) => r.id} empty={<EmptyState title="No restrictions" compact />} cols={[{ key: 'k', header: 'Kind', cell: (r) => <AdminBadge kind="user" code={r.kind} /> }, { key: 'c', header: 'Reason', cell: (r) => LABELS.restriction[r.reason_code] ?? r.reason_code }, { key: 's', header: 'Starts', cell: (r) => dt(r.starts_at) }, { key: 'e', header: 'Ends', cell: (r) => dt(r.ends_at) }, { key: 'b', header: 'Set by', cell: (r) => r.created_by }, { key: 'l', header: 'Lifted by', cell: (r) => (r.lifted_by ? `${r.lifted_by} · ${dt(r.lifted_at)}` : '—') }, { key: 'n', header: 'Internal note', cell: (r) => <span className="line-clamp-2">{r.internal_note ?? '—'}</span> }]} />
      </Section>
      <Section title="Appeals">
        <Table caption="Appeals" rows={data.appeals} rowKey={(r) => r.id} empty={<EmptyState title="No appeals" compact />} cols={[{ key: 'm', header: 'What the user said', cell: (r) => <span className="line-clamp-2">{r.message}</span> }, { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="appeal" code={r.status} /> }, { key: 'n', header: 'Decision', cell: (r) => r.decision_note ?? '—' }, { key: 'a', header: '', align: 'right', cell: (r) => (can('appeals.decide') && (r.status === 'open' || r.status === 'under_review') ? <WriteOnly><Button size="S" onClick={() => onDecide(r.id)}>Decide</Button></WriteOnly> : null) }]} />
      </Section>
      {can('audit.read') ? (
        <Section title="Audit entries">
          <Table caption="Audit" rows={audit.data} loading={audit.loading} rowKey={(r) => r.id} empty={<EmptyState title="No entries" compact />} cols={[{ key: 'w', header: 'When', cell: (r) => dt(r.created_at) }, { key: 'a', header: 'Action', cell: (r) => <span className="adm-mono">{r.action}</span> }, { key: 'b', header: 'Actor', cell: (r) => r.actor_name }, { key: 'r', header: 'Reason', cell: (r) => r.reason ?? '—' }]} />
        </Section>
      ) : null}
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  return (
    <Suspense>
      <UserDetail publicId={publicId} />
    </Suspense>
  );
}

