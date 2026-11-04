'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, Tabs } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, post, reasonField, RowMenu, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge } from '@/components/badges';
import { api } from '@/lib/api';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { rel } from '@/lib/fmt';

interface AdminRow { id: string; full_name: string; email: string; status: string; roles: string[]; totp_enrolled: boolean; last_login_at: string | null; mixed_duties: boolean; invited: boolean }
interface Role { code: string; name: string; description: string; permissions: string[]; holders: number }

const ROLE_NAMES: Record<string, string> = { super_admin: 'Super admin', ops_admin: 'Operations admin', finance_admin: 'Finance admin', moderator: 'Moderator', support_agent: 'Support agent', analyst: 'Analyst' };

/** SCR-ADM-19 Admin users (Doc 09 §6, §19). */
function Admins() {
  usePageHeader('Admin users', 'Staff accounts and what they can do.');
  const { me, tick } = useSession();
  const u = useUrlState();
  const tab = u.get('tab', 'admins');
  const admins = useApi<AdminRow[]>(tab === 'admins' ? '/admin/admins' : null, { status: u.get('status'), role: u.get('role'), sort: u.get('sort'), t: tick });
  const roles = useApi<Role[]>('/admin/roles', { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const roleOpts = (roles.data ?? []).map((r) => ({ value: r.code, label: r.name || ROLE_NAMES[r.code]!, description: r.description }));
  const mixed = (v: string[]) => v.includes('finance_admin') && v.some((r) => ['ops_admin', 'moderator'].includes(r));
  const invite: ActionSpec = {
    title: 'Invite an admin',
    confirm: 'Send invite',
    width: 560,
    fields: [
      { name: 'email', type: 'text', label: 'Work email', required: true, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, patternMsg: 'Enter a valid email.' },
      { name: 'full_name', type: 'text', label: 'Full name', required: true, max: 80 },
      { name: 'roles', type: 'checkboxes', label: 'Roles', required: true, options: roleOpts },
    ],
    extra: (v) => (mixed((v.roles as string[]) ?? []) ? <Alert tone="warning">This mixes finance and operations duties.</Alert> : null),
    submit: (v) => post('/admin/admins', { email: v.email, full_name: v.full_name, roles: v.roles }),
    success: 'Invite sent. The link works for 24 hours.',
    onDone: admins.reload,
  };
  const rolesSpec = (a: AdminRow): ActionSpec => ({ title: `Change roles for ${a.full_name}?`, confirm: 'Save roles', width: 560, fields: [{ name: 'roles', type: 'checkboxes', label: 'Roles', required: true, default: a.roles, options: roleOpts }, reasonField()], extra: (v) => (mixed((v.roles as string[]) ?? []) ? <Alert tone="warning">This mixes finance and operations duties.</Alert> : null), submit: (v) => api(`/admin/admins/${a.id}/roles`, { method: 'PUT', body: { roles: v.roles, reason: v.reason } }).then((r) => r.data), success: 'Roles saved.', onDone: admins.reload });
  const simple = (a: AdminRow, path: string, title: string, desc: string, confirm: string, destructive: boolean, ok: string): ActionSpec => ({ title, description: desc, confirm, variant: destructive ? 'destructive' : 'primary', fields: [reasonField()], submit: (v) => post(`/admin/admins/${a.id}/${path}`, { reason: v.reason }), success: (d) => ((d as { dev_link?: string }).dev_link ? `${ok} Dev link: ${(d as { dev_link: string }).dev_link}` : ok), onDone: admins.reload });
  const supers = (roles.data ?? []).find((r) => r.code === 'super_admin')?.holders ?? 2;
  return (
    <Gate perms={['admins.manage']}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs label="Admin views" value={tab} panelId="adm" onChange={(v) => u.set({ tab: v === 'admins' ? null : v })} tabs={[{ value: 'admins', label: 'Admins' }, { value: 'roles', label: 'Roles' }]} />
        <span className="hidden laptop:inline"><Button onClick={() => setSpec(invite)}>Invite admin</Button></span>
      </div>
      {tab === 'admins' ? (
        <>
          <Toolbar>
            <FilterSelect label="Status" value={u.get('status')} onChange={(v) => u.set({ status: v })} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }]} />
            <FilterSelect label="Role" value={u.get('role')} onChange={(v) => u.set({ role: v })} options={[{ value: '', label: 'Any role' }, ...Object.entries(ROLE_NAMES).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect label="Sort" value={u.get('sort')} onChange={(v) => u.set({ sort: v })} options={[{ value: '', label: 'Name' }, { value: '-last_login_at', label: 'Last sign-in' }]} />
          </Toolbar>
          <Table<AdminRow>
            caption="Admins"
            rows={admins.data}
            loading={admins.loading}
            error={admins.error}
            rowKey={(a) => a.id}
            cols={[
              { key: 'n', header: 'Name', cell: (a) => <span className="text-fg">{a.full_name}{a.id === me.id ? ' (you)' : ''}</span> },
              { key: 'e', header: 'Email', cell: (a) => a.email },
              { key: 'r', header: 'Roles', cell: (a) => <span className="flex flex-wrap gap-1">{a.roles.map((r) => <span key={r} className="rounded-[6px] bg-muted px-2 text-label-sm leading-6 text-fg-secondary">{ROLE_NAMES[r] ?? r}</span>)}{a.mixed_duties ? <span className="rounded-full bg-info-subtle px-2 text-label-sm leading-6 text-fg-info">Mixed duties</span> : null}</span> },
              { key: 's', header: 'Status', cell: (a) => <AdminBadge kind="admin" code={a.status} /> },
              { key: 't', header: 'Second factor', cell: (a) => (a.totp_enrolled ? <span className="rounded-full bg-success-subtle px-2 text-label-sm leading-6 text-fg-success">Enrolled</span> : <span className="rounded-full bg-warning-subtle px-2 text-label-sm leading-6 text-fg-warning">Not set up</span>) },
              { key: 'l', header: 'Last sign-in', cell: (a) => rel(a.last_login_at) },
              {
                key: 'm',
                header: '',
                align: 'right',
                cell: (a) => (
                  <RowMenu
                    items={[
                      { key: 'name', label: 'Edit name', onSelect: () => setSpec({ title: 'Edit name', confirm: 'Save name', fields: [{ name: 'full_name', type: 'text', label: 'Full name', required: true, max: 80, default: a.full_name }], submit: (v) => api(`/admin/admins/${a.id}`, { method: 'PATCH', body: { full_name: v.full_name } }).then((r) => r.data), success: 'Name saved.', onDone: admins.reload }) },
                      { key: 'roles', label: 'Change roles', onSelect: () => setSpec(rolesSpec(a)) },
                      a.id !== me.id && { key: 'pw', label: 'Send password reset', onSelect: () => setSpec(simple(a, 'reset-password', `Send a password reset to ${a.full_name}?`, 'They get a link valid for 24 hours. Their sessions end.', 'Send reset link', false, 'Reset link sent.')) },
                      { key: 'totp', label: 'Reset second factor', tone: 'danger', onSelect: () => setSpec(simple(a, 'reset-totp', `Reset ${a.full_name}'s second factor?`, 'Their authenticator stops working and their sessions end. They set up a new one at next sign-in. Confirm who they are first, by a channel other than email.', 'Reset second factor', true, 'Second factor reset.')) },
                      a.status === 'active' && a.id !== me.id ? { key: 'dis', label: 'Disable', tone: 'danger', onSelect: () => setSpec(simple(a, 'disable', `Disable ${a.full_name}?`, "They're signed out now and can't sign in. Their history stays in the audit log. Then remove them from live chat, merchant wallets, Cloudflare Access and any VPN.", 'Disable admin', true, 'Admin disabled.')) } : null,
                      a.status === 'disabled' && { key: 'en', label: 'Enable', onSelect: () => setSpec(simple(a, 'enable', `Enable ${a.full_name}?`, 'They can sign in again.', 'Enable admin', false, 'Admin enabled.')) },
                    ]}
                  />
                ),
              },
            ]}
          />
        </>
      ) : (
        <>
          {supers < 2 ? <Alert tone="warning" className="mb-4">Only one super admin. Keep at least two so one can recover the other.</Alert> : null}
          <Table<Role>
            caption="Roles"
            rows={roles.data}
            loading={roles.loading}
            rowKey={(r) => r.code}
            onRowClick={(r) => setOpen(open === r.code ? null : r.code)}
            cols={[
              { key: 'c', header: 'Role', cell: (r) => <span className="adm-mono">{r.code}</span> },
              { key: 'n', header: 'Name', cell: (r) => r.name },
              { key: 'd', header: 'Description', cell: (r) => <div className="max-w-[420px]"><p>{r.description}</p>{open === r.code ? <p className="adm-mono mt-2 text-fg-secondary">{r.permissions.join(', ')}</p> : <p className="text-body-xs text-fg-brand">Show {r.permissions.length} permission keys</p>}</div> },
              { key: 'h', header: 'Holders', align: 'right', cell: (r) => r.holders },
            ]}
          />
        </>
      )}
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Admins />
    </Suspense>
  );
}
