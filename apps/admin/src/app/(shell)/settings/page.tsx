'use client';
import { Suspense, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, Field, IconButton, Select, Switch, Tabs, Textarea, toast } from '@24f/ui';
import { usePageHeader } from '@/components/shell';
import { ActionDialog, FilterSelect, Gate, KV, post, Section, Table, Toolbar, type ActionSpec } from '@/components/kit';
import { Kpi } from '@/components/charts';
import { api, ApiError } from '@/lib/api';
import { reportError, useApi, useUrlState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { dt } from '@/lib/fmt';

interface Setting { key: string; value: unknown; value_type: string; description: string; source_ref: string; is_public: boolean; group: string; group_label: string; money: boolean; super_only: boolean; confirm_class: 'C1' | 'C2' | 'C3'; applies_to: string; rule: { type: string; min?: number; max?: number; enum?: string[]; list?: string; nullable?: boolean }; editable: boolean; updated_by: string | null; updated_at: string }
interface Method { method_type: string; display_name: string; subtitle: string; account_label: string; account_regex: string; payout_currency: string; min_usd: string; max_per_request_usd: string; max_per_day_usd: string; fee_fixed_usd: string; fee_percent: string; quick_amounts_usd: string[]; eta_text: string; execution: string; treasury_system_code: string; enabled: boolean; feature_flag_on: boolean; requested_count: number; updated_by: string | null; updated_at: string }
interface Rate { id: string; quote_currency: string; direction: string; rate: string; source: string; margin_percent: string; effective_from: string; created_by: string | null; note: string | null; change_percent: string | null }
interface Current { quote_currency: string; direction: string; rate: string | null; source?: string; set_by?: string | null; age_hours?: number; state: string }

const show = (v: unknown) => (v === null ? 'Not set. Hidden on the site.' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v));

