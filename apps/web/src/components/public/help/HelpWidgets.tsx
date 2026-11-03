import NextLink from 'next/link';
import { Icon } from '@24f/ui';
import type { PublicConfig } from '@24f/shared';
import { ChannelList, type Channel } from '../Channels';

/** "Still need help?" (Figma 23:1538). Facebook group only shows when config supplies a URL (D-17). */
export function StillNeedHelp({ config, id }: { config: PublicConfig | null; id?: string }) {
  const channels: Channel[] = [
    { title: 'Live support', description: 'Chat with the 24 Freelancing team', action: 'Open chat', href: 'chat' },
    ...(config?.social.facebook_group
      ? [{ title: 'Facebook group', description: 'Ask the community', action: 'Join group', href: config.social.facebook_group }]
      : []),
    { title: 'Contact form', description: 'For account and payment issues', action: 'Message us', href: '/about#contact' },
  ];
  return (
    <section id={id} aria-labelledby="still-help-h" data-reveal className="scroll-mt-24 rounded-xl border border-line bg-surface p-5 shadow-xs tablet:p-7">
      <h2 id="still-help-h" className="font-display text-h4 text-fg">
        Still need help?
      </h2>
      <p className="mt-1 text-body-sm text-fg-secondary">Our team replies in the order requests arrive.</p>
      <ChannelList channels={channels} className="mt-6" />
    </section>
  );
}

/** Payout status lookup (Figma 23:1571). */
export function PayoutStatusNote() {
  return (
    <aside data-reveal className="rounded-xl bg-brand-subtle p-5 tablet:p-6">
      <p className="text-label-lg text-fg">Waiting on a payout?</p>
      <p className="mt-1 pl-0 text-body-sm text-fg-secondary tablet:pl-7">
        Check its live status in{' '}
        <NextLink href="/worker/wallet/withdrawals" className="inline-flex items-center gap-1 font-semibold text-fg-brand underline-offset-2 hover:underline">
          Wallet <Icon name="arrow-right" size={14} /> History
        </NextLink>{' '}
        before contacting support.
      </p>
    </aside>
  );
}
