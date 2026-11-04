'use client';
/** SCR-SET-02 Employer profile and settings (Figma 44:1001). */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEPOSIT_STATUS, MIN_APPROVAL_RATE, MIN_APPROVAL_RATE_LABEL, REVIEW_WINDOW_HOURS, formatDateTime, formatMoney, type DepositStatus, type PublicConfig } from '@24f/shared';
import { Alert, Avatar, Button, Dialog, EmptyState, Field, Link, Select, StatusBadge, Switch, Textarea, Upload, toast } from '@24f/ui';
import { useEmployerHeader } from '@/components/employer/shell';
import { useProofUpload } from '@/components/worker/useProofUpload';
import { api, ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/auth/session';
import { Section, SectionSkeleton, SettingRow, SettingsShell, type SettingsNavItem } from './SettingsShell';
import { CloseAccountSection, NotificationsSection, SecuritySection } from './account';

const HEADER = { title: 'Settings', subtitle: 'Business details, job defaults, billing and security.' };
const NAV: SettingsNavItem[] = [
  { id: 'business-profile', label: 'Business profile', icon: 'briefcase' },
  { id: 'job-defaults', label: 'Job defaults', icon: 'filter' },
  { id: 'billing', label: 'Billing', icon: 'wallet' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'security', label: 'Security', icon: 'lock' },
];
const DEPOSIT_METHOD: Record<string, string> = { crypto: 'Crypto', mobile_wallet: 'Mobile wallet', card: 'Card' };

interface JobDefaults {
  default_review_window_hours: number;
  default_min_approval_rate: number;
  default_auto_approve: boolean;
  default_allow_resubmission: boolean;
  default_pause_on_low_deposit: boolean;
}
interface EmployerProfile {
  public_id: string;
  business_name: string;
  initials: string;
  logo_url: string | null;
  website_url: string | null;
  industry: string | null;
  billing_email: string | null;
  about: string | null;
  verification_status: 'not_submitted' | 'pending' | 'verified' | 'rejected';
  verification_note: string | null;
  job_defaults: JobDefaults;
  recent_deposits: { ref: string; created_at: string; method: string; amount_usd: string; status: DepositStatus }[];
}

const KEY = ['employer', 'profile'] as const;

export function EmployerSettings() {
  useEmployerHeader(HEADER);
  const me = useMe();
  const profile = useQuery<EmployerProfile, ApiError>({ queryKey: KEY, queryFn: () => api.get<EmployerProfile>('/employer/profile') });
  const p = profile.data;
  return (
    <SettingsShell items={NAV}>
      {profile.isError ? (
        <Section id="business-profile" title="Business profile">
          <p className="text-body-sm text-fg-tertiary">
            We couldn’t load your profile.{' '}
            <button type="button" className="font-semibold text-fg-brand hover:underline" onClick={() => profile.refetch()}>
              Try again
            </button>
          </p>
        </Section>
      ) : p ? (
        <BusinessProfile p={p} />
      ) : (
        <SectionSkeleton id="business-profile" title="Business profile" />
      )}
      {p ? <JobDefaultsSection d={p.job_defaults} /> : <SectionSkeleton id="job-defaults" title="Job defaults" />}
      {p ? <Billing p={p} /> : <SectionSkeleton id="billing" title="Billing" />}
      <NotificationsSection audience="employer" />
      {me.data ? (
        <>
          <SecuritySection me={me.data} withdrawalRow={false} />
          <CloseAccountSection />
        </>
      ) : (
        <SectionSkeleton id="security" title="Security" />
      )}
    </SettingsShell>
  );
}

function BusinessProfile({ p }: { p: EmployerProfile }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['public', 'config'], queryFn: () => api.get<PublicConfig>('/public/config', { auth: false }), staleTime: 300_000 });
  const logo = useQuery({ queryKey: ['employer', 'logo'], queryFn: () => api.get<{ logo_url: string | null }>('/employer/profile/logo') });
  const init = { business_name: p.business_name, website_url: p.website_url ?? '', industry: p.industry ?? '', billing_email: p.billing_email ?? '', about: p.about ?? '' };
  const [v, setV] = useState(init);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  useEffect(() => setV(init), [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const industries = ((config.data as unknown as { industries?: string[] })?.industries ?? ['Retail & e-commerce', 'Technology', 'Marketing & media', 'Education', 'Finance', 'Health', 'Food & hospitality', 'Research', 'Non-profit', 'Other']).map((i) => ({ value: i, label: i }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (v.business_name.trim().length < 2 || v.business_name.trim().length > 80) e.business_name = 'Enter your business name (2–80 characters).';
    if (v.billing_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.billing_email)) e.billing_email = 'Enter a valid email address.';
    if (v.about.length > 300) e.about = 'Max 300 characters.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.patch<{ verification_requeued?: boolean }>('/employer/profile', {
        business_name: v.business_name.trim(),
        website_url: v.website_url.trim() || null,
        industry: v.industry || null,
        billing_email: v.billing_email.trim() || null,
        about: v.about.trim() || null,
      });
      await qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast.show({ tone: 'success', title: 'Changes saved.', body: r.verification_requeued ? 'Your business name changed, so we’ll verify it again.' : undefined });
    } catch (x) {
      if (x instanceof ApiError && Object.keys(x.fields).length) setErr(Object.fromEntries(Object.entries(x.fields).map(([k, m]) => [k, m[0]!])));
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const badge =
    p.verification_status === 'verified' ? <StatusBadge tone="success" label="Verified employer" /> : p.verification_status === 'pending' ? <StatusBadge tone="warning" label="Verification in review" /> : p.verification_status === 'rejected' ? <StatusBadge tone="danger" label="Not verified" /> : <StatusBadge tone="neutral" label="Not verified yet" />;

  return (
    <Section id="business-profile" title="Business profile" subtitle="Shown on your jobs so workers know who they’re working for.">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar initials={p.initials} src={logo.data?.logo_url ?? p.logo_url} size="XL" shape="square" tone="accent" name={p.business_name} />
        <div className="min-w-0 flex-1">
          <p className="text-label-lg text-fg">{p.business_name}</p>
          <div className="mt-1">{badge}</div>
        </div>
        <Button variant="secondary" size="S" onClick={() => setLogoOpen(true)}>
          Upload logo
        </Button>
      </div>
      {p.verification_status === 'rejected' && p.verification_note ? (
        <Alert tone="danger" className="mt-4">
          {p.verification_note}
        </Alert>
      ) : p.verification_status === 'not_submitted' ? (
        <p className="mt-4 text-body-sm text-fg-secondary">Add a website or billing email and save — we’ll start verifying your business automatically.</p>
      ) : null}
      <form className="mt-6 grid gap-x-4 gap-y-5 tablet:grid-cols-2" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label="Business name" value={v.business_name} onChange={(e) => setV({ ...v, business_name: e.target.value })} error={err.business_name} required />
        <Field label="Website" optional value={v.website_url} onChange={(e) => setV({ ...v, website_url: e.target.value })} error={err.website_url} placeholder="shelfwise.com" inputMode="url" />
        <Select label="Industry" options={industries} value={v.industry || null} onChange={(x) => setV({ ...v, industry: x })} searchable placeholder="Choose an industry" error={err.industry} />
        <Field label="Billing email" type="email" value={v.billing_email} onChange={(e) => setV({ ...v, billing_email: e.target.value })} error={err.billing_email} />
        <Textarea label="About your business (optional)" wrapperClassName="tablet:col-span-2" value={v.about} onChange={(e) => setV({ ...v, about: e.target.value })} softMax={300} rows={3} helper="Max 300 characters. Shown on your employer card." error={err.about} />
        <div className="flex justify-end tablet:col-span-2">
          <Button type="submit" size="M" disabled={!dirty} loading={busy}>
            Save changes
          </Button>
        </div>
      </form>
      <LogoDialog open={logoOpen} onOpenChange={setLogoOpen} hasLogo={!!(logo.data?.logo_url ?? p.logo_url)} />
    </Section>
  );
}

