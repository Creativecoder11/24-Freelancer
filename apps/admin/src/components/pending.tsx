'use client';
import { Button } from '@24f/ui';
import { dt } from '@/lib/fmt';

export interface Pending { id: string; action: string; payload: Record<string, unknown>; reason: string; requested_by: string; requested_by_me: boolean; requested_at: string }

/** Pending dual-control card (Doc 09 §4.4): approve/decline only for a different admin. */
export function PendingCard({ p, canApprove, onApprove, onDecline }: { p: Pending; canApprove: boolean; onApprove: () => void; onDecline: () => void }) {
  return (
    <section className="rounded-[12px] border border-line-warning bg-warning-subtle p-3">
      <p className="text-label-md text-fg">Awaiting second approval · {p.action.replace(/\./g, ' ').replace(/_/g, ' ')}</p>
      <p className="mt-1 text-body-sm text-fg-secondary">
        Requested by {p.requested_by} · {dt(p.requested_at)}
      </p>
      <dl className="mt-1 text-body-xs text-fg-secondary">
        {Object.entries(p.payload)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k}>
              <dt className="inline">{k.replace(/_/g, ' ')}: </dt>
              <dd className="adm-mono inline text-fg">{String(v)}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-1 text-body-xs text-fg-secondary">Reason: {p.reason}</p>
      {p.requested_by_me ? (
        <p className="mt-2 text-body-xs text-fg-tertiary">Waiting on another admin.</p>
      ) : canApprove ? (
        <div className="mt-2 hidden gap-2 laptop:flex">
          <Button size="S" variant="secondary" onClick={onDecline}>Decline</Button>
          <Button size="S" onClick={onApprove}>Approve</Button>
        </div>
      ) : null}
    </section>
  );
}
