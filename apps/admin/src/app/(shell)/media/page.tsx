'use client';
import { Suspense, useEffect, useState } from 'react';
import { Check, FileText, Folder, Lock } from 'lucide-react';
import { Alert, Button, Dialog, EmptyState, Search, Tabs, buttonClasses, cn, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, Pager, post, RefLink, type ActionSpec } from '@/components/kit';
import { ApiError } from '@/lib/api';
import { useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt, rel } from '@/lib/fmt';

interface FolderRow { public_id: string; name: string | null; email: string | null; files: number; size_bytes: number; kyc_files: number; last_upload_at: string | null }
interface MediaFile { id: string; folder: string; purpose: string; filename: string; mime_type: string; size_bytes: number; width_px: number | null; height_px: number | null; created_at: string; sensitive: boolean; url: string; thumb_url: string | null }
interface FolderDetail { user: { public_id: string; name: string | null; email: string | null; country_code: string; joined_at: string }; folders: { key: string; label: string; count: number }[]; kyc_hidden: boolean; can_delete: boolean; files: MediaFile[] }
interface DeleteResult { matched: number; deleted: number; skipped: number; freed_bytes: number; remaining: number; dry_run: boolean }
interface DeleteTarget { ids?: string[]; user?: string; range?: string }

const RANGE_OPTIONS = [
  { value: '' as const, label: 'Any time' },
  { value: '7d' as const, label: 'Last 7 days' },
  { value: '15d' as const, label: 'Last 15 days' },
  { value: '30d' as const, label: 'Last 30 days' },
  { value: 'older_30d' as const, label: 'Older than 30 days' },
];
const rangeLabel = (r: string | null) => RANGE_OPTIONS.find((o) => o.value === (r ?? ''))?.label.toLowerCase() ?? '';

const bytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Delete flow: count first (dry run), then a confirm dialog with the real numbers and an optional
 * reason. Files a live review still needs are skipped by the server and reported here.
 */
