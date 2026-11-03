import type { Metadata } from 'next';
import NextLink from 'next/link';
import { Button, Icon } from '@24f/ui';
import type { PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { EarningsCalculator } from '@/components/public/referral/EarningsCalculator';
import { InviteVisual } from '@/components/public/referral/InviteVisual';

export const revalidate = 300;

async function getRate() {
  const config = await apiTry<PublicConfig>('/public/config', 300);
  return Number(config?.data.referral.task_rate ?? '0.05');
}

export async function generateMetadata(): Promise<Metadata> {
  const pct = +((await getRate()) * 100).toFixed(2);
  return {
    title: 'Referral program',
    description: `Invite friends to 24 Freelancing and earn ${pct}% of every task they complete and every deposit they make — added to your balance automatically.`,
  };
}

/** SCR-PUB-07 Referral program (Figma 24:1384). The "Policy check" design note (24:1530) is not rendered. */
export default async function ReferralProgramPage() {
  const rate = await getRate();
  const pct = +(rate * 100).toFixed(2);

  const steps = [
    ['Share your link', 'Send it to friends or post it where people look for online work.'],
    ['Friends join and work', 'Your code is filled in when they sign up. They earn exactly what they would without it.'],
    [`You earn ${pct}%`, 'On each task they complete and each deposit they make, straight into your balance.'],
  ];
  const rules: [boolean, string][] = [
    [true, 'Commission is credited on approved tasks and completed deposits.'],
    [true, 'Your friends never earn less because they used your code.'],
    [false, 'Self-referrals and duplicate accounts don’t earn commission.'],
    [false, 'Spam or misleading promotion can remove referral earnings.'],
  ];

  return (
    <MarketingMotion>
      <section className="mx-auto grid max-w-container grid-cols-[minmax(0,1fr)] gap-12 px-5 pb-6 pt-10 tablet:px-8 desktop:grid-cols-[1fr_600px] desktop:items-center desktop:gap-10 desktop:px-0 desktop:pt-12">
        <div data-reveal>
          <p className="text-overline uppercase text-fg-brand">Referral program</p>
          <h1 className="mt-4 font-display text-[40px] font-extrabold leading-[48px] tracking-[-1.2px] text-fg tablet:text-display-xl">
            Earn {pct}% from every friend you invite
          </h1>
          <p className="mt-6 max-w-[520px] text-body-lg text-fg-secondary">
            You get {pct}% of every task your referrals complete and {pct}% of every deposit they make — added to your balance automatically.
          </p>
          <Button href="/signup" size="L" className="mt-8 w-full tablet:w-[300px]">
            Create account to get your link
          </Button>
          <p className="mt-4 text-body-sm text-fg-tertiary">
            Already a member?{' '}
            <NextLink href="/login?next=/worker/referral" className="font-medium text-fg-brand hover:underline">
              Log in
            </NextLink>{' '}
            to find your link in Referral.
          </p>
        </div>
        <InviteVisual />
      </section>

      <section aria-labelledby="ref-how-h" className="mx-auto mt-16 max-w-container px-5 tablet:px-8 desktop:mt-20 desktop:px-0">
        <h2 id="ref-how-h" data-reveal className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
          How it works
        </h2>
        {/* C-15: auto height (min 112) so text never overlaps the number tile. */}
        <ol data-reveal-group className="mt-6 grid gap-4 tablet:gap-6 desktop:grid-cols-3">
          {steps.map(([t, b], i) => (
            <li data-reveal-item key={t} className="flex min-h-[112px] items-start gap-4 rounded-xl border border-line bg-surface p-5 tablet:p-6">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-brand font-display text-num-sm text-fg-on-brand">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-h5 text-fg">
                  <span className="sr-only">Step {i + 1}: </span>
                  {t}
                </h3>
                <p className="mt-1 text-body-sm text-fg-secondary">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section data-reveal aria-label="Earnings example" className="mx-auto mt-10 max-w-container px-5 tablet:px-8 desktop:px-0">
        <EarningsCalculator rate={rate} />
      </section>

      <section aria-labelledby="fair-h" className="mx-auto mt-16 max-w-container px-5 tablet:px-8 desktop:mt-20 desktop:px-0">
        <h2 id="fair-h" data-reveal className="font-display text-[28px] font-bold leading-9 text-fg tablet:text-h2">
          Rules that keep it fair
        </h2>
        <ul data-reveal-group className="mt-6 space-y-4 rounded-xl border border-line bg-surface p-5 tablet:p-6 desktop:max-w-[760px]">
          {rules.map(([ok, t]) => (
            <li data-reveal-item key={t} className="flex items-start gap-3 text-body-sm text-fg-secondary">
              <Icon name={ok ? 'check-circle' : 'x-circle'} size={20} className={`mt-px shrink-0 ${ok ? 'text-fg-success' : 'text-fg-danger'}`} />
              <span>
                <span className="sr-only">{ok ? 'Allowed: ' : 'Not allowed: '}</span>
                {t}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mb-24 mt-16 max-w-container px-5 tablet:px-8 desktop:mt-20 desktop:px-0">
        <div
          data-reveal
          className="flex flex-col gap-6 overflow-hidden rounded-2xl bg-brand px-8 py-10 tablet:flex-row tablet:items-center tablet:justify-between tablet:px-10 desktop:min-h-[200px]"
        >
          <div>
            <h2 className="font-display text-[28px] font-bold leading-9 text-fg-on-brand">Your link is ready the moment you sign up.</h2>
            <p className="mt-2 text-body-md text-fg-on-brand">Free to join. Share it anywhere.</p>
          </div>
          <Button href="/signup" variant="secondary" size="L" className="w-full shrink-0 tablet:w-[200px]">
            Get my invite link
          </Button>
        </div>
      </section>
    </MarketingMotion>
  );
}
