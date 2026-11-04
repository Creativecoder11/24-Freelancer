'use client';
import { useMemo, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, Field, Select, Switch, Textarea, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { Gate, Section, Table } from '@/components/kit';
import { api, ApiError } from '@/lib/api';
import { reportError, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';

interface Hist { broadcast_id: string; title: string; recipient_count: number; sent_by: string | null; created_at: string; status: string }

/** SCR-ADM-17 Broadcast (Doc 09 §6, §16.4). Sending needs a preview matching the current form. */
export default function BroadcastPage() {
  usePageHeader('Broadcast', 'Send a System notification to a group of users.');
  const { tick, bump } = useSession();
  const hist = useApi<Hist[]>('/admin/notifications/broadcast', { t: tick });
  const [f, setF] = useState({ audience: 'all', status: 'active', kyc_status: 'any', country_code: '', active_days: '0', title: '', body: '', link_path: '', send_email: false, reason: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; count: number; token: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => JSON.stringify({ ...f, send_email: undefined, reason: undefined }), [f]);
  const valid = preview && preview.key === key;
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const payload = () => ({ segment: { audience: f.audience, status: f.status, kyc_status: f.kyc_status, country_code: f.country_code || undefined, active_days: Number(f.active_days) || undefined }, title: f.title, body: f.body, link_path: f.link_path || undefined });
  const doPreview = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Enter a title.';
    if (!f.body.trim()) e.body = 'Enter a message.';
    if (f.link_path && (!f.link_path.startsWith('/') || f.link_path.startsWith('//'))) e.link_path = 'Use a same-site path that starts with /.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<{ recipient_count: number; confirm_token: string }>('/admin/notifications/broadcast/preview', { method: 'POST', body: payload() });
      setPreview({ key, count: r.data.recipient_count, token: r.data.confirm_token });
    } catch (err) {
      const fe = reportError(err);
      if (fe) setErrs(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.split('.').pop()!, v[0] ?? ''])));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!f.reason.trim()) return setErrs({ reason: "Enter a reason. It's kept in the audit log." });
    setBusy(true);
    try {
      const r = await api<{ recipient_count: number }>('/admin/notifications/broadcast', { method: 'POST', body: { ...payload(), confirm_token: preview!.token, send_email: f.send_email, reason: f.reason } });
      toast.success(`Sent to ${r.data.recipient_count} users.`);
      setConfirm(false);
      setPreview(null);
      setF((x) => ({ ...x, title: '', body: '', link_path: '', reason: '' }));
      bump();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_STATE') {
        toast.warning(err.message);
        setPreview(null);
        setConfirm(false);
      } else reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate perms={['broadcast.send']}>
      <div className="grid gap-5 desktop:grid-cols-[minmax(0,640px)_1fr]">
        <Section title="Compose">
          <div className="grid gap-4 tablet:grid-cols-2">
            <Select label="Who" value={f.audience} onChange={(v) => set('audience', v)} options={[{ value: 'all', label: 'All users' }, { value: 'workers', label: 'Workers' }, { value: 'employers', label: 'Employers' }]} />
            <Select label="Account status" value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'active', label: 'Active' }, { value: 'active_restricted', label: 'Active and restricted' }]} helper="Suspended and closed accounts never receive it." />
            <Select label="KYC" value={f.kyc_status} onChange={(v) => set('kyc_status', v)} options={[{ value: 'any', label: 'Any' }, { value: 'not_submitted', label: 'Not submitted' }, { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} />
            <Select label="Active in the last" value={f.active_days} onChange={(v) => set('active_days', v)} options={[{ value: '0', label: 'Any time' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <Field label="Country" optional value={f.country_code} maxLength={2} onChange={(e) => set('country_code', e.target.value.toUpperCase())} helper="Two-letter code, like BD." />
          </div>
          <div className="mt-4 space-y-4">
            <Field label="Title" value={f.title} error={errs.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />
            <Textarea label="Message" value={f.body} error={errs.body} softMax={300} onChange={(e) => set('body', e.target.value)} />
            <Field label="Link (optional)" optional value={f.link_path} error={errs.link_path} placeholder="/worker/jobs" onChange={(e) => set('link_path', e.target.value)} />
            <Switch label="Also send by email" description="Respects each user's “Tips and product news” preference." checked={f.send_email} onCheckedChange={(v) => set('send_email', v)} />
            {preview && preview.key === key ? (preview.count ? <Alert tone="info">{preview.count} users match this group.</Alert> : <Alert tone="warning">No users match this group. Change the filters.</Alert>) : preview ? <Alert tone="warning">The form changed. Preview again.</Alert> : null}
            <div className="hidden flex-wrap justify-end gap-2 laptop:flex">
              <Button variant="secondary" loading={busy && !confirm} onClick={() => void doPreview()}>Preview recipients</Button>
              <Button disabled={!valid || !preview?.count} disabledReasonId="bc-hint" onClick={() => setConfirm(true)}>Review and send</Button>
              <span id="bc-hint" className="sr-only">Preview the recipients first.</span>
            </div>
          </div>
        </Section>
        <Section title="Preview">
          <div className="flex gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-xs">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
            <div className="min-w-0">
              <p className="text-label-md text-fg">{f.title || 'Notification title'}</p>
              <p className="mt-0.5 text-body-sm text-fg-secondary">{f.body || 'Your message appears here.'}</p>
              <p className="mt-1 text-body-xs text-fg-tertiary">System · just now</p>
            </div>
          </div>
        </Section>
      </div>
      <Section title="History" className="mt-5">
        <Table<Hist> caption="Broadcast history" rows={hist.data} loading={hist.loading} rowKey={(h) => h.broadcast_id} empty={<EmptyState title="Nothing sent yet." compact />} cols={[{ key: 't', header: 'Title', cell: (h) => h.title }, { key: 'n', header: 'Recipients', align: 'right', cell: (h) => h.recipient_count }, { key: 'b', header: 'Sent by', cell: (h) => h.sent_by ?? '—' }, { key: 'c', header: 'Sent', cell: (h) => dt(h.created_at) }, { key: 's', header: 'Status', cell: (h) => h.status }]} />
      </Section>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        type="destructive"
        title={`Send to ${preview?.count ?? 0} users?`}
        description={`This can't be recalled. They'll get a System notification titled "${f.title}"${f.send_email ? ' and an email' : ''}.`}
        busy={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" loading={busy} onClick={() => void send()}>Send to {preview?.count ?? 0} users</Button>
          </>
        }
      >
        <Textarea label="Why this is being sent" value={f.reason} error={errs.reason} softMax={500} onChange={(e) => set('reason', e.target.value)} helper="Kept in the audit log. Staff only." />
      </Dialog>
    </Gate>
  );
}