function useMediaDelete(onDone: () => void) {
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async (target: DeleteTarget, what: string) => {
    setBusy(true);
    try {
      const c = await post<DeleteResult>('/admin/media/delete', { ...target, dry_run: true });
      if (!c.matched) return toast.info('Nothing to delete here.');
      if (!c.deleted) return toast.info(`${plural(c.skipped, 'file')} can’t be deleted yet: still needed for a pending KYC check, a submission in review or an open dispute.`);
      setSpec({
        title: `Delete ${plural(c.deleted, 'file')}?`,
        description: (
          <span className="space-y-2">
            <span className="block">
              {what} {plural(c.deleted, 'file')} ({bytes(c.freed_bytes)}) are removed from server storage. This can&apos;t be undone.
            </span>
            {c.skipped ? <span className="block text-body-sm">{plural(c.skipped, 'file')} will be kept: still needed for a pending KYC check, a submission in review or an open dispute.</span> : null}
            {c.remaining ? <span className="block text-body-sm">{plural(c.remaining, 'more file')} match. Run it again after this to delete them.</span> : null}
          </span>
        ),
        confirm: `Delete ${plural(c.deleted, 'file')}`,
        variant: 'destructive',
        hideOptional: true,
        fields: [{ name: 'reason', type: 'textarea', label: 'Reason', max: 500, helper: 'Kept in the audit log. Staff only.' }],
        submit: (v) => post<DeleteResult>('/admin/media/delete', { ...target, reason: v.reason || undefined }),
        success: (d) => {
          const r = d as DeleteResult;
          return `Deleted ${plural(r.deleted, 'file')} · ${bytes(r.freed_bytes)} freed${r.skipped ? ` · ${r.skipped} kept` : ''}.`;
        },
        onDone,
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'We couldn’t check those files. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { start, busy, dialog: <ActionDialog spec={spec} onClose={() => setSpec(null)} /> };
}

/** Folder grid: one folder per user that has uploaded files (in the date range). */
function FolderGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const u = useUrlState();
  const { tick } = useSession();
  const [q, setQ] = useState('');
  const range = u.get('range');
  const list = useApi<FolderRow[]>('/admin/media', { q: q || undefined, range: range || undefined, page: u.get('page', '1'), t: tick });
  const meta = list.meta as { matching?: { files: number; size_bytes: number }; can_delete?: boolean } | undefined;
  const del = useMediaDelete(list.reload);
  const matching = meta?.matching;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full max-w-[420px]">
          <Search value={q} onValueChange={setQ} label="Search folders" placeholder="Public ID, name or email" size="M" />
        </div>
        <FilterSelect label="Uploaded" value={(range ?? '') as (typeof RANGE_OPTIONS)[number]['value']} options={RANGE_OPTIONS} onChange={(v) => u.set({ range: v || null, page: null })} width={230} />
        <span className="flex-1" />
        {matching ? <span className="text-body-sm text-fg-secondary">{plural(matching.files, 'file')} · {bytes(matching.size_bytes)}</span> : null}
        {/* Bulk delete by date across every folder (search narrows the view only, so it's off while searching). */}
        {meta?.can_delete && range && !q && matching?.files ? (
          <Button variant="destructive" size="S" leadingIcon="trash" loading={del.busy} onClick={() => del.start({ range }, `All media uploaded ${rangeLabel(range)}, from every folder:`)}>
            Delete all {rangeLabel(range)}
          </Button>
        ) : null}
      </div>
      {list.error ? (
        <Alert tone="danger" action={<Button size="S" variant="secondary" onClick={list.hardReload}>Try again</Button>}>We couldn&apos;t load media folders.</Alert>
      ) : list.loading && !list.data ? (
        <div className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-3 desktop:grid-cols-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-card bg-muted" />)}
        </div>
      ) : !list.data?.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon="image" title={q ? `No folders match “${q}”` : range ? `No media uploaded ${rangeLabel(range)}` : 'No media yet'} body={q ? 'Try a public ID, a name or an email.' : 'Files users upload (KYC, task proofs, photos, logos) appear here, one folder per user.'} compact />
        </div>
      ) : (
        <ul className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-3 desktop:grid-cols-4">
          {list.data.map((f) => (
            <li key={f.public_id}>
              <button
                type="button"
                onClick={() => onOpen(f.public_id)}
                className="flex w-full items-start gap-3 rounded-card border border-line bg-surface p-4 text-left shadow-xs transition-colors hover:border-line-strong hover:bg-subtle focus-visible:shadow-focus focus-visible:outline-none"
              >
                <Folder size={36} aria-hidden className="shrink-0 fill-brand-subtle text-fg-brand" strokeWidth={1.5} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label-md text-fg">{f.name || 'Unnamed user'}</span>
                  <span className="block text-body-xs text-fg-tertiary">ID {f.public_id}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-fg-secondary">
                    <span>{plural(f.files, 'file')} · {bytes(f.size_bytes)}</span>
                    {f.kyc_files ? <span className="rounded-full bg-warning-subtle px-1.5 text-label-sm text-fg-warning">KYC</span> : null}
                  </span>
                  <span className="mt-0.5 block text-body-xs text-fg-tertiary">Last upload {rel(f.last_upload_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager meta={list.meta} onPage={(p) => u.set({ page: String(p) }, false)} />
      {del.dialog}
    </>
  );
}

/** Square tile: thumbnail for images, a file icon otherwise; a check box when deleting is allowed. */
function Tile({ f, onOpen, selectable, selected, onToggle }: { f: MediaFile; onOpen: () => void; selectable: boolean; selected: boolean; onToggle: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={cn('group relative overflow-hidden rounded-card border bg-surface shadow-xs transition-colors', selected ? 'border-line-brand ring-2 ring-[var(--fl-border-brand)]' : 'border-line hover:border-line-strong')}>
      <button type="button" onClick={onOpen} className="flex w-full flex-col text-left focus-visible:shadow-focus focus-visible:outline-none">
        <span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted">
          {f.thumb_url && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.thumb_url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
          ) : (
            <FileText size={32} aria-hidden className="text-fg-tertiary" />
          )}
          {f.sensitive ? (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-inverse/80 px-2 py-0.5 text-label-sm text-fg-inverse">
              <Lock size={12} aria-hidden /> KYC
            </span>
          ) : null}
        </span>
        <span className="block min-w-0 p-3">
          <span className="block truncate text-label-sm text-fg">{f.filename}</span>
          <span className="block text-body-xs text-fg-tertiary">{bytes(f.size_bytes)} · {rel(f.created_at)}</span>
        </span>
      </button>
      {selectable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${f.filename}`}
          onClick={onToggle}
          className={cn(
            'absolute left-2 top-2 grid size-6 place-items-center rounded-[6px] border-2 shadow-sm transition-opacity focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none',
            selected ? 'border-[var(--fl-border-brand)] bg-brand text-fg-on-brand opacity-100' : 'border-white bg-black/30 text-transparent opacity-0 group-hover:opacity-100',
          )}
        >
          <Check size={14} strokeWidth={3} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Large preview: image (watermarked for KYC), PDF inline, anything else as a download. */
function Preview({ f, onClose, onDelete }: { f: MediaFile; onClose: () => void; onDelete?: () => void }) {
  const { me } = useSession();
  const image = f.mime_type.startsWith('image/');
  const pdf = f.mime_type === 'application/pdf';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      type="form"
      mobile="center"
      width={960}
      title={f.filename}
      description={`${bytes(f.size_bytes)}${f.width_px && f.height_px ? ` · ${f.width_px}×${f.height_px}` : ''} · Uploaded ${dt(f.created_at)}`}
      footer={
        <>
          {onDelete ? <Button variant="destructive" leadingIcon="trash" onClick={onDelete}>Delete</Button> : null}
          <span className="hidden flex-1 tablet:block" />
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!f.sensitive ? (
            <a href={f.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: 'primary', size: 'M' })}>
              Open in new tab
            </a>
          ) : null}
        </>
      }
    >
      <div className="relative grid h-[min(64vh,640px)] place-items-center overflow-auto rounded-[12px] bg-inverse">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.url} alt={f.filename} className="max-h-full max-w-full object-contain" />
        ) : pdf ? (
          <iframe src={f.url} title={f.filename} className="h-full w-full bg-surface" />
        ) : (
          <div className="text-center text-fg-inverse-secondary">
            <FileText size={40} aria-hidden className="mx-auto" />
            <p className="mt-2 text-body-sm">No preview for this file type.</p>
            <Button className="mt-3" variant="secondary" href={f.url}>Download</Button>
          </div>
        )}
        {f.sensitive ? <span className="adm-watermark" aria-hidden>{me.full_name} · {new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span> : null}
      </div>
    </Dialog>
  );
}

/** One user's folder: date filter, sub-folder tabs, selection and delete. */
function UserFolder({ id, onBack }: { id: string; onBack: () => void }) {
  const u = useUrlState();
  const { tick } = useSession();
  const range = u.get('range');
  const data = useApi<FolderDetail>(`/admin/media/${id}`, { range: range || undefined, t: tick });
  const [open, setOpen] = useState<MediaFile | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const sub = u.get('folder', 'all');
  const reload = data.reload;
  const del = useMediaDelete(() => {
    setSel(new Set());
    reload();
  });
  // Signed links last 5 minutes: refresh just before they expire.
  useEffect(() => {
    const t = setTimeout(reload, 270_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);
  // Selection belongs to what's on screen.
  useEffect(() => setSel(new Set()), [sub, range]);
  const d = data.data;
  const files = d ? (sub === 'all' ? d.files : d.files.filter((f) => f.folder === sub)) : [];
  const canDelete = !!d?.can_delete;
  const allOn = files.length > 0 && files.every((f) => sel.has(f.id));
  const toggle = (fid: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(fid)) n.delete(fid);
      else n.add(fid);
      return n;
    });
  const who = d ? `${d.user.name || 'this user'} (${d.user.public_id})` : 'this user';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="S" leadingIcon="arrow-left" onClick={onBack}>All folders</Button>
        {d ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-body-sm text-fg-secondary">
            <span className="text-label-md text-fg">{d.user.name || 'Unnamed user'}</span>
            <span>ID {d.user.public_id}</span>
            {d.user.email ? <span>· {d.user.email}</span> : null}
            <span>·</span>
            <RefLink href={`/users/${d.user.public_id}`}>Open user</RefLink>
          </p>
        ) : null}
        <span className="flex-1" />
        <FilterSelect label="Uploaded" value={(range ?? '') as (typeof RANGE_OPTIONS)[number]['value']} options={RANGE_OPTIONS} onChange={(v) => u.set({ range: v || null }, false)} width={230} />
        {canDelete && d?.files.length ? (
          <Button
            variant="destructive"
            size="S"
            leadingIcon="trash"
            loading={del.busy}
            onClick={() => del.start({ user: id, range: range || undefined }, range ? `Media ${who} uploaded ${rangeLabel(range)}:` : `The whole folder of ${who}:`)}
          >
            {range ? `Delete folder · ${rangeLabel(range)}` : 'Delete folder'}
          </Button>
        ) : null}
      </div>
      {data.error ? (
        <Alert tone="danger" action={<Button size="S" variant="secondary" onClick={data.hardReload}>Try again</Button>}>We couldn&apos;t load this folder.</Alert>
      ) : !d ? (
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4 desktop:grid-cols-6">
          {[...Array(12)].map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-card bg-muted" />)}
        </div>
      ) : (
        <>
          <Tabs
            label="Folders"
            value={sub}
            panelId="media-files"
            className="mb-4"
            onChange={(v) => u.set({ folder: v === 'all' ? null : v }, false)}
            tabs={[{ value: 'all', label: 'All', count: d.files.length }, ...d.folders.map((f) => ({ value: f.key, label: f.label, count: f.count }))]}
          />
          {d.kyc_hidden ? <p className="mb-3 text-body-xs text-fg-tertiary">KYC documents are hidden for your role.</p> : null}
          {canDelete && files.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-line-subtle bg-subtle px-3 py-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={allOn ? true : sel.size ? 'mixed' : false}
                onClick={() => setSel(allOn ? new Set() : new Set(files.map((f) => f.id)))}
                className="inline-flex items-center gap-2 text-label-md text-fg focus-visible:shadow-focus focus-visible:outline-none"
              >
                <span aria-hidden className={cn('grid size-5 place-items-center rounded-[5px] border', allOn || sel.size ? 'border-[var(--fl-border-brand)] bg-brand text-fg-on-brand' : 'border-line-strong bg-surface')}>
                  {allOn ? <Check size={12} strokeWidth={3} /> : sel.size ? <span className="h-0.5 w-2.5 rounded bg-current" /> : null}
                </span>
                {allOn ? 'Deselect all' : `Select all ${files.length}`}
              </button>
              <span className="text-body-sm text-fg-secondary">{sel.size ? `${sel.size} selected` : 'Hover a file to select it.'}</span>
              <span className="flex-1" />
              {sel.size ? (
                <>
                  <Button variant="tertiary" size="S" onClick={() => setSel(new Set())}>Clear</Button>
                  <Button variant="destructive" size="S" leadingIcon="trash" loading={del.busy} onClick={() => del.start({ ids: [...sel] }, 'The selected')}>
                    Delete selected ({sel.size})
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          <div id="media-files">
            {files.length ? (
              <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4 desktop:grid-cols-6">
                {files.map((f) => (
                  <li key={f.id}>
                    <Tile f={f} onOpen={() => setOpen(f)} selectable={canDelete} selected={sel.has(f.id)} onToggle={() => toggle(f.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-card border border-line bg-surface">
                <EmptyState icon="image" title={range ? `Nothing uploaded ${rangeLabel(range)}` : 'This folder is empty'} body="Nothing to show here." compact />
              </div>
            )}
          </div>
        </>
      )}
      {open ? (
        <Preview
          f={d?.files.find((x) => x.id === open.id) ?? open}
          onClose={() => setOpen(null)}
          onDelete={
            canDelete
              ? () => {
                  const f = open;
                  setOpen(null);
                  void del.start({ ids: [f.id] }, 'This file:');
                }
              : undefined
          }
        />
      ) : null}
      {del.dialog}
    </>
  );
}

function Media() {
  usePageHeader('Media', 'Every file users upload, in one folder per user. Delete old files to free storage.');
  const u = useUrlState();
  const user = u.get('user');
  return (
    <Gate perms={['users.read']}>
      {user ? <UserFolder key={user} id={user} onBack={() => u.set({ user: null, folder: null })} /> : <FolderGrid onOpen={(id) => u.set({ user: id, folder: null, page: null })} />}
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Media />
    </Suspense>
  );
}
