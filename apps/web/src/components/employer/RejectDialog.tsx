'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, ChoiceChipGroup, Dialog, Switch, Textarea, toast } from '@24f/ui';
import { formatReward } from '@24f/shared';
import { api, ApiError, ek, errorText, type ReasonCode, type SubDetail } from './api';

export const REASONS: { value: ReasonCode; label: string }[] = [
  { value: 'proof_incomplete', label: 'Proof incomplete' },
  { value: 'steps_not_followed', label: 'Steps not followed' },
  { value: 'wrong_or_copied', label: 'Wrong or copied answer' },
  { value: 'link_not_accessible', label: 'Link not accessible' },
  { value: 'other', label: 'Other' },
];

/** rev.reject.template.<code> (Doc 02 §11): fills an empty reason, never overwrites typed text. */
const TEMPLATE: Partial<Record<ReasonCode, string>> = {
  proof_incomplete: 'The proof is incomplete: ',
  steps_not_followed: 'These steps weren’t followed: ',
  wrong_or_copied: 'This answer looks wrong or copied: ',
  link_not_accessible: 'The link doesn’t open for me. Change sharing to “Anyone with the link”.',
};

export interface RejectTarget {
  ref: string;
  workerName: string;
  reward: string;
  jobPublicId?: string;
  /** Known from the detail pane; otherwise loaded when the dialog opens. */
  canFix?: boolean;
  fixDefault?: boolean;
}

/** SCR-EMP-10 Reject with reason (Figma 40:2210, 560 wide; bottom sheet on mobile). */
export function RejectDialog({
  target,
  onOpenChange,
  onRejected,
}: {
  target: RejectTarget | null;
  onOpenChange: (o: boolean) => void;
  onRejected: (ref: string, res: { status: string; next_ref?: string | null }) => void;
}) {
  const open = !!target;
  const [code, setCode] = useState<ReasonCode | null>(null);
  const [text, setText] = useState('');
  const [fix, setFix] = useState(true);
  const [touched, setTouched] = useState(false);

  const detail = useQuery({
    queryKey: ek.sub(target?.ref ?? ''),
    queryFn: () => api.get<SubDetail>(`/employer/submissions/${target!.ref}`),
    enabled: open && target?.canFix === undefined,
  });
  const canFix = target?.canFix ?? detail.data?.can_allow_fix ?? false;
  const fixDefault = target?.fixDefault ?? detail.data?.fix_default ?? canFix;

  useEffect(() => {
    if (!open) return;
    setCode(null);
    setText('');
    setTouched(false);
  }, [open, target?.ref]);
  useEffect(() => setFix(fixDefault), [fixDefault, target?.ref]);

  const len = [...text.trim()].length;
  const valid = len >= 10 && len <= 300;

  const m = useMutation({
    mutationFn: () =>
      api.post<{ status: string; next_ref?: string | null }>(`/employer/submissions/${target!.ref}/reject`, {
        reason_code: code ?? 'other',
        reason_text: text.trim(),
        allow_fix: canFix && fix,
        job: target!.jobPublicId,
      }),
    onSuccess: (res) => {
      toast.show({ tone: 'success', title: 'Submission rejected', body: `The worker can see your reason. ${formatReward(target!.reward)} stays in your budget.` });
      onRejected(target!.ref, res);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALREADY_DECIDED') {
        toast.show({ tone: 'warning', title: 'This submission was already decided. We’ve refreshed the list.' });
        onRejected(target!.ref, { status: 'already_decided' });
        return;
      }
      toast.show({ tone: 'danger', title: 'That didn’t save', body: errorText(e, 'Your changes are still here. Try again.') });
    },
  });

  const submit = () => {
    setTouched(true);
    if (!valid || m.isPending) return;
    m.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !m.isPending && onOpenChange(o)}
      type="form"
      width={560}
      title="Reject this submission?"
      description={target ? `${target.workerName} will see your reason. The ${formatReward(target.reward)} stays in your budget.` : undefined}
      busy={m.isPending}
      dirty={text.trim().length > 0}
      footer={
        <>
          <Button variant="secondary" onClick={() => !m.isPending && onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            loading={m.isPending}
            loadingText="Rejecting…"
            disabled={touched && !valid}
            disabledReasonId="reject-reason-err"
          >
            Reject submission
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <ChoiceChipGroup
          legend="Quick reason"
          mode="single"
          options={REASONS}
          value={code}
          onChange={(v) => {
            const c = v as ReasonCode;
            setCode(c);
            if (!text.trim() && TEMPLATE[c]) setText(TEMPLATE[c]!);
          }}
        />
        <div>
          <Textarea
            label="Reason (required)"
            helper="Be specific — it helps the worker fix it."
            value={text}
            softMax={300}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && !valid ? 'Add a reason of at least 10 characters. The worker sees this.' : undefined}
            id="reject-reason"
          />
          <span id="reject-reason-err" className="sr-only">
            Add a reason of at least 10 characters. The worker sees this.
          </span>
        </div>
        {canFix ? (
          <div className="rounded-[12px] bg-subtle px-4 py-3">
            <Switch label="Let the worker fix and resubmit" checked={fix} onCheckedChange={setFix} />
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
