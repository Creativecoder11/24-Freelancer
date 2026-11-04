'use client';
/** SCR-REF-01 Referral dashboard (Figma 43:477). */
import { useRef } from 'react';
import { formatDate, formatMoney } from '@24f/shared';
import { Button, EmptyState, Icon, Link, Skeleton, StatCard, gsap, toast, useGSAP, MOTION_CONDITIONS } from '@24f/ui';
import { useWorkerHeader } from '@/components/worker/shell';
import { LoadError } from '@/components/worker/ui';
import { useReferralSummary, type Friend, type ReferralSummary } from './api';
import { FriendAvatar, RemindButton } from './shared';

const HEADER = { title: 'Referral', subtitle: 'Invite friends and earn from what they do.' };

function shareLinks(s: ReferralSummary) {
  const url = encodeURIComponent(s.link);
  const text = encodeURIComponent(s.share_message);
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);
  return [
    { label: 'WhatsApp', href: `https://wa.me/?text=${text}` },
    { label: 'Messenger', href: mobile ? `fb-messenger://share?link=${url}` : `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${url}&text=${encodeURIComponent(s.share_message.replace(s.link, '').trim())}` },
  ];
}

export async function copyInvite(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.show({ tone: 'info', title: 'Link copied', body: 'Share it anywhere — your code is already in it.' });
  } catch {
    toast.show({ tone: 'danger', title: 'Couldn’t copy', body: 'Select the text and copy it yourself.' });
  }
}