/** Review-change dialog (UF-32): before/after diff, reason, class C3 key confirmation. */
function EditSetting({ s, initial, onClose, onSaved }: { s: Setting; initial?: unknown; onClose: () => void; onSaved: () => void }) {
  const list = s.rule.type === 'json' && Array.isArray(s.value);
  const [raw, setRaw] = useState<string>(list ? (s.value as unknown[]).join('\n') : s.value === null ? '' : String(initial ?? s.value));
  const [bool, setBool] = useState<boolean>(initial !== undefined ? Boolean(initial) : Boolean(s.value));
  const [reason, setReason] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const cls = (s.key === 'withdrawals_paused' || s.key === 'deposits_paused') && bool === false ? 'C3' : s.confirm_class;
  const next = (): unknown => {
    if (s.rule.type === 'boolean') return bool;
    if (list) {
      const items = raw.split('\n').map((x) => x.trim()).filter(Boolean);
      return s.rule.list === 'str' || typeof (s.value as unknown[])[0] === 'string' ? items : items.map(Number);
    }
    if (s.rule.type === 'number' || s.rule.type === 'integer') return raw === '' ? null : Number(raw);
    return raw.trim() === '' ? null : raw;
  };
  const before = Array.isArray(s.value) ? (s.value as unknown[]).map(String) : [];
  const after = list ? raw.split('\n').map((x) => x.trim()).filter(Boolean) : [];
  const save = async () => {
    const e: Record<string, string> = {};
    if (!reason.trim()) e.reason = "Enter a reason. It's kept in the audit log.";
    if (cls === 'C3' && confirmKey !== s.key) e.confirm_key = 'Type the setting name to confirm.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<{ applies_to: string }>(`/admin/settings/${s.key}`, { method: 'PATCH', body: { value: next(), reason, expected_updated_at: s.updated_at, confirm_key: confirmKey || undefined } });
      toast.success(`Saved. Applies to: ${r.data.applies_to}.`);
      onSaved();
      onClose();
    } catch (x) {
      if (x instanceof ApiError && x.code === 'SETTING_CONFLICT') setStale(true);
      else if (x instanceof ApiError && x.code === 'SETTING_OUT_OF_RANGE') setErr({ value: x.message });
      else {
        const fe = reportError(x);
        if (fe) setErr(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} type="form" width={560} title="Review this change" busy={busy} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save change</Button></>}>
      <div className="space-y-4">
        <p className="adm-mono text-fg-secondary">{s.key}</p>
        {stale ? <Alert tone="warning" title="Someone else changed this setting. Reload and try again." action={<Button size="S" variant="secondary" onClick={() => { onSaved(); onClose(); }}>Reload</Button>}>Your typed value is kept below for comparison.</Alert> : null}
        {s.source_ref.startsWith('D-') ? <Alert tone="warning">This value is a client decision ({s.source_ref}). Check it&apos;s been approved.</Alert> : null}
        {s.rule.type === 'boolean' ? (
          <Switch label={s.description} checked={bool} onCheckedChange={setBool} />
        ) : list ? (
          <Textarea label="Values, one per line" value={raw} onChange={(e) => setRaw(e.target.value)} error={err.value} autoGrow />
        ) : s.rule.enum ? (
          <Select label="Value" value={raw} onChange={setRaw} error={err.value} options={s.rule.enum.map((v) => ({ value: v, label: v }))} />
        ) : (
          <Field label="Value" value={raw} onChange={(e) => setRaw(e.target.value)} error={err.value} helper={s.rule.min !== undefined ? `Allowed ${s.rule.min} to ${s.rule.max}.` : s.rule.nullable ? 'Leave empty to hide it on the site.' : undefined} />
        )}
        <table className="w-full text-body-sm">
          <thead><tr className="text-left text-overline uppercase text-fg-tertiary"><th className="py-1">Before</th><th className="py-1">After</th></tr></thead>
          <tbody>
            {list ? (
              <tr className="align-top"><td className="py-1 pr-3"><ul>{before.filter((b) => !after.includes(b)).map((b) => <li key={b} className="text-fg-danger">− {b}</li>)}</ul><p className="text-body-xs text-fg-tertiary">{before.length} items</p></td><td className="py-1"><ul>{after.filter((a) => !before.includes(a)).map((a) => <li key={a} className="text-fg-success">+ {a}</li>)}</ul><p className="text-body-xs text-fg-tertiary">{after.length} items</p></td></tr>
            ) : (
              <tr><td className="adm-mono py-1 pr-3">{show(s.value)}</td><td className="adm-mono py-1">{show(next())}</td></tr>
            )}
          </tbody>
        </table>
        <p className="text-body-xs text-fg-tertiary">Applies to: {s.applies_to}</p>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={err.reason} softMax={500} helper="Kept in the audit log. Staff only." />
        {cls === 'C3' ? <Field label="Type the setting name to confirm" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} error={err.confirm_key} placeholder={s.key} /> : null}
      </div>
    </Dialog>
  );
}

