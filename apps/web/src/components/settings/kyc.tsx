'use client';
/** Verification section and the KYC wizard (G-06, Dialog 560, A-12). */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { documentNumberValid, formatDate, KYC_DOCUMENT_TYPE, type KycDocumentType } from '@24f/shared';
import { Alert, Button, Dialog, Field, Icon, RadioGroup, Upload, cn } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { useProofUpload } from '@/components/worker/useProofUpload';
import { useKyc, wal } from '@/components/wallet/api';
import { Section } from './SettingsShell';

const DOC_LABEL: Record<KycDocumentType, string> = { national_id: 'National ID', passport: 'Passport', driving_licence: 'Driving licence' };
const NUMBER_HINT: Record<KycDocumentType, string> = {
  national_id: '10, 13 or 17 digits',
  passport: '1–2 letters and 7 digits, like A1234567',
  driving_licence: '8–16 letters and numbers',
};

export function VerificationSection({ autoOpen }: { autoOpen?: boolean }) {
  const kyc = useKyc();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen && kyc.data?.can_submit) setOpen(true);
  }, [autoOpen, kyc.data?.can_submit]);
  const k = kyc.data;
  return (
    <Section id="verification" title="Verification" subtitle="Required before your first withdrawal. Your documents are only used to confirm your identity.">
      {kyc.isError ? (
        <p className="text-body-sm text-fg-tertiary">We couldn’t load your verification status.</p>
      ) : !k ? (
        <span className="block h-[72px] rounded-[14px] bg-muted" aria-busy="true" />
      ) : k.status === 'verified' ? (
        <StatusBox tone="success" icon="check-circle" title="Identity verified">
          {k.document_type ? DOC_LABEL[k.document_type] : 'Document'} · verified {k.verified_at ? formatDate(k.verified_at) : ''}
          {k.verified_at && new Date(k.verified_at).getFullYear() === new Date().getFullYear() ? `, ${new Date(k.verified_at).getFullYear()}` : ''}. You can withdraw to any method you’ve added.
        </StatusBox>
      ) : k.status === 'pending' ? (
        <StatusBox tone="warning" icon="clock" title="We’re reviewing your documents">
          This takes up to 24 h{k.review_due_at ? ` (by ${formatDate(k.review_due_at)})` : ''}. We’ll notify you when it’s done.
        </StatusBox>
      ) : k.status === 'rejected' ? (
        <StatusBox
          tone="danger"
          icon="alert-circle"
          title="We couldn’t verify your documents"
          action={
            k.can_submit ? (
              <Button size="S" onClick={() => setOpen(true)}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {k.rejection_reason ?? 'Upload clearer photos and try again.'}
          {!k.can_submit ? ' You’ve used all your verification attempts. Contact support.' : ''}
        </StatusBox>
      ) : (
        <StatusBox
          tone="neutral"
          icon="shield-check"
          title="Not verified yet"
          action={
            <Button size="S" onClick={() => setOpen(true)}>
              Verify identity
            </Button>
          }
        >
          It takes about 3 minutes: a photo of your ID and a selfie.
        </StatusBox>
      )}
      <KycWizard open={open} onOpenChange={setOpen} />
    </Section>
  );
}

function StatusBox({ tone, icon, title, children, action }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: 'check-circle' | 'clock' | 'alert-circle' | 'shield-check'; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const bg = { success: 'bg-success-subtle', warning: 'bg-warning-subtle', danger: 'bg-danger-subtle', neutral: 'bg-subtle' }[tone];
  const fg = { success: 'text-fg-success', warning: 'text-fg-warning', danger: 'text-fg-danger', neutral: 'text-fg-secondary' }[tone];
  return (
    <div className={cn('flex flex-wrap items-center gap-4 rounded-[14px] p-4 tablet:px-5', bg)}>
      <Icon name={icon} size={24} className={fg} />
      <div className="min-w-0 flex-1">
        <p className="text-label-md text-fg">{title}</p>
        <p className="mt-0.5 text-body-md text-fg-secondary">{children}</p>
      </div>
      {action}
    </div>
  );
}

function KycWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [docType, setDocType] = useState<KycDocumentType>('national_id');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [dob, setDob] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const front = useProofUpload('kyc_document');
  const back = useProofUpload('kyc_document');
  const selfie = useProofUpload('kyc_selfie');

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErr({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsBack = docType !== 'passport';
  const step1 = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name_on_document = 'Enter your name exactly as it appears on the document.';
    if (!documentNumberValid(docType, number)) e.document_number = `Check the document number (${NUMBER_HINT[docType]}).`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) e.date_of_birth = 'Enter your date of birth.';
    else {
      const d = new Date(`${dob}T00:00:00Z`);
      const cut = new Date();
      cut.setUTCFullYear(cut.getUTCFullYear() - 18);
      if (d > cut) e.date_of_birth = 'You must be 18 or older to verify.';
    }
    setErr(e);
    if (!Object.keys(e).length) setStep(2);
  };
  const step2 = () => {
    const e: Record<string, string> = {};
    if (!front.state.uploadId) e.front = 'Upload a clear photo of the front, under 10 MB.';
    if (needsBack && !back.state.uploadId) e.back = 'Upload a clear photo of the back, under 10 MB.';
    setErr(e);
    if (!Object.keys(e).length) setStep(3);
  };
  const submit = async () => {
    if (!selfie.state.uploadId) return setErr({ selfie: 'Upload a selfie holding your document.' });
    setBusy(true);
    setErr({});
    try {
      await api.post('/me/kyc', {
        document_type: docType,
        name_on_document: name.trim(),
        document_number: number,
        date_of_birth: dob,
        front_upload_id: front.state.uploadId,
        back_upload_id: needsBack ? back.state.uploadId : null,
        selfie_upload_id: selfie.state.uploadId,
      });
      void qc.invalidateQueries({ queryKey: wal.kyc });
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: wal.summary });
      setStep(4);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErr(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k, m[0]!])));
        if (e.fields.document_number || e.fields.name_on_document || e.fields.date_of_birth) setStep(1);
      } else setErr({ root: e instanceof ApiError ? e.message : 'That didn’t send. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const uploadProps = (u: ReturnType<typeof useProofUpload>) => ({ phase: u.state.phase, progress: u.state.progress, file: u.state.file, error: u.state.error, onSelect: u.select, onRemove: u.reset });
  const titles = ['Choose your document', 'Upload your document', 'Take a selfie', 'Documents submitted'];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      type={step === 4 ? 'success' : 'form'}
      width={560}
      title={step === 4 ? 'Documents submitted' : 'Verify your identity'}
      description={step === 4 ? 'We’ll review within 24 h.' : `Step ${step} of 3 · ${titles[step - 1]}`}
      busy={busy}
      dirty={step > 1 && step < 4}
      footer={
        step === 4 ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => (step === 1 ? onOpenChange(false) : setStep(step - 1))} disabled={busy}>
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            <Button onClick={step === 1 ? step1 : step === 2 ? step2 : submit} loading={busy} disabled={step === 2 && (front.state.phase === 'uploading' || back.state.phase === 'uploading')}>
              {step === 3 ? 'Submit for review' : 'Continue'}
            </Button>
          </>
        )
      }
    >
      {err.root ? <Alert tone="danger" className="mb-4">{err.root}</Alert> : null}
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <RadioGroup legend="Document type" name="kyc-doc" value={docType} onChange={(v) => setDocType(v)} options={KYC_DOCUMENT_TYPE.values.map((v) => ({ value: v, label: DOC_LABEL[v] }))} />
          <Field label="Name on the document" value={name} onChange={(e) => setName(e.target.value)} error={err.name_on_document} autoComplete="name" />
          <Field label="Document number" value={number} onChange={(e) => setNumber(e.target.value)} error={err.document_number} helper={NUMBER_HINT[docType]} autoComplete="off" />
          <Field label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} error={err.date_of_birth} max={new Date().toISOString().slice(0, 10)} />
        </div>
      ) : step === 2 ? (
        <div className="flex flex-col gap-4">
          <Upload label="Front" title="Front of your document" helper="Show the whole document. All corners and text must be readable." accept="image/png,image/jpeg,application/pdf" maxBytes={10 * 1024 * 1024} capture="environment" {...uploadProps(front)} />
          {err.front ? <p className="text-body-sm text-fg-danger">{err.front}</p> : null}
          {needsBack ? (
            <>
              <Upload label="Back" title="Back of your document" helper="Show the whole document. All corners and text must be readable." accept="image/png,image/jpeg,application/pdf" maxBytes={10 * 1024 * 1024} capture="environment" {...uploadProps(back)} />
              {err.back ? <p className="text-body-sm text-fg-danger">{err.back}</p> : null}
            </>
          ) : null}
        </div>
      ) : step === 3 ? (
        <div className="flex flex-col gap-3">
          <Upload label="Selfie" title="A selfie holding your document" helper="A clear photo of your face, without glasses or a hat." accept="image/png,image/jpeg" maxBytes={10 * 1024 * 1024} capture="user" {...uploadProps(selfie)} />
          {err.selfie ? <p className="text-body-sm text-fg-danger">{err.selfie}</p> : null}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-[14px] bg-success-subtle p-4">
          <Icon name="check-circle" size={24} className="text-fg-success" />
          <p className="text-body-md text-fg-secondary">You’ll get a notification as soon as your identity is verified.</p>
        </div>
      )}
    </Dialog>
  );
}