export function ReferralPage() {
  useWorkerHeader(HEADER);
  const q = useReferralSummary();
  const s = q.data;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} body={q.error.code === 'FEATURE_DISABLED' ? 'The referral program is paused right now.' : undefined} />;

  return (
    <div className="mx-auto flex w-full max-w-[1104px] flex-col gap-6">
      {s ? <Hero s={s} /> : <Skeleton height={272} radius={20} />}

      <div className="grid grid-cols-2 gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
        {s ? (
          <>
            <StatCard type="default" compact label="Friends joined" value={String(s.stats.friends_joined)} countUp />
            <StatCard type="default" compact label="Active friends" value={String(s.stats.active_friends)} countUp />
            <StatCard type="default" compact label="From their tasks" value={formatMoney(s.stats.from_tasks_usd)} countUp />
            <StatCard type="default" compact label="From their deposits" value={formatMoney(s.stats.from_deposits_usd)} countUp />
            <StatCard type="trend" compact label="Total earned" value={formatMoney(s.stats.total_earned_usd)} trendPercent={null} valueTone="success" countUp className="col-span-2 tablet:col-span-1" />
          </>
        ) : (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={104} radius={16} />)
        )}
      </div>

      <HowItWorks pct={s?.rate_label ?? '5%'} />

      <div className="grid gap-6 desktop:grid-cols-[minmax(0,1fr)_352px]">
        <section aria-labelledby="your-friends" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
          <div className="flex items-center justify-between">
            <h2 id="your-friends" className="text-label-lg text-fg">
              Your friends
            </h2>
            {s && s.stats.friends_joined > 0 ? <Link href="/worker/referral/friends">View all {s.stats.friends_joined}</Link> : null}
          </div>
          {!s ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={56} />
              ))}
            </div>
          ) : s.top_friends.length === 0 ? (
            <EmptyState compact icon="users" title="No friends yet" body="Share your link. You earn 5% when they complete tasks or make deposits." action={<Button size="S" onClick={() => copyInvite(s.link)}>Copy link</Button>} />
          ) : (
            <ul className="mt-2 divide-y divide-line-subtle">
              {s.top_friends.map((f) => (
                <FriendLine key={f.id} f={f} />
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="comm-status" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-6">
          <h2 id="comm-status" className="text-label-lg text-fg">
            Commission status
          </h2>
          {s ? (
            <>
              <dl className="mt-4 divide-y divide-line-subtle">
                {[
                  ['Added to balance', s.commission_status.added_to_balance_usd],
                  ['Pending (friends’ tasks in review)', s.commission_status.pending_usd],
                  ['Not eligible (self / duplicate)', s.commission_status.not_eligible_usd],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-4 py-4">
                    <dt className="text-body-md text-fg-secondary">{k}</dt>
                    <dd className="text-label-md tabular-nums text-fg">{formatMoney(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 border-t border-line-subtle pt-4 text-body-xs text-fg-tertiary">
                Commission: {s.rate_label} of approved task rewards and {s.rate_label} of deposits. Self-referrals and duplicate accounts don’t earn commission.
              </p>
            </>
          ) : (
            <Skeleton height={160} className="mt-4" />
          )}
        </section>
      </div>
    </div>
  );
}

function Hero({ s }: { s: ReferralSummary }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_CONDITIONS, (ctx) => {
        if (ctx.conditions?.reduce) return;
        gsap.from('[data-hero]', { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.06, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  const display = s.link.replace(/^https?:\/\//, '');
  return (
    <section ref={ref} aria-labelledby="ref-hero" className="grid gap-8 rounded-[20px] bg-inverse p-6 tablet:p-10 desktop:grid-cols-[minmax(0,1fr)_480px] desktop:items-center">
      <div>
        <p data-hero className="text-overline uppercase text-fg-inverse-secondary">
          Your referral program
        </p>
        <h2 data-hero id="ref-hero" className="mt-3 font-display text-h2 text-fg-inverse">
          Earn {s.rate_label} from every friend you invite
        </h2>
        <p data-hero className="mt-4 max-w-[440px] text-body-lg text-fg-inverse-secondary">
          {s.rate_label} of their completed tasks and {s.rate_label} of their deposits — added to your balance automatically.
        </p>
      </div>
      <div data-hero className="min-w-0">
        <p className="text-label-md text-fg-inverse">Your invite link</p>
        <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-line-inverse bg-fg-inverse/5 p-1.5 pl-4">
          <span className="min-w-0 flex-1 truncate text-body-md text-fg-inverse" title={s.link}>
            {display}
          </span>
          <Button size="S" onClick={() => copyInvite(s.link)}>
            Copy link
          </Button>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Share">
          {shareLinks(s).map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-[18px] border border-line-inverse px-3 text-label-sm text-fg-inverse transition-colors hover:bg-fg-inverse/10 focus-visible:shadow-focus-inverse focus-visible:outline-none"
              >
                <Icon name="share" size={14} />
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-label-sm text-fg-inverse-secondary">Code: {s.code}</p>
      </div>
    </section>
  );
}

function HowItWorks({ pct }: { pct: string }) {
  const steps = [
    ['Share your link', 'Send it to friends, or post it where people look for online work.'],
    ['They sign up and start', 'Your code is filled in for them. They earn exactly what they would without it.'],
    [`You earn ${pct}`, 'On each approved task and each deposit, straight into your balance.'],
  ];
  return (
    <section aria-labelledby="how" className="rounded-card border border-line bg-surface p-5 shadow-xs tablet:p-7">
      <h2 id="how" className="text-label-lg text-fg">
        How it works
      </h2>
      <ol className="mt-5 grid gap-6 tablet:grid-cols-3">
        {steps.map(([t, b], i) => (
          <li key={t} className="flex min-h-[56px] gap-4">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-label-md text-fg-on-brand">
              {i + 1}
            </span>
            <div>
              <p className="text-label-lg text-fg">{t}</p>
              <p className="mt-1 text-body-md text-fg-secondary">{b}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FriendLine({ f }: { f: Friend }) {
  const activity = f.status === 'not_started' ? 'Not started' : f.status === 'ineligible' ? 'Not eligible' : f.tasks > 0 ? `${f.tasks} ${f.tasks === 1 ? 'task' : 'tasks'}` : f.deposits_usd ? `${formatMoney(f.deposits_usd)} deposit` : 'Active';
  return (
    <li className="flex items-center gap-3 py-4">
      <FriendAvatar f={f} />
      <div className="min-w-0 flex-1 tablet:flex-none tablet:basis-[240px]">
        <p className="text-label-md text-fg">{f.name_masked}</p>
        <p className="text-body-sm text-fg-secondary">Joined {formatDate(f.joined_at)}</p>
      </div>
      <p className="hidden flex-1 text-body-md text-fg-secondary tablet:block">{activity}</p>
      <div className="shrink-0 text-right">
        {f.status === 'not_started' ? (
          <RemindButton f={f} />
        ) : (
          <>
            <p className="font-display text-num-md text-fg-success tabular-nums">{f.earned_usd ? formatMoney(f.earned_usd) : '—'}</p>
            <p className="text-body-xs text-fg-tertiary tablet:hidden">{activity}</p>
          </>
        )}
      </div>
    </li>
  );
}
