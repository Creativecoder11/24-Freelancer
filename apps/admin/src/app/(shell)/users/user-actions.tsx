'use client';
import { Alert } from '@24f/ui';
import { post, reasonField, type ActionSpec, type FieldDef } from '@/components/kit';
import { LABELS } from '@/components/badges';

const restrictionFields = (): FieldDef[] => [
  {
    name: 'reason_code',
    type: 'select',
    label: 'Reason',
    required: true,
    options: Object.entries(LABELS.restriction).map(([value, label]) => ({ value, label })),
    onPick: (v, set) => set('public_message', LABELS.restrictionMessage[v] ?? ''),
  },
  { name: 'reason', type: 'textarea', label: 'Internal note', required: true, max: 1000, helper: 'Staff only.' },
  { name: 'public_message', type: 'textarea', label: 'Message to the user', required: true, max: 300, helper: 'The user sees this.' },
  { name: 'ends', type: 'select', label: 'Ends', default: 'none', options: [{ value: 'none', label: 'No end date' }, { value: '24', label: 'In 24 hours' }, { value: '168', label: 'In 7 days' }, { value: '720', label: 'In 30 days' }] },
];

const restrictBody = (v: Record<string, unknown>) => ({
  reason_code: v.reason_code,
  reason: v.reason,
  public_message: v.public_message,
  ends_at: v.ends && v.ends !== 'none' ? new Date(Date.now() + Number(v.ends) * 3600_000).toISOString() : undefined,
});

export const restrictSpec = (id: string, done: () => void): ActionSpec => ({
  title: 'Restrict this account?',
  description: "They can still sign in, finish work they've started and appeal. They can't start jobs, publish jobs, deposit or withdraw.",
  confirm: 'Restrict account',
  variant: 'destructive',
  fields: restrictionFields(),
  submit: (v) => post(`/admin/users/${id}/restrict`, restrictBody(v)),
  success: 'Account restricted.',
  onDone: done,
});

export const suspendSpec = (id: string, sessions: number, done: () => void): ActionSpec => ({
  title: 'Suspend this account?',
  description: `They'll be signed out and can't sign in. ${sessions} sessions end now, pending withdrawals are held, and running jobs are suspended. Auto-approve keeps running so workers are still paid.`,
  confirm: 'Suspend account',
  variant: 'destructive',
  fields: restrictionFields(),
  submit: (v) => post(`/admin/users/${id}/suspend`, restrictBody(v)),
  success: (d) => {
    const r = d as { sessions_revoked: number; withdrawals_held: number };
    return `Account suspended. ${r.sessions_revoked} session${r.sessions_revoked === 1 ? '' : 's'} ended, ${r.withdrawals_held} withdrawal${r.withdrawals_held === 1 ? '' : 's'} held.`;
  },
  onDone: done,
});

export const reinstateSpec = (id: string, done: () => void): ActionSpec => ({
  title: 'Reinstate this account?',
  description: 'The account returns to Active. Suspended jobs stay suspended until you reinstate each one.',
  confirm: 'Reinstate account',
  fields: [reasonField()],
  submit: (v) => post(`/admin/users/${id}/reinstate`, { reason: v.reason }),
  success: 'Account reinstated.',
  onDone: done,
});

export const revealSpec = (id: string, onValues: (v: Record<string, string>) => void): ActionSpec => ({
  title: 'Reveal personal details?',
  description: 'This is logged with your name and reason.',
  confirm: 'Reveal',
  fields: [
    { name: 'fields', type: 'checkboxes', label: 'Fields', required: true, default: ['full_name', 'email', 'phone'], options: [{ value: 'full_name', label: 'Full name' }, { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }] },
    { name: 'reason', type: 'textarea', label: 'Why do you need this?', required: true, max: 500, helper: 'Kept in the audit log. Staff only.' },
  ],
  submit: (v) => post(`/admin/users/${id}/reveal`, { fields: v.fields, reason: v.reason }),
  success: 'Details shown for 5 minutes.',
  onDone: (d) => onValues(d as Record<string, string>),
});

export const appealSpec = (id: string, done: () => void): ActionSpec => ({
  title: 'Log an appeal for this user',
  confirm: 'Log appeal',
  fields: [{ name: 'message', type: 'textarea', label: 'What the user said', required: true, min: 20, max: 1000 }],
  submit: (v) => post(`/admin/users/${id}/appeals`, { message: v.message }),
  success: 'Appeal logged.',
  onDone: done,
});

export const decideAppealSpec = (appealId: string, done: () => void): ActionSpec => ({
  title: 'Decide this appeal',
  confirm: 'Save decision',
  fields: [
    { name: 'outcome', type: 'radio', label: 'Outcome', required: true, options: [{ value: 'upheld', label: 'Uphold the appeal, and lift the restriction' }, { value: 'denied', label: 'Deny the appeal, and keep the restriction' }] },
    { name: 'decision_note', type: 'textarea', label: 'Decision note', required: true, max: 500, helper: 'The user sees this.' },
  ],
  submit: (v) => post(`/admin/appeals/${appealId}/decide`, { outcome: v.outcome, decision_note: v.decision_note }),
  success: 'Decision saved.',
  onDone: done,
});

