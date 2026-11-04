'use client';
import { LABELS } from './badges';
import { dt } from '@/lib/fmt';

export interface Attempt {
  attempt_no: number;
  worker_note: string | null;
  submitted_at: string;
  decision: string | null;
  rejection_reason_code: string | null;
  rejection_reason_text: string | null;
  auto_check: { state?: string } | null;
  proof_items: { proof_type: string; title: string; link_url: string | null; link_check_status: number | null; text_value: string | null; file_name: string | null; mime_type: string | null; file_url: string | null; file_unavailable: boolean }[];
}

/** Attempts with proof items (signed URLs) and auto-check (Doc 09 SCR-ADM-08 panel). */
export function Attempts({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return <p className="text-body-sm text-fg-tertiary">No attempts.</p>;
  return (
    <div className="space-y-3">
      {attempts.map((a) => (
        <div key={a.attempt_no} className="rounded-[12px] border border-line-subtle p-3">
          <div className="flex items-center justify-between text-label-md text-fg">
            <span>Attempt {a.attempt_no}</span>
            <span className="text-body-xs text-fg-tertiary">{dt(a.submitted_at)}</span>
          </div>
          {a.worker_note ? <p className="mt-1 text-body-sm text-fg-secondary">“{a.worker_note}”</p> : null}
          <ul className="mt-2 space-y-2">
            {a.proof_items.map((p, i) => (
              <li key={i} className="text-body-sm">
                <p className="text-body-xs text-fg-tertiary">{p.title}</p>
                {p.proof_type === 'link' && p.link_url ? (
                  <p className="break-all">
                    <a href={p.link_url} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-brand hover:underline">{p.link_url}</a>
                    {p.link_check_status ? <span className="ml-2 text-body-xs text-fg-tertiary">HTTP {p.link_check_status}</span> : null}
                  </p>
                ) : null}
                {p.text_value ? <p className="whitespace-pre-wrap text-fg">{p.text_value}</p> : null}
                {p.file_url ? (
                  p.mime_type?.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={p.file_url} target="_blank" rel="noopener noreferrer"><img src={p.file_url} alt={p.title} className="mt-1 max-h-48 rounded-[8px] border border-line" /></a>
                  ) : (
                    <a href={p.file_url} target="_blank" rel="noopener noreferrer" className="text-fg-brand hover:underline">{p.file_name ?? 'Open file'}</a>
                  )
                ) : null}
                {p.file_unavailable ? <p className="text-fg-tertiary">File no longer available</p> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-body-xs text-fg-tertiary">
            Auto-check: {a.auto_check?.state ?? '—'}
            {a.decision ? ` · Decision: ${a.decision.replace('_', ' ')}` : ''}
            {a.rejection_reason_code ? ` · ${LABELS.submissionReject[a.rejection_reason_code] ?? a.rejection_reason_code}` : ''}
          </p>
          {a.rejection_reason_text ? <p className="text-body-xs text-fg-secondary">“{a.rejection_reason_text}”</p> : null}
        </div>
      ))}
    </div>
  );
}

export const PAID_FROM: Record<string, string> = { job_reserve: 'Job budget', employer_available: "Employer's available balance", adjustments: 'Platform, recorded against the employer' };