function Platform() {
  const { tick } = useSession();
  const u = useUrlState();
  const data = useApi<Setting[]>('/admin/settings', { t: tick });
  const [edit, setEdit] = useState<{ s: Setting; v?: unknown } | null>(null);
  const groups = (data.meta?.groups as { code: string; label: string }[] | undefined) ?? [];
  const g = u.get('group', groups[0]?.code ?? 'incident');
  const rows = (data.data ?? []).filter((s) => s.group === g);
  if (data.error) return <Alert tone="danger">We couldn&apos;t load settings.</Alert>;
  return (
    <div className="grid gap-5 desktop:grid-cols-[220px_1fr]">
      <nav aria-label="Setting groups" className="flex gap-1 overflow-x-auto desktop:flex-col">
        {groups.map((x) => (
          <button key={x.code} type="button" onClick={() => u.set({ group: x.code })} aria-current={g === x.code ? 'page' : undefined} className={`shrink-0 rounded-[10px] px-3 py-2 text-left text-label-md ${g === x.code ? 'bg-brand-subtle text-fg-brand' : 'text-fg-secondary hover:bg-subtle'}`}>{x.label}</button>
        ))}
      </nav>
      <div className="space-y-3">
        {data.loading && !data.data ? [...Array(5)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-card bg-muted" />) : null}
        {rows.map((s) => (
          <section key={s.key} className="flex flex-wrap items-start gap-4 rounded-card border border-line bg-surface p-4 shadow-xs">
            <div className="min-w-0 flex-1">
              <p className="text-label-md text-fg">{s.description}</p>
              <p className="adm-mono mt-0.5 text-fg-tertiary">{s.key}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.is_public ? <span className="rounded-full bg-info-subtle px-2 text-label-sm leading-5 text-fg-info">Public</span> : null}
                {s.source_ref.startsWith('D-') ? <span className="rounded-full bg-accent-subtle px-2 text-label-sm leading-5 text-fg-accent">{s.source_ref}</span> : null}
                {s.super_only ? <span className="rounded-full bg-muted px-2 text-label-sm leading-5 text-fg-secondary">Super admin only</span> : null}
                <span className="text-body-xs text-fg-tertiary">Last changed {dt(s.updated_at)}{s.updated_by ? ` by ${s.updated_by}` : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {s.rule.type === 'boolean' ? (
                <Switch label={s.description} labelHidden checked={Boolean(s.value)} disabled={!s.editable} locked={!s.editable} lockedReason="Your role can't change this." onCheckedChange={(v) => setEdit({ s, v })} />
              ) : (
                <span className="adm-mono max-w-[320px] truncate rounded-[8px] bg-subtle px-2 py-1 text-fg" title={show(s.value)}>{show(s.value)}</span>
              )}
              {s.editable && s.rule.type !== 'boolean' ? <IconButton icon="edit" aria-label={`Edit ${s.key}`} variant="secondary" size="S" onClick={() => setEdit({ s })} /> : null}
            </div>
          </section>
        ))}
        {!data.loading && !rows.length ? <EmptyState title="No settings in this group" compact /> : null}
      </div>
      {edit ? <EditSetting s={edit.s} initial={edit.v} onClose={() => setEdit(null)} onSaved={data.reload} /> : null}
    </div>
  );
}

function PayoutMethods() {
  const { can, tick } = useSession();
  const data = useApi<Method[]>('/admin/settings/payout-methods', { t: tick });
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const write = can('payout_configs.write');
  const editSpec = (m: Method): ActionSpec => ({
    title: `Edit ${m.display_name}`,
    description: 'New quotes use these values. Withdrawals already requested keep theirs.',
    confirm: 'Save changes',
    width: 560,
    fields: [
      { name: 'enabled', type: 'switch', label: 'Show this method', default: m.enabled },
      { name: 'min_usd', type: 'text', label: 'Minimum withdrawal, USD', default: m.min_usd, required: true },
      { name: 'max_per_request_usd', type: 'text', label: 'Maximum per request, USD', default: m.max_per_request_usd, required: true },
      { name: 'max_per_day_usd', type: 'text', label: 'Maximum per day, USD', default: m.max_per_day_usd, required: true },
      { name: 'fee_fixed_usd', type: 'text', label: 'Fixed fee, USD', default: m.fee_fixed_usd, required: true },
      { name: 'fee_percent', type: 'text', label: 'Percentage fee', default: m.fee_percent, required: true },
      { name: 'quick_amounts_usd', type: 'text', label: 'Quick amounts (comma-separated)', default: m.quick_amounts_usd.join(', ') },
      { name: 'eta_text', type: 'text', label: 'Arrival text', default: m.eta_text, required: true, max: 80 },
      { name: 'execution', type: 'select', label: "How it's paid", default: m.execution, options: [{ value: 'manual', label: 'Manual' }, { value: 'api', label: 'API (needs a contracted provider)' }] },
      ...(m.method_type === 'usdt_trc20' && !m.enabled ? [{ name: 'legal_advice_on_file', type: 'checkbox' as const, label: 'Written legal advice is on file' }] : []),
      { name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' },
    ],
    extra: (v) => (
      <div className="space-y-2">
        {m.method_type === 'usdt_trc20' && v.enabled && !m.enabled ? <Alert tone="warning">Crypto payouts may conflict with Bangladesh Bank&apos;s position. Don&apos;t turn this on until written legal advice is recorded (D-35).</Alert> : null}
        {!v.enabled && m.enabled && m.requested_count ? <Alert tone="info">{m.requested_count} requested withdrawals still use this method.</Alert> : null}
      </div>
    ),
    submit: (v) => api(`/admin/settings/payout-methods/${m.method_type}`, { method: 'PATCH', body: { ...v, quick_amounts_usd: String(v.quick_amounts_usd).split(',').map((x) => x.trim()).filter(Boolean) } }).then((r) => r.data),
    success: 'Payout method saved.',
    onDone: data.reload,
  });
  return (
    <div className="grid gap-4 desktop:grid-cols-2">
      {(data.data ?? []).map((m) => (
        <Section key={m.method_type} title={`${m.display_name} · ${m.subtitle}`} actions={<span className="flex items-center gap-2"><span className={`rounded-full px-2 text-label-sm leading-6 ${m.enabled ? 'bg-success-subtle text-fg-success' : 'bg-muted text-fg-secondary'}`}>{m.enabled ? 'Shown' : 'Hidden'}</span>{write ? <span className="hidden laptop:inline"><Button size="S" variant="secondary" onClick={() => setSpec(editSpec(m))}>Edit</Button></span> : null}</span>}>
          <KV cols={2} items={[['Minimum', `$${m.min_usd}`], ['Maximum per request', `$${m.max_per_request_usd}`], ['Maximum per day', `$${m.max_per_day_usd}`], ['Fixed fee', `$${m.fee_fixed_usd}`], ['Percentage fee', `${m.fee_percent}%`], ['Quick amounts', m.quick_amounts_usd.map((q) => `$${q}`).join(', ')], ['Arrival text', m.eta_text], ["How it's paid", m.execution], ['Currency', m.payout_currency], ['Treasury', m.treasury_system_code], ['Account format', <span key="r" className="adm-mono">{m.account_regex}</span>], ['Last changed', `${dt(m.updated_at)}${m.updated_by ? ` by ${m.updated_by}` : ''}`]]} />
          {!m.feature_flag_on ? <p className="mt-2 text-body-xs text-fg-tertiary">Switched off by its feature flag.</p> : null}
        </Section>
      ))}
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </div>
  );
}

function Fx() {
  const { can, tick } = useSession();
  const u = useUrlState();
  const data = useApi<Rate[]>('/admin/settings/fx-rates', { quote_currency: u.get('cur'), direction: u.get('dir'), t: tick });
  const current = (data.meta?.current as Current[] | undefined) ?? [];
  const [spec, setSpec] = useState<ActionSpec | null>(null);
  const addSpec = (confirmLarge = false, prefill?: Record<string, string>): ActionSpec => ({
    title: 'Add a rate',
    description: 'The rate takes effect now. Withdrawals already requested keep their locked rate.',
    confirm: 'Save rate',
    fields: [
      { name: 'quote_currency', type: 'select', label: 'Currency', required: true, default: prefill?.quote_currency ?? 'BDT', options: [{ value: 'BDT', label: 'BDT' }, { value: 'USDT', label: 'USDT' }] },
      { name: 'direction', type: 'radio', label: 'Used for', required: true, default: prefill?.direction ?? 'payout', options: [{ value: 'payout', label: 'Payouts' }, { value: 'deposit', label: 'Deposits' }] },
      { name: 'rate', type: 'text', label: '1 USD equals', required: true, default: prefill?.rate ?? '', pattern: /^\d+(\.\d{1,6})?$/, patternMsg: 'Enter a rate above 0 with up to 6 decimals.' },
      { name: 'note', type: 'text', label: 'Why (optional)', max: 200, default: prefill?.note ?? '' },
      ...(confirmLarge ? [{ name: 'confirm_large_change', type: 'checkbox' as const, label: `I've checked this rate. It's ${prefill?.pct ?? ''}% from the current one.`, required: true }] : []),
    ],
    extra: (v) => {
      const cur = current.find((c) => c.quote_currency === v.quote_currency && c.direction === v.direction)?.rate;
      const r = Number(v.rate);
      if (!cur || !r) return null;
      const pct = ((r - Number(cur)) / Number(cur)) * 100;
      return (
        <div className="space-y-1 text-body-sm text-fg-secondary">
          <p>Change from current: {pct >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(2)}%</p>
          {v.quote_currency === 'BDT' ? <p>A $10.00 bKash withdrawal would pay ৳{Math.floor(10 * r).toLocaleString('en-US')}.</p> : null}
        </div>
      );
    },
    submit: async (v) => {
      try {
        return await post('/admin/settings/fx-rates', { quote_currency: v.quote_currency, direction: v.direction, rate: v.rate, note: v.note || undefined, confirm_large_change: v.confirm_large_change === true });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'FX_CHANGE_CONFIRM_REQUIRED') {
          const pct = String(e.details?.change_percent ?? '');
          setTimeout(() => setSpec(addSpec(true, { quote_currency: String(v.quote_currency), direction: String(v.direction), rate: String(v.rate), note: String(v.note ?? ''), pct })), 0);
          throw new ApiError(0, 'REAUTH_CANCELLED', 'confirm');
        }
        throw e;
      }
    },
    success: 'Rate saved.',
    onDone: data.reload,
  });
  return (
    <div className="space-y-5">
      <div className="grid gap-4 tablet:grid-cols-3">
        {current.map((c) => (
          <Kpi key={`${c.quote_currency}${c.direction}`} label={`USD → ${c.quote_currency} · ${c.direction}`} value={Number(c.rate ?? 0)} display={c.rate ? `1 USD = ${c.quote_currency === 'BDT' ? '৳' : ''}${c.rate}${c.quote_currency === 'USDT' ? ' USDT' : ''}` : '—'} tone={c.state === 'stale' ? 'danger' : undefined} sub={c.rate ? `${c.state === 'stale' ? 'Stale, blocking' : c.state === 'old' ? 'Getting old' : 'Current'} · ${c.age_hours} h old · ${c.source}${c.set_by ? ` · ${c.set_by}` : ''}` : 'No rate'} />
        ))}
      </div>
      <Toolbar actions={can('fx.write') ? <span className="hidden laptop:inline"><Button onClick={() => setSpec(addSpec())}>Add rate</Button></span> : null}>
        <FilterSelect label="Currency" value={u.get('cur')} onChange={(v) => u.set({ cur: v })} options={[{ value: '', label: 'Any currency' }, { value: 'BDT', label: 'BDT' }, { value: 'USDT', label: 'USDT' }]} />
        <FilterSelect label="Used for" value={u.get('dir')} onChange={(v) => u.set({ dir: v })} options={[{ value: '', label: 'Any' }, { value: 'payout', label: 'Payouts' }, { value: 'deposit', label: 'Deposits' }]} />
      </Toolbar>
      <Table<Rate> caption="Rate history" rows={data.data} loading={data.loading} rowKey={(r) => r.id} cols={[{ key: 'e', header: 'Effective', cell: (r) => dt(r.effective_from) }, { key: 'c', header: 'Currency', cell: (r) => r.quote_currency }, { key: 'd', header: 'Direction', cell: (r) => r.direction }, { key: 'r', header: 'Rate', align: 'right', cell: (r) => r.rate }, { key: 's', header: 'Source', cell: (r) => r.source }, { key: 'm', header: 'Margin', align: 'right', cell: (r) => `${r.margin_percent}%` }, { key: 'b', header: 'Set by', cell: (r) => r.created_by ?? '—' }, { key: 'n', header: 'Note', cell: (r) => r.note ?? '—' }, { key: 'x', header: 'Change', align: 'right', cell: (r) => (r.change_percent ? `${Number(r.change_percent) >= 0 ? '+' : '−'}${Math.abs(Number(r.change_percent)).toFixed(2)}%` : '—') }]} />
      <ActionDialog spec={spec} onClose={() => setSpec(null)} />
    </div>
  );
}

/** SCR-ADM-18 Settings (Doc 09 §6, §17, §18). */
function Settings() {
  usePageHeader('Settings', 'Every change is logged with the old and new value.');
  const { can } = useSession();
  const u = useUrlState();
  const tabs = [...(can('settings.read') ? [{ value: 'platform', label: 'Platform' }] : []), ...(can('payout_configs.read') ? [{ value: 'payout-methods', label: 'Payout methods' }, { value: 'fx', label: 'FX' }] : [])];
  const tab = u.get('tab', tabs[0]?.value ?? 'platform');
  return (
    <Gate perms={['settings.read', 'payout_configs.read']}>
      <Tabs label="Settings" value={tab} panelId="set" className="mb-5" onChange={(v) => u.set({ tab: v, group: null })} tabs={tabs} />
      <div id="set">
        {tab === 'platform' ? <Platform /> : null}
        {tab === 'payout-methods' ? <PayoutMethods /> : null}
        {tab === 'fx' ? <Fx /> : null}
      </div>
    </Gate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
