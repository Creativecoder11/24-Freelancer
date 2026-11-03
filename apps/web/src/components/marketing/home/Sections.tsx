import { Accordion, Button, Icon, Link, Logo, StatusBadge, Alert } from '@24f/ui';
import type { Faq } from '@24f/shared';

export function SectionHeader({ overline, title, body, action, invert }: { overline: string; title: string; body?: string; action?: React.ReactNode; invert?: boolean }) {
  return (
    <div data-reveal className="flex flex-col gap-4 desktop:flex-row desktop:items-end desktop:justify-between">
      <div className="max-w-[680px]">
        <p className={invert ? 'text-overline uppercase text-fg-brand-inverse' : 'text-overline uppercase text-fg-brand'}>{overline}</p>
        <h2 className={`mt-2 font-display text-[28px] font-bold leading-9 tablet:text-h2 ${invert ? 'text-fg-inverse' : 'text-fg'}`}>{title}</h2>
        {body ? <p className={`mt-3 text-body-md ${invert ? 'text-fg-inverse-secondary' : 'text-fg-secondary'}`}>{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

const PROMISES = [
  ['Pay shown up front', 'Reward, time and proof are on every job before you start.'],
  ['A reason for every “no”', 'Rejections always include the employer’s reason and a way to fix it.'],
  ['Payouts you can follow', 'Requested, processing, paid — every step is time-stamped.'],
  ['Real people on support', 'Stuck on something? Live chat with the 24 Freelancing team.'],
];

/** Promises band (Figma 18:590). */
export function Promises() {
  return (
    <section className="mx-auto max-w-container px-5 tablet:px-8 desktop:px-0">
      <ul data-reveal-group className="grid overflow-hidden rounded-card border border-line bg-surface tablet:grid-cols-2 desktop:grid-cols-4">
        {PROMISES.map(([t, b], i) => (
          <li data-reveal-item key={t} className={`px-6 py-6 ${i > 0 ? 'border-t border-line-subtle tablet:border-t-0 desktop:border-l' : ''} ${i === 2 ? 'tablet:border-t desktop:border-t-0' : ''} ${i === 3 ? 'tablet:border-l tablet:border-t desktop:border-t-0' : ''} ${i === 1 ? 'tablet:border-l' : ''}`}>
            <h3 className="text-h4 font-display text-fg">{t}</h3>
            <p className="mt-2 text-body-sm text-fg-secondary">{b}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const WORKER_POINTS = ['Work from your phone or laptop, on your schedule', 'See reward, time and proof before you start', 'Track every submission until it’s paid', 'Earn 5% from friends you refer'];
const EMPLOYER_POINTS = ['Reach a large pool of workers in one post', 'Set the reward, number of slots and proof rules', 'Review proof before you approve anything', 'See the full cost before you publish'];

/** Audience benefits (Figma 19:728). */
export function Audience() {
  return (
    <section className="mx-auto grid max-w-container gap-6 px-5 tablet:px-8 desktop:grid-cols-2 desktop:px-0">
      <div data-reveal className="relative overflow-hidden rounded-[28px] border border-line bg-surface p-8 tablet:p-10 desktop:min-h-[580px]">
        <p className="text-overline uppercase text-fg-brand">For workers</p>
        <h3 className="mt-3 font-display text-h3 text-fg">Earn from tasks you can finish in minutes</h3>
        <ul className="mt-6 space-y-3">
          {WORKER_POINTS.map((p) => (
            <li key={p} className="flex gap-3 text-body-md text-fg-secondary">
              <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-fg-success" />
              {p}
            </li>
          ))}
        </ul>
        <Button href="/jobs" className="mt-8">
          Find jobs
        </Button>
        <div data-parallax="0.08" className="mt-10 rounded-card bg-inverse p-6 shadow-lg desktop:absolute desktop:bottom-10 desktop:right-10 desktop:mt-0 desktop:w-[352px]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-body-sm text-fg-inverse-secondary">Available balance</p>
              <p className="mt-1 font-display text-num-xl text-fg-inverse" data-count="12.48" data-prefix="$" data-decimals="2">
                $12.48
              </p>
            </div>
            <Button size="S" href="/signup">
              Withdraw
            </Button>
          </div>
          <p className="mt-3 text-body-xs text-fg-inverse-secondary">Pending review: $1.35</p>
        </div>
      </div>
      <div data-reveal className="relative overflow-hidden rounded-[28px] bg-inverse p-8 tablet:p-10 desktop:min-h-[580px]">
        <p className="text-overline uppercase text-fg-brand-inverse">For employers</p>
        <h3 className="mt-3 font-display text-h3 text-fg-inverse">Get many small tasks done at once</h3>
        <ul className="mt-6 space-y-3">
          {EMPLOYER_POINTS.map((p) => (
            <li key={p} className="flex gap-3 text-body-md text-fg-inverse-secondary">
              <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-fg-money-bright" />
              {p}
            </li>
          ))}
        </ul>
        <Button href="/signup?role=employer" variant="secondary" className="mt-8">
          Post a job
        </Button>
        <div data-parallax="0.08" className="mt-10 rounded-card bg-surface p-5 shadow-lg desktop:absolute desktop:bottom-10 desktop:right-10 desktop:mt-0 desktop:w-[352px]">
          <div className="flex items-center justify-between">
            <p className="text-label-md text-fg">Cost preview</p>
            <StatusBadge tone="info" label="Before publishing" />
          </div>
          <dl className="mt-3 space-y-2 text-body-sm">
            <div className="flex justify-between text-fg-secondary">
              <dt>50 slots × $0.180</dt>
              <dd className="tabular-nums text-fg">$9.00</dd>
            </div>
            <div className="flex justify-between text-fg-secondary">
              <dt>Platform fee</dt>
              <dd className="text-fg">Shown at checkout</dd>
            </div>
            <div className="flex justify-between border-t border-line-subtle pt-2 text-label-md">
              <dt className="text-fg">Reserved from deposit</dt>
              <dd className="font-display text-num-md text-fg-brand" data-count="9" data-prefix="$" data-decimals="2">
                $9.00
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Trust & transparency (Figma 19:789). */
export function Trust() {
  return (
    <section className="mx-auto max-w-container px-5 tablet:px-8 desktop:px-0">
      <SectionHeader overline="Why 24 Freelancing" title="Built so honest work gets paid" body="The rules are the same for everyone, and you can see them before you start." />
      <div data-reveal-group className="mt-10 grid gap-6 desktop:grid-cols-3">
        <article data-reveal-item className="rounded-card border border-line bg-surface p-6 shadow-xs">
          <h3 className="text-h5 text-fg">Clear instructions, every time</h3>
          <p className="mt-2 text-body-sm text-fg-secondary">Jobs list numbered steps and the exact proof required, so you know what “done” means.</p>
          <ol className="mt-6 space-y-2 rounded-[14px] border border-line-subtle bg-subtle p-4">
            {['Open the shared sheet link', 'Put each photo in one of 5 categories', 'Screenshot the sheet + copy its link'].map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-body-sm text-fg">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-label-sm text-fg-on-brand">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </article>
        <article data-reveal-item className="rounded-card border border-line bg-surface p-6 shadow-xs">
          <h3 className="text-h5 text-fg">Fair, explained reviews</h3>
          <p className="mt-2 text-body-sm text-fg-secondary">Rejections must include a reason, and you can fix and resubmit while slots are open.</p>
          <div className="mt-6 rounded-[14px] border border-line-subtle bg-subtle p-4">
            <Alert tone="danger">The screenshot cuts off rows 9–12. Please include the whole sheet.</Alert>
            <div className="mt-3 flex items-center justify-between">
              <Button size="S" variant="secondary">
                Fix &amp; resubmit
              </Button>
              <span className="text-body-xs text-fg-tertiary">Resubmit by Oct 27</span>
            </div>
          </div>
        </article>
        <article data-reveal-item className="rounded-card border border-line bg-surface p-6 shadow-xs">
          <h3 className="text-h5 text-fg">Transparent payouts</h3>
          <p className="mt-2 text-body-sm text-fg-secondary">Method, fee and expected timing are shown before you confirm a withdrawal.</p>
          <div className="mt-6 rounded-[14px] border border-line-subtle bg-subtle p-4">
            <dl className="space-y-2 text-body-sm">
              <div className="flex justify-between">
                <dt className="text-fg-secondary">You request</dt>
                <dd className="tabular-nums text-fg">$10.00</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-secondary">Fee</dt>
                <dd className="text-label-sm text-fg">Shown before you confirm</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-secondary">You receive</dt>
                <dd className="tabular-nums text-label-md text-fg-success">$10.00</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-2">
              <StatusBadge tone="info" label="Processing" />
              <span className="text-body-xs text-fg-tertiary">Usually arrives within the time shown on the method</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/** Referral band (Figma 19:850). */
export function ReferralBand({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <section className="mx-auto max-w-container px-5 tablet:px-8 desktop:px-0">
      <div data-reveal className="grid gap-10 overflow-hidden rounded-[28px] bg-inverse p-8 tablet:p-12 desktop:grid-cols-[1fr_456px] desktop:items-center">
        <div>
          <p className="text-overline uppercase text-fg-brand-inverse">Referral program</p>
          <h2 className="mt-3 font-display text-[28px] font-bold leading-9 text-fg-inverse tablet:text-h2">Invite friends. Earn {pct}% of what they do.</h2>
          <p className="mt-4 max-w-[520px] text-body-md text-fg-inverse-secondary">
            Get {pct}% of every task your referrals complete and {pct}% of every deposit they make — added to your balance automatically.
          </p>
          <Button href="/referral-program" size="L" className="mt-8 min-w-[216px]">
            Get your invite link
          </Button>
        </div>
        <div data-reveal-group className="space-y-4">
          {[
            ['Friend completes tasks worth', 10, 10 * rate],
            ['Friend deposits', 20, 20 * rate],
          ].map(([label, base, earn]) => (
            <div data-reveal-item key={label as string} className="flex items-center justify-between gap-4 rounded-card bg-inverse-raised px-5 py-4">
              <div>
                <p className="text-body-xs text-fg-inverse-secondary">{label}</p>
                <p className="font-display text-num-md text-fg-inverse">${(base as number).toFixed(2)}</p>
              </div>
              <Icon name="arrow-right" size={20} className="text-fg-inverse-secondary" />
              <div className="text-right">
                <p className="text-body-xs text-fg-inverse-secondary">You earn</p>
                <p className="font-display text-num-md text-fg-money-bright" data-count={(earn as number).toFixed(2)} data-prefix="$" data-decimals="2">
                  ${(earn as number).toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** FAQ (Figma 19:876). Answers come from the CMS (G-14). */
export function FaqSection({ faqs }: { faqs: Faq[] }) {
  return (
    <section className="mx-auto grid max-w-container gap-10 px-5 tablet:px-8 desktop:grid-cols-[360px_760px] desktop:justify-between desktop:px-0">
      <div data-reveal>
        <p className="text-overline uppercase text-fg-brand">FAQ</p>
        <h2 className="mt-2 font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">Questions, answered</h2>
        <p className="mt-6 text-body-md text-fg-secondary">Can’t find what you need?</p>
        <Link href="/help#live-support" className="mt-1">
          Talk to live support
        </Link>
      </div>
      <div data-reveal>
        <Accordion items={faqs.map((f) => ({ q: f.question, a: <p className="whitespace-pre-line">{f.answer_md}</p> }))} />
      </div>
    </section>
  );
}

/** Final CTA (Figma 19:926). */
export function FinalCta() {
  return (
    <section className="mx-auto max-w-container px-5 tablet:px-8 desktop:px-0">
      <div data-reveal className="relative grid items-center gap-8 overflow-hidden rounded-[28px] border border-line bg-surface p-8 tablet:p-12 desktop:grid-cols-[1fr_260px]">
        <div>
          <h2 className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">Start with one small task today.</h2>
          <p className="mt-3 max-w-[560px] text-body-md text-fg-secondary">
            Create a free account, pick a job that fits your time and follow it all the way to your balance.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/jobs" size="L" className="min-w-[168px]">
              Find jobs
            </Button>
            <Button href="/signup?role=employer" size="L" variant="secondary" className="min-w-[160px]">
              Post a job
            </Button>
          </div>
        </div>
        <div data-parallax="0.18" className="hidden justify-self-center desktop:block">
          <Logo type="badge" height={235} decorative className="rotate-[-8deg]" />
        </div>
      </div>
    </section>
  );
}
