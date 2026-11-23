'use client';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, IconButton, Tabs, Tooltip } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, Gate, KV, Pager, post, RefLink, Table, Toggle, Toolbar, type ActionSpec } from '@/components/kit';
import { AdminBadge, LABELS, SlaCell } from '@/components/badges';
import { useApi, useNow, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';

interface Row { id: string; user_public_id: string; name_on_document: string | null; document_type: string; document_last4: string | null; status: string; submitted_at: string; review_due_at: string; duplicate_warning: boolean }
interface Detail { id: string; user: { public_id: string; full_name: string | null; country_code: string }; name_on_document: string | null; name_match_score: string | null; document_type: string; document_last4: string; front_url: string | null; back_url: string | null; selfie_url: string | null; status: string; duplicate_accounts: string[]; submitted_at: string; review_due_at: string; purged: boolean; also_viewing: string | null; rejection_reason: string | null }

const rejectFields = () => [
  { name: 'reason_code', type: 'radio' as const, label: 'Reason', required: true, options: Object.entries(LABELS.kycReject).map(([value, label]) => ({ value, label })), onPick: (v: string, set: (n: string, x: string) => void) => set('reason', LABELS.kycRejectText[v] ?? '') },
  { name: 'reason', type: 'textarea' as const, label: 'Message', required: true, max: 300, helper: 'The user sees this.' },
];

type Side = 'front' | 'back' | 'selfie';

/** Image viewer with zoom, rotate and a CSS watermark; refetches before the signed URL expires (Doc 09 §8.2). */
function Viewer({ d, onExpired }: { d: Detail; onExpired: () => void }) {
  const { me } = useSession();
  const [side, setSide] = useState<Side>('front');
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  useEffect(() => {
    const t = setTimeout(onExpired, 270_000);
    return () => clearTimeout(t);
  }, [d, onExpired]);
  if (d.purged) return <Alert tone="info">Images were removed under the retention policy.</Alert>;
  const url = { front: d.front_url, back: d.back_url, selfie: d.selfie_url }[side];
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Tabs label="Image" value={side} onChange={(v) => { setSide(v); setZoom(1); setRot(0); }} panelId="kyc-img" tabs={[{ value: 'front', label: 'Front' }, ...(d.back_url ? [{ value: 'back' as const, label: 'Back' }] : []), { value: 'selfie', label: 'Selfie' }]} />
        <span className="flex gap-1">
          <IconButton icon="minus" aria-label="Zoom out" size="S" variant="secondary" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} />
          <IconButton icon="plus" aria-label="Zoom in" size="S" variant="secondary" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} />
          <IconButton icon="rotate" aria-label="Rotate" size="S" variant="secondary" onClick={() => setRot((r) => (r + 90) % 360)} />
        </span>
      </div>
      <div id="kyc-img" className="relative grid h-[min(62vh,640px)] place-items-center overflow-auto rounded-[12px] bg-inverse">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${side} image`} onError={onExpired} style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }} className="max-h-full max-w-full object-contain transition-transform" />
        ) : (
          <p className="text-body-sm text-fg-inverse-secondary">No image</p>
        )}
        <span className="adm-watermark" aria-hidden>{me.full_name} · {new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span>
      </div>
    </div>
  );
}

/** KYC details popup: large image viewer, the facts to compare, checklist, and the decision buttons. */
function KycDialog({ d, open, onClose, onExpired, decide, onApprove, onReject, onRevoke }: { d: Detail | undefined; open: boolean; onClose: () => void; onExpired: () => void; decide: boolean; onApprove: () => void; onReject: () => void; onRevoke: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      type="form"
      mobile="center"
      width={960}
      title={d ? `Identity check · User ${d.user.public_id}` : 'Identity check'}
      description={d ? `Submitted ${dt(d.submitted_at)} · Due ${dt(d.review_due_at)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {d && decide && d.status === 'pending' ? (
            <>
              <Button variant="destructive" onClick={onReject}>Reject</Button>
              <Button onClick={onApprove}>Approve</Button>
            </>
          ) : null}
          {d && decide && d.status === 'verified' ? <Button variant="destructive" onClick={onRevoke}>Revoke verification</Button> : null}
        </>
      }
    >
      {!d ? (
        <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[min(62vh,640px)] animate-pulse rounded-[12px] bg-muted" />
          <div className="h-64 animate-pulse rounded-[12px] bg-muted" />
        </div>
      ) : (
        <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_280px]">
          <Viewer key={d.id} d={d} onExpired={onExpired} />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <RefLink href={`/users/${d.user.public_id}`}>Open user {d.user.public_id}</RefLink>
              <AdminBadge kind="kyc" code={d.status} />
            </div>
            {d.also_viewing ? <p className="text-body-xs text-fg-tertiary">Also viewing: {d.also_viewing}</p> : null}
            {d.duplicate_accounts.length ? (
              <Alert tone="warning" title="This document number is on another account">
                {d.duplicate_accounts.map((p) => <RefLink key={p} href={`/users/${p}`}>{p} </RefLink>)}
              </Alert>
            ) : null}
            <KV items={[['Name on document', d.name_on_document ?? '—'], ['Profile name', d.user.full_name ?? '—'], ['Name match', d.name_match_score ? `${Math.round(Number(d.name_match_score) * 100)}%` : '—'], ['Document', LABELS.docType[d.document_type]], ['Last 4', d.document_last4], ['Country', d.user.country_code]]} />
            {d.rejection_reason ? <Alert tone="danger" title="Rejected">{d.rejection_reason}</Alert> : null}
            <div className="rounded-[12px] bg-subtle p-3 text-body-xs text-fg-secondary">
              <p className="text-label-sm text-fg">Reviewer checklist</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>The document is genuine and unexpired.</li>
                <li>The name matches the profile.</li>
                <li>The selfie matches the document photo.</li>
                <li>The document number is not on another account.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Kyc() {
  usePageHeader('KYC review', 'Oldest first. Target: 24 hours.');
  const { can, tick } = useSession();
  const now = useNow();
  const u = useUrlState();
  const status = u.get('status', 'pending');
  const sel = u.get('id');
  const list = useApi<Row[]>('/admin/kyc', { status, overdue: u.get('overdue') ? 'true' : undefined, page: u.get('page', '1'), t: tick }, { pollMs: 60_000 });
  const detail = useApi<Detail>(sel && can('kyc.read') ? `/admin/kyc/${sel}` : null, { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const counts = (list.meta?.counts ?? {}) as Record<string, number>;
  const full = can('kyc.read');
  const d = detail.data;
  const decide = can('kyc.decide');
  // Hides the popup at once; the URL catches up a render later (no flash after a decision).
  const [dismissed, setDismissed] = useState<string | null>(null);
  const done = () => {
    setDismissed(sel);
    u.set({ id: null });
  };
  const rejectSpec = (x: Detail): ActionSpec => ({ title: 'Reject this identity check?', confirm: 'Reject', variant: 'destructive', fields: rejectFields(), submit: (v) => post(`/admin/kyc/${x.id}/reject`, { reason_code: v.reason_code, reason: v.reason }), success: 'Identity check rejected.', onDone: done });
  const revokeSpec = (x: Detail): ActionSpec => ({ title: 'Revoke this verification?', description: "The user can't withdraw until they verify again. Requested withdrawals are held.", confirm: 'Revoke', variant: 'destructive', fields: rejectFields(), submit: (v) => post(`/admin/kyc/${x.id}/revoke`, { reason_code: v.reason_code, reason: v.reason }), success: 'Verification revoked.', onDone: done });
  const approveSpec = (x: Detail): ActionSpec => ({ title: 'Approve this identity check?', description: `${x.name_on_document ?? 'This user'} becomes identity verified and can withdraw. Any referral commission waiting on this user is credited.`, confirm: 'Approve', submit: () => post(`/admin/kyc/${x.id}/approve`, {}), success: 'Identity verified.', onDone: done });
  return (
    <Gate perms={['kyc.read_status', 'kyc.read']}>
      <Tabs label="KYC status" value={status} panelId="kyc-list" className="mb-4" onChange={(v) => u.set({ status: v === 'pending' ? null : v, id: null })} tabs={[{ value: 'pending', label: 'Pending', count: counts.pending }, { value: 'verified', label: 'Verified', count: counts.verified }, { value: 'rejected', label: 'Rejected', count: counts.rejected }]} />
      <Toolbar>{status === 'pending' ? <Toggle label="Overdue" on={!!u.get('overdue')} onChange={(v) => u.set({ overdue: v ? '1' : null })} /> : null}</Toolbar>
      <Table<Row>
        caption="Identity checks"
        rows={list.data}
        loading={list.loading}
        error={list.error}
        onRetry={list.hardReload}
        rowKey={(r) => r.id}
        selectedKey={sel}
        onRowClick={full ? (r) => { setDismissed(null); u.set({ id: r.id }, false); } : undefined}
        empty={status === 'pending' ? <EmptyState icon="shield-check" title="No identity checks waiting" body="New submissions appear here. The oldest is always first." action={<Button variant="secondary" onClick={() => u.set({ status: 'verified' })}>View verified</Button>} compact /> : <EmptyState title="Nothing here yet" compact />}
        cols={[
          { key: 'u', header: 'User', cell: (r) => <RefLink href={`/users/${r.user_public_id}`}>{r.user_public_id}</RefLink> },
          ...(full ? [{ key: 'n', header: 'Name on document', cell: (r: Row) => r.name_on_document ?? '—' }] : []),
          { key: 'd', header: 'Document', cell: (r) => LABELS.docType[r.document_type] },
          ...(full ? [{ key: 'l', header: 'Last 4', cell: (r: Row) => r.document_last4 ?? '—' }] : []),
          { key: 's', header: 'Status', cell: (r) => <AdminBadge kind="kyc" code={r.status} /> },
          { key: 'sub', header: 'Submitted', cell: (r) => dt(r.submitted_at) },
          { key: 'due', header: 'Due', cell: (r) => (r.status === 'pending' ? <SlaCell due={r.review_due_at} now={now} /> : '—') },
          { key: 'dup', header: 'Duplicate', cell: (r) => (r.duplicate_warning ? <Tooltip content="Same document on another account"><span tabIndex={0} className="rounded-full bg-warning-subtle px-2 text-label-sm text-fg-warning">Duplicate</span></Tooltip> : '—') },
        ]}
      />
      <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      <KycDialog
        d={d && d.id === sel ? d : undefined}
        // Hidden while a confirm dialog is open (one modal at a time); comes back if that is cancelled.
        open={!!sel && sel !== dismissed && full && !spec}
        onClose={done}
        onExpired={detail.reload}
        decide={decide}
        onApprove={() => d && setSpec(approveSpec(d))}
        onReject={() => d && setSpec(rejectSpec(d))}
        onRevoke={() => d && setSpec(revokeSpec(d))}
      />
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Kyc />
    </Suspense>
  );
}
