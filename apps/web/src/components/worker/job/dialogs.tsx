'use client';
/** Job-detail overlays (Doc 02 §6.4.4, G-07/G-08): Release slot, Report job, Slot expired. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { JOB_REPORT_REASON, JOB_REPORT_REASON_WORKER_LABEL, type ReleaseResponse } from '@24f/shared';
import { Button, Dialog, Select, Textarea, useToast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { wk } from '../data';

export function ReleaseDialog({ open, onOpenChange, reservationId, publicId }: { open: boolean; onOpenChange: (o: boolean) => void; reservationId: string; publicId: string }) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const m = useMutation<ReleaseResponse, ApiError>({
    mutationFn: () => api.post<ReleaseResponse>(`/worker/reservations/${reservationId}/release`),
    onSuccess: () => {
      onOpenChange(false);
      toast.show({ tone: 'success', title: 'Slot released', body: 'Your draft was removed. You can start another job.' });
      void qc.invalidateQueries({ queryKey: wk.all });
      qc.removeQueries({ queryKey: wk.job(publicId) });
      router.push('/worker/jobs');
    },
    onError: (e) => {
      toast.show({ tone: 'danger', title: 'That didn’t save', body: e.message || 'Your changes are still here. Try again.' });
      void qc.invalidateQueries({ queryKey: wk.job(publicId) });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="destructive"
      title="Release this slot?"
      description="Another worker can take it. Your draft will be removed."
      busy={m.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Keep my slot
          </Button>
          <Button variant="destructive" loading={m.isPending} loadingText="Releasing…" onClick={() => m.mutate()}>
            Release slot
          </Button>
        </>
      }
    />
  );
}

const REASONS = JOB_REPORT_REASON.values.map((v) => ({ value: v as string, label: JOB_REPORT_REASON_WORKER_LABEL[v] ?? v }));

export function ReportDialog({ open, onOpenChange, publicId }: { open: boolean; onOpenChange: (o: boolean) => void; publicId: string }) {
  const toast = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; details?: string }>({});
  const m = useMutation<unknown, ApiError>({
    mutationFn: () => api.post(`/jobs/${encodeURIComponent(publicId)}/reports`, { reason, details: details.trim() || null }),
    onSuccess: () => {
      onOpenChange(false);
      setReason(null);
      setDetails('');
      toast.show({ tone: 'success', title: 'Report sent', body: 'Thanks. Our team will take a look.' });
    },
    onError: (e) => {
      if (e.code === 'ALREADY_REPORTED') {
        onOpenChange(false);
        toast.show({ tone: 'info', title: e.message });
        return;
      }
      if (Object.keys(e.fields).length) setErrors({ reason: e.fields.reason?.[0], details: e.fields.details?.[0] });
      else toast.show({ tone: 'danger', title: 'That didn’t save', body: 'Your changes are still here. Try again.' });
    },
  });
  const submit = () => {
    const next: typeof errors = {};
    if (!reason) next.reason = 'Choose a reason.';
    if (reason === 'other' && !details.trim()) next.details = 'Tell us what’s wrong.';
    if ([...details].length > 300) next.details = 'Keep the details under 300 characters.';
    setErrors(next);
    if (!Object.keys(next).length) m.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="form"
      title="Report this job"
      description="Tell us what’s wrong. The employer won’t see who reported it."
      busy={m.isPending}
      dirty={!!reason || !!details}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button loading={m.isPending} loadingText="Sending…" onClick={submit}>
            Send report
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Reason" placeholder="Choose a reason" options={REASONS} value={reason} onChange={(v) => setReason(v)} error={errors.reason} />
        <Textarea
          label="Details (optional)"
          optional
          value={details}
          softMax={300}
          onChange={(e) => setDetails(e.target.value)}
          error={errors.details}
          rows={3}
        />
      </div>
    </Dialog>
  );
}

export function ExpiredDialog({ open }: { open: boolean }) {
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={() => undefined}
      dismissible={false}
      title="Your slot expired"
      description="The timer ended, so the slot went back to the job. You can start again if slots remain."
      footer={<Button onClick={() => router.push('/worker/jobs')}>Back to Find jobs</Button>}
    />
  );
}
