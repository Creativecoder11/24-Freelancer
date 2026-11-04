'use client';
/** SCR-SET-01 Worker profile and settings (Figma 44:757). */
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CATEGORY_SLUG, formatDateTime, type CategorySlug, type Me } from '@24f/shared';
import { ActionMenu, Avatar, Button, ChoiceChip, Dialog, EmptyState, Field, IconButton, Select, StatusBadge, Switch, Upload, toast } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { useProofUpload } from '@/components/worker/useProofUpload';
import { api, ApiError } from '@/lib/api/client';
import { meKey, useMe } from '@/lib/auth/session';
import { usePayoutMethods, type PayoutMethod } from '@/components/wallet/api';
import { AddPayoutMethodDialog, PayoutMethodActionDialog } from '@/components/wallet/PayoutMethodDialogs';
import { Section, SectionSkeleton, SettingRow, SettingsShell, type SettingsNavItem } from './SettingsShell';
import { CloseAccountSection, NotificationsSection, SecuritySection } from './account';
import { VerificationSection } from './kyc';

const HEADER = { title: 'Settings', subtitle: 'Manage your profile, payouts, security and notifications.' };
const NAV: SettingsNavItem[] = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'payout-methods', label: 'Payout methods', icon: 'wallet' },
  { id: 'verification', label: 'Verification', icon: 'shield-check' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'preferences', label: 'Preferences', icon: 'settings' },
];
const WORKER_CATEGORIES = CATEGORY_SLUG.values.filter((c) => c !== 'other') as CategorySlug[];
export const COUNTRIES = [
  { value: 'BD', label: 'Bangladesh' },
  { value: 'IN', label: 'India' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'NP', label: 'Nepal' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
];

export function WorkerSettings() {
  useWorkerHeader(HEADER);
  const me = useMe();
  const params = useSearchParams();
  const m = me.data;
  return (
    <SettingsShell items={NAV}>
      {m ? <ProfileSection me={m} /> : <SectionSkeleton id="profile" title="Profile" />}
      <PayoutMethodsSection />
      <VerificationSection autoOpen={params.get('kyc') === '1'} />
      {m ? <SecuritySection me={m} withdrawalRow /> : <SectionSkeleton id="security" title="Security" />}
      <NotificationsSection audience="worker" subtitle="Payout and security alerts are always on." />
      {m ? <PreferencesSection me={m} /> : <SectionSkeleton id="preferences" title="Preferences" />}
      <CloseAccountSection />
    </SettingsShell>
  );
}

// ---------------------------------------------------------------------------

function ProfileSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.full_name);
  const [country, setCountry] = useState(me.country_code);
  const [interests, setInterests] = useState<CategorySlug[]>(me.interests);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(false);
  useEffect(() => {
    setName(me.full_name);
    setCountry(me.country_code);
    setInterests(me.interests);
  }, [me.full_name, me.country_code, me.interests]);

  const dirty = name.trim() !== me.full_name || country !== me.country_code || [...interests].sort().join() !== [...me.interests].sort().join();
  const save = async () => {
    if (name.trim().length < 2 || name.trim().length > 80) return setError('Enter your full name (2–80 characters).');
    setBusy(true);
    setError(undefined);
    try {
      if (name.trim() !== me.full_name || country !== me.country_code) await api.patch('/me', { full_name: name.trim(), country_code: country });
      await api.put('/me/interests', { categories: interests });
      await qc.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: 'success', title: 'Changes saved.' });
    } catch (e) {
      if (e instanceof ApiError && e.fields.full_name) setError(e.fields.full_name[0]);
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="profile" title="Profile" subtitle="This is what employers see next to your submissions — partly hidden for privacy.">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar initials={me.initials} src={me.avatar_url} size="XL" name={me.full_name} />
        <div className="min-w-0 flex-1">
          <p className="text-label-lg text-fg">{me.full_name}</p>
          <p className="text-body-sm text-fg-secondary">Shown to employers as “{me.name_masked}”</p>
        </div>
        <Button variant="secondary" size="S" onClick={() => setPhoto(true)}>
          Change photo
        </Button>
      </div>
      <form className="mt-6 grid gap-x-4 gap-y-5 tablet:grid-cols-2" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={error} autoComplete="name" />
        <Field label="Email" type="email" value={me.email ?? ''} readOnly readOnlyStyle helper={me.email ? (me.email_verified_at ? 'Verified' : 'Not verified yet') : 'Not added'} />
        <Field label="Phone" value={me.phone_masked ?? ''} readOnly readOnlyStyle placeholder="Not added" helper="Used for withdrawals and sign-in codes" />
        <Select label="Country" options={COUNTRIES} value={country} onChange={setCountry} searchable />
        <fieldset className="tablet:col-span-2">
          <legend className="mb-3 text-label-md text-fg">Task interests</legend>
          <div className="flex flex-wrap gap-2">
            {WORKER_CATEGORIES.map((c) => (
              <ChoiceChip key={c} mode="multi" label={CATEGORY_SLUG.labels[c]} selected={interests.includes(c)} onClick={() => setInterests((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end tablet:col-span-2">
          <Button type="submit" size="M" disabled={!dirty} loading={busy}>
            Save changes
          </Button>
        </div>
      </form>
      <PhotoDialog open={photo} onOpenChange={setPhoto} me={me} />
    </Section>
  );
}

function PhotoDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me }) {
  const qc = useQueryClient();
  const up = useProofUpload('avatar');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) up.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = async (uploadId: string | null) => {
    setBusy(true);
    try {
      await api.post('/me/avatar', { upload_id: uploadId });
      await qc.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: 'success', title: uploadId ? 'Photo updated' : 'Photo removed' });
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
      title="Change photo"
      description="A clear photo of your face helps employers trust your work. PNG or JPG, up to 2 MB."
      busy={busy}
      footer={
        <>
          {me.avatar_url ? (
            <Button variant="tertiary" onClick={() => set(null)} disabled={busy} className="mr-auto">
              Remove photo
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => up.state.uploadId && set(up.state.uploadId)} disabled={!up.state.uploadId} loading={busy}>
            Save photo
          </Button>
        </>
      }
    >
      <Upload label="Photo" labelHidden accept="image/png,image/jpeg,image/webp" maxBytes={2 * 1024 * 1024} capture="user" phase={up.state.phase} progress={up.state.progress} file={up.state.file} error={up.state.error} onSelect={up.select} onRemove={up.reset} />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function PayoutMethodsSection() {
  const q = usePayoutMethods();
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<PayoutMethod | null>(null);
  const [action, setAction] = useState<{ m: PayoutMethod; a: 'default' | 'remove' } | null>(null);
  const rows = q.data?.data ?? [];
  return (
    <Section
      id="payout-methods"
      title="Payout methods"
      subtitle="Where we send your withdrawals. New or changed numbers can be used 24 hours after saving."
      action={
        rows.length ? (
          <Button size="S" leadingIcon="plus" onClick={() => setAdd(true)} disabled={rows.length >= (q.data?.meta.limit ?? 5)}>
            Add payout method
          </Button>
        ) : undefined
      }
    >
      {q.isError ? (
        <p className="text-body-sm text-fg-tertiary">We couldn’t load your payout methods.</p>
      ) : !q.data ? (
        <span className="block h-[68px] rounded-[12px] bg-muted" aria-busy="true" />
      ) : rows.length === 0 ? (
        <EmptyState compact icon="wallet" title="No payout methods yet" body="Add one before your first withdrawal." action={<Button size="S" onClick={() => setAdd(true)}>Add payout method</Button>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-[12px] bg-subtle px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-label-md text-fg">{m.label}</p>
                <p className="text-body-sm text-fg-secondary tabular-nums">{m.account_masked}</p>
                {m.in_cooldown ? <p className="text-body-xs text-fg-warning">Usable from {formatDateTime(m.usable_from)}</p> : null}
                {m.status === 'pending_review' ? <p className="text-body-xs text-fg-warning">Being checked by our team</p> : null}
                {!m.method_enabled ? <p className="text-body-xs text-fg-tertiary">This method isn’t available right now.</p> : null}
              </div>
              {m.is_default ? (
                <StatusBadge tone="brand" label="Default" />
              ) : m.method_enabled ? (
                <Button variant="tertiary" size="S" onClick={() => setAction({ m, a: 'default' })}>
                  Make default
                </Button>
              ) : null}
              <ActionMenu
                label={`Actions for ${m.destination_label}`}
                trigger={<IconButton icon="more-horizontal" variant="ghost" size="S" aria-label={`Actions for ${m.destination_label}`} />}
                items={[
                  ...(m.method_enabled ? [{ key: 'edit', label: 'Change number', icon: 'edit' as const, onSelect: () => setEdit(m) }] : []),
                  { key: 'remove', label: 'Remove', icon: 'trash' as const, tone: 'danger' as const, onSelect: () => setAction({ m, a: 'remove' }) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <AddPayoutMethodDialog open={add || !!edit} replace={edit} onOpenChange={(o) => (!o ? (setAdd(false), setEdit(null)) : undefined)} />
      <PayoutMethodActionDialog method={action?.m ?? null} action={action?.a ?? 'remove'} onOpenChange={(o) => !o && setAction(null)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------

function PreferencesSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const save = async (body: Record<string, unknown>) => {
    try {
      await api.patch('/me/preferences', body);
      await qc.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: 'success', title: 'Preferences saved.' });
    } catch {
      toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Try again in a moment.' });
    }
  };
  return (
    <Section id="preferences" title="Preferences">
      <div className="grid gap-5 tablet:grid-cols-2">
        <Select
          label="Default mode"
          helper="Where you land after signing in."
          options={[
            { value: 'worker', label: 'Worker' },
            { value: 'employer', label: 'Employer' },
          ]}
          value={me.default_mode ?? 'worker'}
          onChange={(v) => void save({ default_mode: v })}
        />
        <Select label="Theme" helper="Dark mode is coming later." options={[{ value: 'light', label: 'Light' }]} value="light" onChange={() => undefined} disabled />
      </div>
      <div className="mt-6">
        <SettingRow
          title="Email digest"
          description="One daily summary at 9:00 instead of separate emails."
          control={<Switch label="Email digest" labelHidden checked={me.email_digest_enabled} onCheckedChange={(v) => void save({ email_digest_enabled: v })} />}
        />
      </div>
    </Section>
  );
}