export const contactSpec = (id: string, done: () => void): ActionSpec => ({
  title: "Change this user's contact?",
  description: "Use this only after verifying identity. The new contact starts unverified, and we'll alert the old one.",
  confirm: 'Change contact',
  variant: 'destructive',
  fields: [
    { name: 'kind', type: 'select', label: 'Contact', required: true, default: 'email', options: [{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }] },
    { name: 'value', type: 'text', label: 'New value', required: true, max: 254 },
    reasonField(),
  ],
  submit: (v) => post(`/admin/users/${id}/contact`, { kind: v.kind, value: v.value, reason: v.reason }),
  success: 'Contact changed.',
  onDone: done,
});

export const reset2faSpec = (id: string, done: () => void): ActionSpec => ({
  title: 'Reset two-step verification?',
  description: 'Two-step turns off, all trusted devices are forgotten and every session ends. The user gets an alert on their verified contacts. Do this only after verifying identity.',
  confirm: 'Reset two-step',
  variant: 'destructive',
  fields: [reasonField()],
  submit: (v) => post(`/admin/users/${id}/reset-2fa`, { reason: v.reason }),
  success: 'Two-step reset.',
  onDone: done,
});

export const signOutSpec = (id: string, n: number, done: () => void): ActionSpec => ({
  title: 'Sign this user out everywhere?',
  description: `All ${n} sessions end now. They can sign in again unless the account is suspended.`,
  confirm: 'Sign out everywhere',
  variant: 'destructive',
  fields: [reasonField()],
  submit: (v) => post(`/admin/users/${id}/sessions/revoke`, { reason: v.reason }),
  success: (d) => `${(d as { sessions_revoked: number }).sessions_revoked} sessions ended.`,
  onDone: done,
});

/** §7.6 New adjustment (Dialog 640). */
export const adjustSpec = (prefill: { userId?: string; balances?: Record<string, string> }, done: () => void): ActionSpec => ({
  title: 'Adjust balance',
  description: 'A second admin has to approve this before anything reaches the ledger.',
  confirm: 'Send for approval',
  width: 560,
  fields: [
    { name: 'user_public_id', type: 'text', label: 'User ID', required: true, default: prefill.userId ?? '', max: 9 },
    { name: 'account_kind', type: 'select', label: 'Account', required: true, default: 'worker_earnings', options: Object.entries(LABELS.account).map(([value, label]) => ({ value, label })) },
    { name: 'sign', type: 'radio', label: 'Direction', required: true, default: '+', options: [{ value: '+', label: 'Add (+)' }, { value: '-', label: 'Deduct (−)' }] },
    { name: 'amount', type: 'text', label: 'Amount, USD', required: true, pattern: /^\d+(\.\d{1,6})?$/, patternMsg: 'Enter an amount with up to 6 decimals.' },
    { name: 'reason_code', type: 'select', label: 'Reason', required: true, options: Object.entries(LABELS.adjReason).map(([value, label]) => ({ value, label })) },
    { name: 'internal_note', type: 'textarea', label: 'Internal note', required: true, max: 1000, helper: 'Staff only.' },
    { name: 'visible_text', type: 'text', label: 'What the user sees', required: true, max: 120 },
  ],
  extra: (v) => {
    const key = { worker_earnings: 'worker_available_usd', employer_available: 'employer_available_usd', employer_reserved: 'employer_reserved_usd' }[String(v.account_kind)] ?? '';
    const cur = prefill.balances?.[key];
    const amt = Number(v.amount || 0) * (v.sign === '-' ? -1 : 1);
    const after = cur !== undefined ? Number(cur) + amt : null;
    return (
      <div className="space-y-2">
        {after !== null ? <p className="text-body-sm text-fg-secondary">Current balance ${Number(cur).toFixed(2)} → after this ${after.toFixed(2)}.</p> : null}
        {after !== null && after < 0 ? <Alert tone="warning">This takes the balance below zero. Withdrawals or publishing stay blocked until it&apos;s repaid.</Alert> : null}
        {Math.abs(amt) > 500 ? <Alert tone="info">Only a super admin can approve this.</Alert> : null}
      </div>
    );
  },
  submit: (v, idem) => post('/admin/ledger/adjustments', { user_public_id: v.user_public_id, account_kind: v.account_kind, amount: `${v.sign === '-' ? '-' : ''}${v.amount}`, reason_code: v.reason_code, internal_note: v.internal_note, visible_text: v.visible_text }, idem),
  success: 'Sent for approval.',
  onDone: done,
});