function LogoDialog({ open, onOpenChange, hasLogo }: { open: boolean; onOpenChange: (o: boolean) => void; hasLogo: boolean }) {
  const qc = useQueryClient();
  const up = useProofUpload('employer_logo');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) up.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = async (id: string | null) => {
    setBusy(true);
    try {
      await api.post('/employer/profile/logo', { upload_id: id });
      await qc.invalidateQueries({ queryKey: ['employer', 'logo'] });
      toast.show({ tone: 'success', title: id ? 'Logo updated' : 'Logo removed' });
      onOpenChange(false);
    } catch (e) {
      toast.show({ tone: 'danger', title: 'That didn’t save', body: e instanceof ApiError ? e.message : 'Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="form"
      title="Upload logo"
      description="Square PNG or JPG, up to 2 MB. Shown on your jobs and employer card."
      busy={busy}
      footer={
        <>
          {hasLogo ? (
            <Button variant="tertiary" className="mr-auto" onClick={() => set(null)} disabled={busy}>
              Remove logo
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => up.state.uploadId && set(up.state.uploadId)} disabled={!up.state.uploadId} loading={busy}>
            Save logo
          </Button>
        </>
      }
    >
      <Upload label="Logo" labelHidden accept="image/png,image/jpeg,image/webp" maxBytes={2 * 1024 * 1024} phase={up.state.phase} progress={up.state.progress} file={up.state.file} error={up.state.error} onSelect={up.select} onRemove={up.reset} />
    </Dialog>
  );
}

function JobDefaultsSection({ d }: { d: JobDefaults }) {
  const qc = useQueryClient();
  const [v, setV] = useState(d);
  useEffect(() => setV(d), [d]);
  const save = async (patch: Partial<JobDefaults>) => {
    const prev = v;
    setV({ ...v, ...patch });
    try {
      await api.patch('/employer/job-defaults', patch);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.show({ tone: 'success', title: 'Changes saved.' });
    } catch {
      setV(prev);
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Try again in a moment.' });
    }
  };
  return (
    <Section id="job-defaults" title="Job defaults" subtitle="Applied to every new job. You can change them per job.">
      <div className="grid gap-5 tablet:grid-cols-2">
        <Select
          label="Default review window"
          options={REVIEW_WINDOW_HOURS.map((h) => ({ value: String(h), label: `${h} hours` }))}
          value={String(v.default_review_window_hours)}
          onChange={(x) => void save({ default_review_window_hours: Number(x) })}
        />
        <Select
          label="Minimum worker approval rate"
          options={MIN_APPROVAL_RATE.map((r) => ({ value: String(r), label: MIN_APPROVAL_RATE_LABEL[r] }))}
          value={String(v.default_min_approval_rate)}
          onChange={(x) => void save({ default_min_approval_rate: Number(x) })}
        />
      </div>
      <div className="mt-6">
        <SettingRow
          title="Auto-approve when the review window ends"
          description="Recommended — keeps workers’ trust if you’re away."
          control={<Switch label="Auto-approve when the review window ends" labelHidden checked={v.default_auto_approve} onCheckedChange={(x) => void save({ default_auto_approve: x })} />}
        />
        {!v.default_auto_approve ? (
          <Alert tone="warning" className="mb-2">
            Submissions you don’t review in time will wait for you, and workers may dispute late decisions.
          </Alert>
        ) : null}
        <SettingRow
          title="Allow resubmission after a rejection"
          description="Workers can fix and resubmit while slots are open."
          control={<Switch label="Allow resubmission after a rejection" labelHidden checked={v.default_allow_resubmission} onCheckedChange={(x) => void save({ default_allow_resubmission: x })} />}
        />
        <SettingRow
          title="Pause jobs when deposit runs low"
          description="Prevents overspending; resumes when you add funds."
          control={<Switch label="Pause jobs when deposit runs low" labelHidden checked={v.default_pause_on_low_deposit} onCheckedChange={(x) => void save({ default_pause_on_low_deposit: x })} />}
        />
      </div>
    </Section>
  );
}

function Billing({ p }: { p: EmployerProfile }) {
  const rows = p.recent_deposits.slice(0, 5);
  return (
    <Section id="billing" title="Billing" subtitle="Your latest deposits. Receipts go to your billing email." action={<Link href="/employer/wallet/transactions">All transactions</Link>}>
      <Field label="Receipts are sent to" value={p.billing_email ?? 'Add a billing email in Business profile'} readOnly readOnlyStyle helper="Receipts go to your billing email." wrapperClassName="tablet:max-w-[420px]" />
      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState compact icon="credit-card" title="No deposits yet" body="Add funds to start posting jobs." action={<Button size="S" href="/employer/wallet">Add funds</Button>} />
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-line">
            <table className="hidden w-full text-left tablet:table">
              <caption className="sr-only">Recent deposits</caption>
              <thead>
                <tr className="bg-subtle">
                  {['Date', 'Method', 'Amount', 'Status', 'Reference'].map((h) => (
                    <th key={h} scope="col" className={'px-4 py-3 text-overline uppercase text-fg-tertiary' + (h === 'Amount' ? ' text-right' : '')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {rows.map((d) => (
                  <tr key={d.ref} className="text-body-md">
                    <td className="px-4 py-3 text-fg-secondary tabular-nums">{formatDateTime(d.created_at)}</td>
                    <td className="px-4 py-3">{DEPOSIT_METHOD[d.method] ?? d.method}</td>
                    <td className="px-4 py-3 text-right text-label-md tabular-nums">{formatMoney(d.amount_usd)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge enum="deposit_status" code={d.status} label={DEPOSIT_STATUS.labels[d.status]} />
                    </td>
                    <td className="px-4 py-3 text-fg-secondary">{d.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line-subtle tablet:hidden">
              {rows.map((d) => (
                <li key={d.ref} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block text-label-md">{DEPOSIT_METHOD[d.method] ?? d.method}</span>
                    <span className="block text-body-xs text-fg-tertiary">
                      {d.ref} · {formatDateTime(d.created_at)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-label-md tabular-nums">{formatMoney(d.amount_usd)}</span>
                    <StatusBadge enum="deposit_status" code={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
