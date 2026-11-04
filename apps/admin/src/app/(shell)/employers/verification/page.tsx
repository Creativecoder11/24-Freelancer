'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, Checkbox, EmptyState, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Gate, KV, Pager, post, reasonField, RefLink, SidePanel, SplitView, Table, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { d, dt } from '@/lib/fmt';

interface Row { public_id: string; business_name: string; website_url: string | null; billing_email: string | null; industry: string | null; about: string | null; verification_status: string; verification_submitted_at: string | null; employer_verified_at: string | null; verification_note: string | null; member_since: string; jobs_posted: number; deposits_completed: number }

/** SCR-ADM-06 Employer verification (Doc 09 §6, §8.5). */
function Employers() {
  usePageHeader('Employer verification', 'Check that the business details are real.');
  const { tick } = useSession();
  const u = useUrlState();
  const status = u.get('status', 'pending');
  const sel = u.get('employer');
  const list = useApi<Row[]>('/admin/employers/verification', { status, page: u.get('page', '1'), t: tick });
  const row = list.data?.find((r) => r.public_id === sel) ?? null;
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const host = (url: string | null) => {
    try {
      return url ? new URL(url).hostname : null;
    } catch {
      return url;
    }
  };
  return (
    <Gate perms={['employers.verify']}>
      <Tabs label="Status" value={status} panelId="emp" className="mb-4" onChange={(v) => u.set({ status: v === 'pending' ? null : v, employer: null })} tabs={[{ value: 'pending', label: 'Pending', count: counts.pending }, { value: 'verified', label: 'Verified', count: counts.verified }, { value: 'rejected', label: 'Rejected', count: counts.rejected }]} />
      <SplitView
        panel={
          <SidePanel
            open={!!row}
            wide={false}
            onClose={() => u.set({ employer: null })}
            title={row?.business_name ?? ''}
            meta={row ? `Employer · since ${d(row.member_since)}` : undefined}
            footer={
              row && row.verification_status === 'pending' ? (
                <>
                  <Button variant="secondary" onClick={() => setSpec({ title: `Don't verify ${row.business_name}?`, description: 'The employer stays active and can keep posting jobs, without the badge.', confirm: 'Reject verification', variant: 'destructive', fields: [{ ...reasonField('Reason', 500, 'The employer sees this in settings.'), placeholder: "We couldn't confirm the website belongs to this business." } as never], submit: (v) => post(`/admin/employers/${row.public_id}/reject-verification`, { reason: v.reason }), success: 'Verification rejected.', onDone: () => u.set({ employer: null }) })}>Reject</Button>
                  <Button onClick={() => setSpec({ title: `Verify ${row.business_name}?`, description: 'Workers will see the "Verified employer" badge on this employer\'s jobs.', confirm: 'Verify employer', submit: () => post(`/admin/employers/${row.public_id}/verify`, {}), success: 'Employer verified.', onDone: () => u.set({ employer: null }) })}>Verify employer</Button>
                </>
              ) : null
            }
          >
            {row ? (
              <>
                <KV cols={1} items={[['Employer ID', <RefLink key="u" href={`/users/${row.public_id}`}>{row.public_id}</RefLink>], ['Website', row.website_url ? <a href={row.website_url} target="_blank" rel="noopener noreferrer" className="text-fg-brand hover:underline">{host(row.website_url)} ↗</a> : '—'], ['Billing email', row.billing_email ?? '—'], ['Industry', row.industry ?? '—'], ['About', row.about ?? '—'], ['Jobs posted', String(row.jobs_posted)], ['Deposits completed', String(row.deposits_completed)], ['Submitted', dt(row.verification_submitted_at)]]} />
                {row.verification_note ? <Alert tone="warning" title="Note to employer">{row.verification_note}</Alert> : null}
                {row.verification_status === 'pending' ? (
                  <fieldset className="space-y-2 rounded-[12px] bg-subtle p-3">
                    <legend className="text-label-sm text-fg">Checklist (not stored)</legend>
                    {['Website loads and matches the business', 'Billing email domain matches the website or is plausible', 'No other account uses these details'].map((c) => (
                      <Checkbox key={c} label={c} checked={!!checks[c]} onChange={(e) => setChecks((x) => ({ ...x, [c]: e.target.checked }))} />
                    ))}
                  </fieldset>
                ) : null}
              </>
            ) : null}
          </SidePanel>
        }
      >
        <Table<Row>
          caption="Employers"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.public_id}
          selectedKey={sel}
          onRowClick={(r) => u.set({ employer: r.public_id }, false)}
          empty={<EmptyState icon="building" title="No employers waiting" body="Employers join this queue once their profile has a name plus a website or billing email." compact />}
          cols={[
            { key: 'id', header: 'Employer ID', cell: (r) => <RefLink href={`/users/${r.public_id}`}>{r.public_id}</RefLink> },
            { key: 'b', header: 'Business', cell: (r) => r.business_name },
            { key: 'w', header: 'Website', cell: (r) => (r.website_url ? <a href={r.website_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-fg-brand hover:underline">{host(r.website_url)}</a> : '—') },
            { key: 'e', header: 'Billing email', cell: (r) => r.billing_email ?? '—', hideBelow: 'desktop' },
            { key: 'i', header: 'Industry', cell: (r) => r.industry ?? '—', hideBelow: 'desktop' },
            { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="employer" code={r.verification_status} /> },
            { key: 'sub', header: 'Submitted', cell: (r) => dt(r.verification_submitted_at) },
          ]}
        />
        <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      </SplitView>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Employers />
    </Suspense>
  );
}
