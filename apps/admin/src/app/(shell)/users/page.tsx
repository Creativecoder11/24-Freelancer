'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, Search, Tabs, Tooltip } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, NoResults, Pager, RefLink, RowMenu, Table, Toggle, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, rel } from '@/lib/fmt';
import { restrictSpec, reinstateSpec, suspendSpec } from './user-actions';

interface Row { public_id: string; name_masked: string; email_masked: string | null; phone_masked: string | null; status: string; kyc_status: string; has_employer_profile: boolean; risk_flags: string[]; created_at: string; last_login_at: string | null }
interface Appeal { id: string; user_public_id: string; user_name_masked: string; kind: string; reason_code: string; message: string; status: string; created_at: string }

/** SCR-ADM-03 Users (Doc 09 §6). Search text stays in component state, never in the URL. */
function Users() {
  usePageHeader('Users', 'Search by public ID, email, phone or name.');
  const router = useRouter();
  const { can, tick, me } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'users');
  const [q, setQ] = useState('');
  useEffect(() => {
    const s = sessionStorage.getItem('adm:user-q');
    if (s) {
      setQ(s);
      sessionStorage.removeItem('adm:user-q');
    }
  }, []);
  const supportOnly = me.roles.length === 1 && me.roles[0] === 'support_agent';
  const query = { q, status: u.get('status'), kyc_status: u.get('kyc'), flagged: u.get('flagged') ? 'true' : undefined, sort: u.get('sort'), page: u.get('page', '1'), t: tick };
  const list = useApi<Row[]>(tab === 'users' && (!supportOnly || q) ? '/admin/users' : null, query);
  const appeals = useApi<Appeal[]>(tab === 'appeals' && can('appeals.read') ? '/admin/appeals' : null, { status: u.get('astatus', 'open'), t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const filtered = !!(q || u.get('status') || u.get('kyc') || u.get('flagged'));
  return (
    <Gate perms={['users.read_masked', 'users.read']}>
      {can('appeals.read') ? <Tabs label="Users views" value={tab} panelId="users-panel" className="mb-4" onChange={(v) => u.set({ tab: v === 'users' ? null : v })} tabs={[{ value: 'users', label: 'Users' }, { value: 'appeals', label: 'Appeals', count: (appeals.meta?.counts as Record<string, number> | undefined)?.open }]} /> : null}
      <div id="users-panel">
        {tab === 'users' ? (
          <>
            <div className="mb-3">
              <Search value={q} onValueChange={setQ} label="Search users" placeholder="Public ID, email, phone or name" size="M" />
            </div>
            <Toolbar>
              <FilterSelect label="Status" value={u.get('status')} onChange={(v) => u.set({ status: v })} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'restricted', label: 'Restricted' }, { value: 'suspended', label: 'Suspended' }, { value: 'closed', label: 'Closed' }]} />
              <FilterSelect label="KYC" value={u.get('kyc')} onChange={(v) => u.set({ kyc: v })} options={[{ value: '', label: 'Any KYC' }, { value: 'not_submitted', label: 'Not submitted' }, { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} />
              <FilterSelect label="Sort" value={u.get('sort')} onChange={(v) => u.set({ sort: v })} options={[{ value: '', label: 'Newest first' }, { value: 'created_at', label: 'Oldest first' }, { value: '-last_login_at', label: 'Last login' }]} />
              <Toggle label="Flagged" on={!!u.get('flagged')} onChange={(v) => u.set({ flagged: v ? '1' : null })} />
            </Toolbar>
            <Table<Row>
              caption="Users"
              rows={list.data}
              loading={list.loading}
              error={list.error}
              onRetry={list.hardReload}
              rowKey={(r) => r.public_id}
              onRowClick={(r) => router.push(`/users/${r.public_id}`)}
              empty={filtered ? <NoResults onClear={() => { setQ(''); u.set({ status: null, kyc: null, flagged: null, sort: null }); }} /> : <EmptyState icon="users" title="Search for a user" body="Enter a public ID, email, phone or name. Results stay masked until you reveal them." compact />}
              cols={[
                { key: 'id', header: 'Public ID', cell: (r) => <RefLink href={`/users/${r.public_id}`}>{r.public_id}</RefLink> },
                { key: 'name', header: 'Name', cell: (r) => r.name_masked },
                { key: 'email', header: 'Email', cell: (r) => r.email_masked ?? '—', hideBelow: 'laptop' },
                { key: 'phone', header: 'Phone', cell: (r) => r.phone_masked ?? '—', hideBelow: 'desktop' },
                { key: 'status', header: 'Status', cell: (r) => <AdminBadge kind="user" code={r.status} /> },
                { key: 'kyc', header: 'KYC', cell: (r) => <AdminBadge kind="kyc" code={r.kyc_status} /> },
                { key: 'modes', header: 'Modes', cell: (r) => (r.has_employer_profile ? 'Worker, Employer' : 'Worker'), hideBelow: 'desktop' },
                { key: 'risk', header: 'Risk', cell: (r) => (r.risk_flags.length ? <Tooltip content={r.risk_flags.join(', ')}><span tabIndex={0} className="rounded-full bg-danger-subtle px-2 text-label-sm text-fg-danger">{r.risk_flags.length}</span></Tooltip> : '—') },
                { key: 'joined', header: 'Joined', cell: (r) => dt(r.created_at), hideBelow: 'laptop' },
                { key: 'login', header: 'Last login', cell: (r) => rel(r.last_login_at), hideBelow: 'desktop' },
                {
                  key: 'menu',
                  header: '',
                  align: 'right',
                  cell: (r) => (
                    <RowMenu
                      items={[
                        { key: 'open', label: 'Open', onSelect: () => router.push(`/users/${r.public_id}`) },
                        can('users.restrict') && r.status === 'active' && { key: 'restrict', label: 'Restrict', onSelect: () => setSpec(restrictSpec(r.public_id, list.reload)) },
                        can('users.suspend') && ['active', 'restricted'].includes(r.status) && { key: 'suspend', label: 'Suspend', tone: 'danger', onSelect: () => setSpec(suspendSpec(r.public_id, 0, list.reload)) },
                        can('users.suspend') && ['restricted', 'suspended'].includes(r.status) && { key: 'reinstate', label: 'Reinstate', onSelect: () => setSpec(reinstateSpec(r.public_id, list.reload)) },
                      ]}
                    />
                  ),
                },
              ]}
            />
            <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
          </>
        ) : (
          <>
            <Toolbar>
              <FilterSelect label="Status" value={u.get('astatus', 'open')} onChange={(v) => u.set({ astatus: v })} options={[{ value: 'open', label: 'Open' }, { value: 'under_review', label: 'Under review' }, { value: 'upheld', label: 'Upheld' }, { value: 'denied', label: 'Denied' }]} />
            </Toolbar>
            <Table<Appeal>
              caption="Appeals"
              rows={appeals.data}
              loading={appeals.loading}
              error={appeals.error}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/users/${r.user_public_id}?tab=moderation`)}
              empty={<EmptyState icon="inbox" title="No appeals waiting" body="Appeals logged by users or by support appear here." compact />}
              cols={[
                { key: 'u', header: 'User', cell: (r) => <RefLink href={`/users/${r.user_public_id}?tab=moderation`}>{r.user_public_id}</RefLink> },
                { key: 'kind', header: 'Restriction', cell: (r) => <AdminBadge kind="user" code={r.kind} /> },
                { key: 'msg', header: 'What the user said', cell: (r) => <span className="line-clamp-1">{r.message}</span> },
                { key: 'st', header: 'Status', cell: (r) => <AdminBadge kind="appeal" code={r.status} /> },
                { key: 'at', header: 'Received', cell: (r) => dt(r.created_at) },
              ]}
            />
          </>
        )}
      </div>
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Users />
    </Suspense>
  );
}
