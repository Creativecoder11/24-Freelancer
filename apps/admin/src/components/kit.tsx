'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import {
  ActionMenu, Alert, Button, Checkbox, Dialog, Drawer, EmptyState, Field, IconButton, RadioGroup, Select, Skeleton, Switch, Textarea, Tooltip, cn, gsap, toast, useGSAP, useMediaQuery, MOTION_OK, type ActionMenuItem, type ButtonVariant,
} from '@24f/ui';
import { api, ApiError, newIdemKey, type CallOpts } from '@/lib/api';
import { reportError } from '@/lib/hooks';
import { useSession } from '@/lib/session';

// ---------------------------------------------------------------------------- table

export interface Col<T> {
  key: string;
  header: string;
  cell: (r: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Hidden below this breakpoint. */
  hideBelow?: 'laptop' | 'desktop';
}

/**
 * Data table (Doc 02 §5.49 in the admin variant): row 56, first column sticky, scrolls inside
 * its own container, skeleton rows after 200 ms, row click selects.
 */
export function Table<T>({
  cols, rows, rowKey, loading, error, onRetry, empty, onRowClick, selectedKey, caption, rowClassName,
}: {
  cols: Col<T>[];
  rows: T[] | null | undefined;
  rowKey: (r: T) => string;
  loading?: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  onRowClick?: (r: T) => void;
  selectedKey?: string | null;
  caption: string;
  rowClassName?: (r: T) => string | undefined;
}) {
  const [showSk, setShowSk] = useState(false);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!loading) return setShowSk(false);
    const t = setTimeout(() => setShowSk(true), 200);
    return () => clearTimeout(t);
  }, [loading]);
  useGSAP(
    () => {
      if (!rows?.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(body.current?.querySelectorAll('tr') ?? [], { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.02, ease: 'power2.out' });
      });
      return () => mm.revert();
    },
    { dependencies: [rows?.length ?? 0, loading] },
  );
  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;
  const hide = (c: Col<T>) => (c.hideBelow === 'laptop' ? 'hidden laptop:table-cell' : c.hideBelow === 'desktop' ? 'hidden desktop:table-cell' : '');
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface shadow-xs">
      {loading && rows?.length ? <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-brand" aria-hidden /> : null}
      <div className="adm-scroll overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line-subtle bg-subtle">
              {cols.map((c, i) => (
                <th key={c.key} scope="col" className={cn('whitespace-nowrap px-4 py-3 text-overline uppercase text-fg-tertiary', c.align === 'right' && 'text-right', i === 0 && 'sticky left-0 z-[1] bg-subtle', hide(c), c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={body} className="divide-y divide-line-subtle">
            {!rows?.length && loading ? (
              showSk ? [...Array(6)].map((_, i) => (
                <tr key={i} className="h-[52px]">
                  {cols.map((c) => (
                    <td key={c.key} className={cn('px-4', hide(c))}>
                      <span className="block h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              )) : <tr className="h-[52px]"><td colSpan={cols.length} /></tr>
            ) : !rows?.length ? (
              <tr>
                <td colSpan={cols.length}>{empty}</td>
              </tr>
            ) : (
              rows.map((r) => {
                const k = rowKey(r);
                const sel = selectedKey === k;
                return (
                  <tr
                    key={k}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    aria-selected={onRowClick ? sel : undefined}
                    className={cn('h-14 text-body-sm text-fg transition-colors', onRowClick && 'cursor-pointer', sel ? 'bg-brand-subtle' : 'hover:bg-subtle', rowClassName?.(r))}
                  >
                    {cols.map((c, i) => (
                      <td key={c.key} className={cn('px-4 py-2.5 align-middle', c.align === 'right' && 'text-right tabular-nums', i === 0 && cn('sticky left-0 z-[1]', sel ? 'bg-brand-subtle' : 'bg-surface'), hide(c), c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "We couldn't load this" }: { error?: ApiError | null; onRetry?: () => void; title?: string }) {
  if (error?.code === 'ADMIN_FORBIDDEN') return <Forbidden />;
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState icon="alert-circle" title={title} body={`Check your connection and try again.${error?.requestId ? ` Reference: ${error.requestId}` : ''}`} action={onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : undefined} />
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState icon="lock" title="You don't have access to this page." action={<Button href="/">Go to dashboard</Button>} />
    </div>
  );
}

/** Route gate: renders the error state instead of silently redirecting (Doc 09 §2.4 rule 2). */
export function Gate({ perms, children }: { perms: string[]; children: React.ReactNode }) {
  const { can } = useSession();
  return can(...perms) ? <>{children}</> : <Forbidden />;
}

export function NoResults({ onClear }: { onClear?: () => void }) {
  return <EmptyState icon="search" title="Nothing matches these filters" body="Try fewer filters or a wider date range." action={onClear ? <Button variant="secondary" onClick={onClear}>Clear filters</Button> : undefined} compact />;
}

export function Pager({ meta, onPage }: { meta?: { page?: number; total_pages?: number; total?: number; per_page?: number }; onPage: (p: number) => void }) {
  if (!meta?.total_pages || meta.total_pages <= 1) return meta?.total ? <p className="mt-3 text-body-xs text-fg-tertiary">{meta.total} total</p> : null;
  const p = meta.page ?? 1;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
      <p className="text-body-xs text-fg-tertiary">
        Page {p} of {meta.total_pages} · {meta.total} total
      </p>
      <div className="flex gap-2">
        <Button size="S" variant="secondary" disabled={p <= 1} disabledReasonId="pg-first" onClick={() => onPage(p - 1)} leadingIcon="chevron-left">Previous</Button>
        <Button size="S" variant="secondary" disabled={p >= meta.total_pages} disabledReasonId="pg-last" onClick={() => onPage(p + 1)} trailingIcon="chevron-right">Next</Button>
        <span id="pg-first" className="sr-only">You're on the first page.</span>
        <span id="pg-last" className="sr-only">You're on the last page.</span>
      </div>
    </nav>
  );
}

export function Toolbar({ children, actions, className }: { children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end gap-3', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">{children}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function FilterSelect<V extends string>({ label, value, options, onChange, width = 180 }: { label: string; value: V | ''; options: { value: V | ''; label: string }[]; onChange: (v: V | '') => void; width?: number }) {
  return (
    <div style={{ width }}>
      <Select<string> label={label} labelHidden compact={{ inlineLabel: label }} value={value} options={options.map((o) => ({ value: o.value || '__all', label: o.label }))} onChange={(v) => onChange((v === '__all' ? '' : v) as V | '')} />
    </div>
  );
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={cn('inline-flex h-9 items-center gap-2 rounded-full px-4 text-label-md transition-colors focus-visible:shadow-focus', on ? 'bg-inverse text-fg-inverse' : 'border border-line bg-surface text-fg-secondary hover:bg-subtle')}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------- layout bits

export function Section({ title, children, actions, className }: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface p-5 shadow-xs', className)}>
      {title || actions ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-h5 text-fg">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KV({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 2 && 'tablet:grid-cols-2', cols === 3 && 'tablet:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-body-xs text-fg-tertiary">{k}</dt>
          <dd className="mt-0.5 break-words text-body-sm text-fg">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Detail side panel: beside the table at ≥ 1280, right drawer from 1024 to 1279 (Doc 09 §3.1). */
export function SidePanel({ open, onClose, title, meta, children, footer, wide = true }: { open: boolean; onClose: () => void; title: string; meta?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const desk = useMediaQuery('(min-width: 1280px)');
  if (!open) return null;
  if (!desk) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={title} meta={meta} width={440} footer={footer ? <div className="hidden w-full flex-wrap justify-end gap-2 laptop:flex">{footer}</div> : undefined}>
        {children}
      </Drawer>
    );
  }
  return (
    <aside className={cn('sticky top-[96px] flex max-h-[calc(100vh-120px)] shrink-0 flex-col rounded-card border border-line bg-surface shadow-sm', wide ? 'w-[480px]' : 'w-[360px]')} aria-label={title}>
      <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-h5 text-fg">{title}</h2>
          {meta ? <div className="mt-1 text-body-sm text-fg-tertiary">{meta}</div> : null}
        </div>
        <IconButton icon="x" aria-label="Close panel" variant="ghost" size="S" tooltip={false} onClick={onClose} />
      </header>
      <div className="adm-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
      {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</footer> : null}
    </aside>
  );
}

export function SplitView({ children, panel }: { children: React.ReactNode; panel: React.ReactNode }) {
  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1">{children}</div>
      {panel}
    </div>
  );
}

export function RowMenu({ items, label = 'Row actions' }: { items: (ActionMenuItem | false | null | undefined)[]; label?: string }) {
  const list = items.filter(Boolean) as ActionMenuItem[];
  if (!list.length) return null;
  return (
    <span onClick={(e) => e.stopPropagation()} className="hidden laptop:inline-flex">
      <ActionMenu label={label} trigger={<IconButton icon="more" aria-label={label} variant="ghost" size="S" tooltip={false} />} items={list} />
    </span>
  );
}

export function Copy({ value, label = 'Copy' }: { value: string; label?: string }) {
  return (
    <IconButton
      icon="copy"
      aria-label={label}
      variant="ghost"
      size="S"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => toast.success('Copied'));
      }}
    />
  );
}

export function RefLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <NextLink href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-fg-brand hover:underline">
      {children}
    </NextLink>
  );
}

export function Truncate({ text, max = 60 }: { text: string | null | undefined; max?: number }) {
  if (!text) return <span className="text-fg-tertiary">—</span>;
  if (text.length <= max) return <>{text}</>;
  return (
    <Tooltip content={text.slice(0, 400)}>
      <span tabIndex={0}>{text.slice(0, max)}…</span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------- action dialog

export type FieldDef =
  | { name: string; type: 'textarea'; label: string; required?: boolean; max?: number; min?: number; helper?: string; default?: string; placeholder?: string }
  | { name: string; type: 'text' | 'number' | 'datetime-local' | 'date'; label: string; required?: boolean; max?: number; helper?: string; default?: string; placeholder?: string; transform?: (v: string) => string; pattern?: RegExp; patternMsg?: string }
  | { name: string; type: 'select'; label: string; required?: boolean; options: { value: string; label: string }[]; default?: string; helper?: string; onPick?: (v: string, set: (name: string, value: string) => void) => void }
  | { name: string; type: 'radio'; label: string; required?: boolean; options: { value: string; label: string; description?: string }[]; default?: string; onPick?: (v: string, set: (name: string, value: string) => void) => void }
  | { name: string; type: 'checkbox'; label: string; default?: boolean; required?: boolean; description?: string }
  | { name: string; type: 'switch'; label: string; default?: boolean; description?: string }
  | { name: string; type: 'checkboxes'; label: string; options: { value: string; label: string; description?: string }[]; default?: string[]; required?: boolean }
  | { name: string; type: 'file'; label: string; accept?: string; helper?: string; required?: boolean };

export type Values = Record<string, string | boolean | string[]>;

export interface ActionSpec {
  title: string;
  description?: React.ReactNode;
  confirm: string;
  variant?: ButtonVariant;
  fields?: FieldDef[];
  /** Live content under the fields (summary, warnings). */
  extra?: (v: Values) => React.ReactNode;
  width?: 480 | 560;
  /** Request: return [path, CallOpts] or perform it yourself and return the response data. */
  submit: (v: Values, idem: string) => Promise<unknown>;
  success?: string | ((data: unknown) => string);
  onDone?: (data: unknown) => void;
  confirmLabel?: (v: Values) => string;
}

/** Shared action dialog: reason fields, validation, Idempotency-Key per open, toasts (Doc 09 §5.4). */
export function ActionDialog({ spec, onClose }: { spec: ActionSpec | null; onClose: () => void }) {
  const idem = useMemo(() => (spec ? newIdemKey() : ''), [spec]);
  const [vals, setVals] = useState<Values>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { bump } = useSession();
  const formId = useId();
  useEffect(() => {
    if (!spec) return;
    const init: Values = {};
    for (const f of spec.fields ?? []) {
      if (f.type === 'checkbox' || f.type === 'switch') init[f.name] = f.default ?? false;
      else if (f.type === 'checkboxes') init[f.name] = f.default ?? [];
      else if (f.type !== 'file') init[f.name] = f.default ?? '';
    }
    setVals(init);
    setErrs({});
  }, [spec]);
  if (!spec) return null;
  const set = (name: string, value: string | boolean | string[]) => setVals((v) => ({ ...v, [name]: value }));
  const validate = () => {
    const e: Record<string, string> = {};
    for (const f of spec.fields ?? []) {
      const v = vals[f.name];
      if (f.type === 'checkboxes') {
        if (f.required && !(v as string[])?.length) e[f.name] = 'Choose at least one.';
        continue;
      }
      if (f.type === 'checkbox') {
        if (f.required && v !== true) e[f.name] = 'Confirm to continue.';
        continue;
      }
      if (f.type === 'switch') continue;
      const s = String(v ?? '').trim();
      if ('required' in f && f.required && !s) e[f.name] = f.type === 'textarea' && /reason|note/i.test(f.name) ? "Enter a reason. It's kept in the audit log." : 'This field is required.';
      else if ((f.type === 'textarea' || f.type === 'text') && f.max && s.length > f.max) e[f.name] = `Keep it to ${f.max} characters or fewer.`;
      else if (f.type === 'textarea' && f.min && s && s.length < f.min) e[f.name] = `Enter at least ${f.min} characters.`;
      else if (f.type === 'text' && f.pattern && s && !f.pattern.test(s)) e[f.name] = f.patternMsg ?? 'Check this value.';
    }
    setErrs(e);
    if (Object.keys(e).length) {
      const first = document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [aria-invalid="true"], #${CSS.escape(formId)} [data-err="1"]`);
      first?.focus();
    }
    return !Object.keys(e).length;
  };
  const go = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const data = await spec.submit(vals, idem);
      const msg = typeof spec.success === 'function' ? spec.success(data) : spec.success;
      const pending = (data as { status?: string } | null)?.status === 'pending_approval';
      toast.success(pending ? 'Sent for second approval.' : (msg ?? 'Done.'));
      bump();
      spec.onDone?.(data);
      onClose();
    } catch (e) {
      const fields = reportError(e);
      if (fields) setErrs(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.split('.').pop()!, v[0] ?? 'Check this value.'])));
      if (e instanceof ApiError && ['ALREADY_DECIDED', 'INVALID_STATE'].includes(e.code) && !e.fields) {
        bump();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };
  const label = spec.confirmLabel?.(vals) ?? spec.confirm;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      type={spec.fields?.length ? 'form' : spec.variant === 'destructive' ? 'destructive' : 'confirm'}
      title={spec.title}
      description={spec.description}
      width={spec.width ?? 480}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} disabledReasonId={`${formId}-busy`}>Cancel</Button>
          <Button variant={spec.variant ?? 'primary'} loading={busy} onClick={go}>{label}</Button>
          <span id={`${formId}-busy`} className="sr-only">Saving…</span>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {(spec.fields ?? []).map((f) => {
          const err = errs[f.name];
          if (f.type === 'textarea') return <Textarea key={f.name} label={f.label} helper={f.helper} error={err} value={String(vals[f.name] ?? '')} softMax={f.max} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} optional={!f.required} />;
          if (f.type === 'select') return <Select key={f.name} label={f.label} helper={f.helper} error={err} value={String(vals[f.name] ?? '') || null} options={f.options} onChange={(v) => { set(f.name, v); f.onPick?.(v, set); }} />;
          if (f.type === 'radio') return <div key={f.name} data-err={err ? 1 : 0}><RadioGroup legend={f.label} name={`${formId}-${f.name}`} value={String(vals[f.name] ?? '')} options={f.options} error={err} onChange={(v) => { set(f.name, v); f.onPick?.(v, set); }} /></div>;
          if (f.type === 'checkbox') return <Checkbox key={f.name} label={f.label} description={f.description} error={err} checked={vals[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} />;
          if (f.type === 'switch') return <Switch key={f.name} label={f.label} description={f.description} checked={vals[f.name] === true} onCheckedChange={(v) => set(f.name, v)} />;
          if (f.type === 'checkboxes')
            return (
              <fieldset key={f.name} data-err={err ? 1 : 0}>
                <legend className="mb-2 text-label-md text-fg">{f.label}</legend>
                <div className="space-y-2">
                  {f.options.map((o) => {
                    const arr = (vals[f.name] as string[]) ?? [];
                    return <Checkbox key={o.value} label={o.label} description={o.description} checked={arr.includes(o.value)} onChange={(e) => set(f.name, e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />;
                  })}
                </div>
                {err ? <p className="mt-1 text-body-xs text-fg-danger">{err}</p> : null}
              </fieldset>
            );
          if (f.type === 'file')
            return (
              <label key={f.name} className="block">
                <span className="text-label-md text-fg">{f.label}</span>
                <input
                  type="file"
                  accept={f.accept}
                  className="mt-1.5 block w-full text-body-sm file:mr-3 file:rounded-[8px] file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-label-md"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) return setErrs((x) => ({ ...x, [f.name]: 'Choose a file up to 10 MB.' }));
                    set(f.name, await file.text());
                  }}
                />
                {f.helper ? <span className="mt-1 block text-body-xs text-fg-tertiary">{f.helper}</span> : null}
                {err ? <span className="mt-1 block text-body-xs text-fg-danger">{err}</span> : null}
              </label>
            );
          return (
            <Field
              key={f.name}
              type={f.type === 'number' ? 'text' : f.type}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              label={f.label}
              helper={f.helper}
              error={err}
              placeholder={f.placeholder}
              optional={!f.required}
              value={String(vals[f.name] ?? '')}
              onChange={(e) => set(f.name, f.transform ? f.transform(e.target.value) : e.target.value)}
            />
          );
        })}
        {spec.extra?.(vals)}
      </form>
    </Dialog>
  );
}

/** Convenience: POST with idempotency key. */
export const post = <T = unknown,>(path: string, body: unknown, idem?: string, method: CallOpts['method'] = 'POST') => api<T>(path, { method, body, idem }).then((r) => r.data);

export const reasonField = (label = 'Reason', max = 500, helper = 'Kept in the audit log. Staff only.'): FieldDef => ({ name: 'reason', type: 'textarea', label, required: true, max, helper });

export function Warn({ children, tone = 'warning' }: { children: React.ReactNode; tone?: 'warning' | 'danger' | 'info' }) {
  return <Alert tone={tone}>{children}</Alert>;
}

export { Skeleton };
