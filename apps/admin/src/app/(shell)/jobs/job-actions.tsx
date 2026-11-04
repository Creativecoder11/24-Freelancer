'use client';
import { Alert } from '@24f/ui';
import { post, reasonField, type ActionSpec } from '@/components/kit';
import { LABELS } from '@/components/badges';
import { usd } from '@/lib/fmt';

export interface JobPreview { suspend_release_usd: string; reinstate_reserve_usd: string; close_release_usd: string; counts: { active_reservations: number; in_review: number }; in_review: { ref: string; worker_name_masked: string; submitted_at: string; reward_usd: string }[]; unit_cost_usd: string }

export const suspendJobSpec = (id: string, p: { active?: number; release?: string } | null, done: () => void): ActionSpec => ({
  title: 'Suspend this job?',
  description: p
    ? `It leaves all job lists now. ${p.active ?? 0} workers in progress lose their slot and are told why. ${usd(p.release ?? '0')} of free budget returns to the employer's deposit. Submissions already sent stay reserved.`
    : 'It leaves all job lists now. Workers in progress lose their slot and are told why. Free budget returns to the employer\'s deposit. Submissions already sent stay reserved.',
  confirm: 'Suspend job',
  variant: 'destructive',
  fields: [reasonField('Reason', 300, 'The employer sees this.')],
  submit: (v) => post(`/admin/jobs/${id}/suspend`, { reason: v.reason }),
  success: (d) => `Job suspended. ${usd((d as { released_usd: string }).released_usd)} returned.`,
  onDone: done,
});

export const reinstateJobSpec = (id: string, amount: string, done: () => void): ActionSpec => ({
  title: 'Reinstate this job?',
  description: `It goes back to Running and ${usd(amount)} is reserved again from the employer's deposit. Review timers continue from where they stopped.`,
  confirm: `Reinstate · ${usd(amount)}`,
  fields: [reasonField()],
  submit: (v, idem) => post(`/admin/jobs/${id}/reinstate`, { reason: v.reason }, idem),
  success: 'Job reinstated.',
  onDone: done,
});

export const clearFlagSpec = (id: string, done: () => void): ActionSpec => ({
  title: 'Clear this flag?',
  description: 'The job stays live and leaves the moderation queue. A later edit is screened again.',
  confirm: 'Clear flag',
  fields: [reasonField()],
  submit: (v) => post(`/admin/jobs/${id}/clear-flag`, { reason: v.reason }),
  success: 'Flag cleared.',
  onDone: done,
});

export const closeJobSpec = (id: string, p: JobPreview, done: () => void): ActionSpec => ({
  title: 'Close this job as admin?',
  description: `This can't be undone. ${p.in_review.length} submissions waiting for review will be approved and paid, unless you mark them to reject below. ${usd(p.close_release_usd)} of unused budget returns to the deposit.`,
  confirm: 'Close job',
  variant: 'destructive',
  width: 560,
  fields: [
    ...(p.in_review.length
      ? [{ name: 'reject', type: 'checkboxes' as const, label: 'Reject instead of paying', options: p.in_review.map((s) => ({ value: s.ref, label: `${s.ref} · ${s.worker_name_masked}`, description: `Submitted ${new Date(s.submitted_at).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` })) }]
      : []),
    { name: 'rejection_reason_code', type: 'select' as const, label: 'Rejection reason (for rejected items)', default: 'steps_not_followed', options: Object.entries(LABELS.submissionReject).map(([value, label]) => ({ value, label })) },
    reasonField(),
  ],
  extra: () => <Alert tone="info">Suspect fake work? Tick every item to reject, or suspend first.</Alert>,
  confirmLabel: (v) => {
    const rej = ((v.reject as string[]) ?? []).length;
    const n = p.in_review.length - rej;
    return `Close job · pay ${n} · ${usd((n * Number(p.unit_cost_usd)).toFixed(2))}`;
  },
  submit: (v, idem) => post(`/admin/jobs/${id}/close`, { reason: v.reason, reject_refs: v.reject ?? [], rejection_reason_code: v.rejection_reason_code }, idem),
  success: (d) => {
    const r = d as { approved_count: number; rejected_count: number; released_usd: string };
    return `Job closed. ${r.approved_count} approved, ${r.rejected_count} rejected, ${usd(r.released_usd)} returned.`;
  },
  onDone: done,
});
