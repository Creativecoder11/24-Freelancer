'use client';
import { Suspense, useEffect, useState } from 'react';
import { ActionMenu, Alert, Button, Checkbox, EmptyState, Search, Tabs, Textarea, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, KV, Pager, RefLink, SidePanel, SplitView, Table, Toggle, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS } from '@/components/badges';
import { api } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';

interface Row { id: string; full_name: string; email: string; topic: string; account_public_id: string | null; account_matched: boolean; message: string; status: string; assigned_admin: string | null; created_at: string }
interface Detail { id: string; full_name: string; email: string; topic: string; account_public_id: string | null; message: string; status: string; consent_at: string; created_at: string; assigned_admin_id: string | null; assigned_admin: string | null; replies: { admin: string; body: string; sent_at: string }[]; linked_user: { public_id: string; status: string; kyc_status: string } | null }

const looksPrivate = (s: string) => /(?:\+?880|0)1\d{9}|\b(?:\d[ -]?){13,19}\b/.test(s);

/** SCR-ADM-15 Support messages (Doc 09 §6, §16.1). */
function Support() {
  usePageHeader('Support messages', 'Oldest first. "Our team replies in the order requests arrive."');
  const { me, tick } = useSession();
  const u = useUrlState();
  const status = u.get('status', 'new');
  const sel = u.get('id');
  const [q, setQ] = useState('');
  const list = useApi<Row[]>('/admin/support/messages', { status, topic: u.get('topic'), assigned: u.get('mine') ? 'me' : undefined, q, page: u.get('page', '1'), t: tick }, { pollMs: 60_000 });
  const det = useApi<Detail>(sel ? `/admin/support/messages/${sel}` : null, { t: tick });
  const [body, setBody] = useState('');
  const [close, setClose] = useState(true);
  const [sending, setSending] = useState(false);
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const finance = me.roles.length === 1 && me.roles[0] === 'finance_admin';
  const d = det.data;
  useEffect(() => setBody(''), [sel]);
  const reloadAll = () => { list.reload(); det.reload(); };
  const send = async () => {
    if (!d || !body.trim()) return;
    setSending(true);
    try {
      await api(`/admin/support/messages/${d.id}/reply`, { method: 'POST', body: { body, close } });
      toast.success('Reply sent.');
      setBody('');
      reloadAll();
    } catch (e) {
      reportError(e);
    } finally {
      setSending(false);
    }
  };
  const patch = async (b: Record<string, unknown>, msg: string) => {
    try {
      await api(`/admin/support/messages/${d!.id}`, { method: 'PATCH', body: b });
      toast.success(msg);
      reloadAll();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Gate perms={['support.reply']}>
      <Tabs label="Inbox" value={status} panelId="inbox" className="mb-4" onChange={(v) => u.set({ status: v === 'new' ? null : v, id: null })} tabs={[{ value: 'new', label: 'New', count: counts.new }, { value: 'in_progress', label: 'In progress', count: counts.in_progress }, { value: 'answered', label: 'Answered' }, { value: 'closed', label: 'Closed' }, { value: 'spam', label: 'Spam' }]} />
      <SplitView
        panel={
          <SidePanel open={!!sel} onClose={() => u.set({ id: null })} title={d?.full_name ?? 'Message'} meta={d ? <span className="flex items-center gap-2"><AdminBadge kind="contact" code={d.status} /> {LABELS.topic[d.topic]}</span> : undefined}>
            {!d ? <div className="h-40 animate-pulse rounded-[12px] bg-muted" /> : (
              <>
                <section className="rounded-[12px] bg-subtle p-3">
                  <p className="whitespace-pre-wrap text-body-sm text-fg">{d.message}</p>
                  <p className="mt-2 text-body-xs text-fg-tertiary">{d.email} · {dt(d.created_at)} · consent {dt(d.consent_at)}</p>
                </section>
                {d.linked_user ? <KV items={[['Linked account', <RefLink key="u" href={`/users/${d.linked_user.public_id}`}>{d.linked_user.public_id}</RefLink>], ['Status', <AdminBadge key="s" kind="user" code={d.linked_user.status} />], ['KYC', <AdminBadge key="k" kind="kyc" code={d.linked_user.kyc_status} />], ['Assigned', d.assigned_admin ?? '—']]} /> : <p className="text-body-xs text-fg-tertiary">No matching account. Matching doesn&apos;t prove identity.</p>}
                {d.replies.length ? (
                  <div className="space-y-2">
                    <h3 className="text-label-md text-fg">Replies</h3>
                    {d.replies.map((r, i) => <div key={i} className="rounded-[12px] border border-line-subtle p-3 text-body-sm"><p className="whitespace-pre-wrap">{r.body}</p><p className="mt-1 text-body-xs text-fg-tertiary">{r.admin} · {dt(r.sent_at)}</p></div>)}
                  </div>
                ) : null}
                <div className="hidden space-y-3 laptop:block">
                  <Textarea label="Your reply" value={body} onChange={(e) => setBody(e.target.value)} softMax={5000} />
                  {looksPrivate(body) ? <Alert tone="warning">This looks like private data. Check before sending.</Alert> : null}
                  <Checkbox label="Mark as answered after sending" checked={close} onChange={(e) => setClose(e.target.checked)} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex gap-2">
                      {d.assigned_admin_id !== me.id ? <Button size="S" variant="secondary" onClick={() => void patch({ assigned_admin_id: me.id, status: d.status === 'new' ? 'in_progress' : d.status }, 'Assigned to you.')}>Assign to me</Button> : null}
                      <ActionMenu label="More" trigger={<Button size="S" variant="secondary" trailingIcon="chevron-down">More</Button>} items={[
                        { key: 'spam', label: 'Mark as spam', tone: 'danger', onSelect: () => setSpec({ title: 'Mark this as spam?', description: 'No reply is sent.', confirm: 'Mark as spam', variant: 'destructive', submit: () => api(`/admin/support/messages/${d.id}`, { method: 'PATCH', body: { status: 'spam' } }), success: 'Marked as spam.', onDone: reloadAll }) },
                        { key: 'close', label: 'Close without reply', onSelect: () => void patch({ status: 'closed' }, 'Closed.') },
                        { key: 'prog', label: 'Move to in progress', onSelect: () => void patch({ status: 'in_progress' }, 'Moved to in progress.') },
                      ]} />
                    </span>
                    <Button loading={sending} disabled={!body.trim()} disabledReasonId="reply-empty" onClick={() => void send()}>Send reply</Button>
                    <span id="reply-empty" className="sr-only">Write a reply first.</span>
                  </div>
                </div>
              </>
            )}
          </SidePanel>
        }
      >
        <Toolbar>
          <div className="w-full max-w-[300px]"><Search value={q} onValueChange={setQ} label="Search messages" placeholder="Name, email or account ID" size="M" /></div>
          {!finance ? <FilterSelect label="Topic" width={240} value={u.get('topic')} onChange={(v) => u.set({ topic: v })} options={[{ value: '', label: 'Any topic' }, ...Object.entries(LABELS.topic).map(([value, label]) => ({ value, label }))]} /> : null}
          <Toggle label="Assigned to me" on={!!u.get('mine')} onChange={(v) => u.set({ mine: v ? '1' : null })} />
        </Toolbar>
        <Table<Row>
          caption="Messages"
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.hardReload}
          rowKey={(r) => r.id}
          selectedKey={sel}
          onRowClick={(r) => u.set({ id: r.id }, false)}
          empty={status === 'new' ? <EmptyState icon="inbox" title={finance ? 'No payment messages waiting.' : "You're all caught up"} body={finance ? undefined : 'New messages from the contact form appear here.'} compact /> : <EmptyState title="Nothing here" compact />}
          cols={[
            { key: 'r', header: 'Received', cell: (r) => dt(r.created_at) },
            { key: 'f', header: 'From', cell: (r) => <div><p className="text-fg">{r.full_name}</p><p className="text-body-xs text-fg-tertiary">{r.email}</p></div> },
            { key: 't', header: 'Topic', cell: (r) => LABELS.topic[r.topic] },
            { key: 'a', header: 'Account', cell: (r) => (r.account_public_id ? <span className="flex items-center gap-1">{r.account_public_id}{r.account_matched ? <span className="rounded-full bg-success-subtle px-1.5 text-label-sm text-fg-success">Matched</span> : null}</span> : '—'), hideBelow: 'desktop' },
            { key: 'm', header: 'Message', cell: (r) => <span className="line-clamp-1 max-w-[320px]">{r.message}</span> },
            { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="contact" code={r.status} /> },
            { key: 'g', header: 'Assigned', cell: (r) => r.assigned_admin ?? '—', hideBelow: 'desktop' },
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
      <Support />
    </Suspense>
  );
}
