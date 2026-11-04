'use client';
/** Pieces shared by Task details (SCR-WRK-07) and Fix & resubmit (SCR-WRK-08). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DisputeCreated, WorkerSubmissionDetail } from '@24f/shared';
import { DISPUTE_STATEMENT_MESSAGE, formatDate, formatDateTime, formatHoursLeft } from '@24f/shared';
import { Button, Dialog, StatusTracker, Textarea, useToast, type TrackerStep } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { wk } from '../data';
import { UploadField } from '../submit/SubmitProof';

const STAGE_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  approved: 'Approved',
  needs_fix: 'Needs fix',
  rejected: 'Rejected',
  paid_to_balance: 'Paid to balance',
};

export function trackerSteps(t: WorkerSubmissionDetail, now: number): TrackerStep[] {
  return t.tracker.map((s) => {
    const state = s.state === 'failed' ? 'problem' : s.stage === 'needs_fix' && s.state === 'current' ? 'problem' : s.state;
    let sub = '—';
    if (s.state === 'done' && s.at) sub = formatDateTime(s.at, now);
    else if (s.stage === 'in_review' && s.state === 'current' && s.due_at) sub = `Due in ${formatHoursLeft(Math.max(0, new Date(s.due_at).getTime() - now))}`;
    else if (s.stage === 'needs_fix' && s.due_at) sub = `Resubmit by ${formatDate(s.due_at, now)}`;
    else if ((s.state === 'current' || s.state === 'failed') && s.at) sub = formatDateTime(s.at, now);
    return { label: STAGE_LABEL[s.stage] ?? s.stage, sub, state } as TrackerStep;
  });
}

export function Tracker({ task, now }: { task: WorkerSubmissionDetail; now: number }) {
  return <StatusTracker steps={trackerSteps(task, now)} className="tablet:mx-auto tablet:max-w-[440px]" />;
}

/** Dispute dialog (G-07; Doc 02 §6.4.8): statement 20–1,000 chars + up to 3 evidence files. */
export function DisputeDialog({ open, onOpenChange, submissionRef }: { open: boolean; onOpenChange: (o: boolean) => void; submissionRef: string }) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<(string | null)[]>([null]);
  const [error, setError] = useState<string | undefined>();
  const m = useMutation<DisputeCreated, ApiError>({
    mutationFn: () => api.post<DisputeCreated>(`/worker/submissions/${submissionRef}/disputes`, { worker_statement: text.trim(), evidence_upload_ids: files.filter(Boolean) }),
    onSuccess: () => {
      onOpenChange(false);
      toast.show({ tone: 'success', title: 'Dispute opened', body: 'A 24 Freelancing reviewer will look at it. We’ll notify you.' });
      void qc.invalidateQueries({ queryKey: wk.all });
      router.push(`/worker/tasks/${submissionRef}`);
    },
    onError: (e) => {
      if (e.fields.worker_statement) return setError(e.fields.worker_statement[0]);
      onOpenChange(false);
      toast.show({ tone: 'danger', title: e.message || 'That didn’t save' });
      void qc.invalidateQueries({ queryKey: wk.task(submissionRef) });
    },
  });
  const len = [...text.trim()].length;
  const submit = () => {
    if (len < 20 || len > 1000) return setError(DISPUTE_STATEMENT_MESSAGE);
    setError(undefined);
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type="form"
      width={560}
      title="Dispute this decision?"
      description="A 24 Freelancing reviewer will look at your proof and the employer’s reason. You can open one dispute per task."
      busy={m.isPending}
      dirty={!!text || files.some(Boolean)}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button loading={m.isPending} loadingText="Opening…" onClick={submit}>
            Open dispute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea label="Why is this wrong?" value={text} softMax={1000} helper="At least 20 characters." error={error} onChange={(e) => setText(e.target.value)} rows={4} />
        {files.map((_, i) => (
          <UploadField
            key={i}
            type="screenshot"
            label={i === 0 ? 'Evidence (optional)' : `Evidence ${i + 1} (optional)`}
            onChange={(id) =>
              setFiles((f) => {
                const n = [...f];
                n[i] = id;
                if (id && n.length < 3 && n.every(Boolean)) n.push(null);
                return n;
              })
            }
          />
        ))}
      </div>
    </Dialog>
  );
}
