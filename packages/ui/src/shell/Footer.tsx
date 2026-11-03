import NextLink from 'next/link';
import { Logo } from '../primitives/Logo';

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Platform',
    links: [
      { label: 'Browse jobs', href: '/jobs' },
      { label: 'Post a job', href: '/employer/jobs/new' },
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Referral program', href: '/referral-program' },
      { label: 'Payout history', href: '/payout-history' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Help center & FAQ', href: '/help' },
      { label: 'Live support', href: '/help#live-support' },
      { label: 'Contact us', href: '/about#contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms & conditions', href: '/legal/terms' },
      { label: 'Privacy policy', href: '/legal/privacy' },
      { label: 'Refund policy', href: '/legal/refund' },
      { label: 'Cancellation policy', href: '/legal/cancellation' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'Facebook page', href: 'https://facebook.com/24freelancing', external: true },
      { label: 'Facebook group', href: 'https://facebook.com/groups/24freelancing', external: true },
      { label: 'YouTube', href: 'https://youtube.com/@24freelancing', external: true },
    ],
  },
];

/** Footer (Figma 12:197): inverse navy, 4 link columns, legal bar. */
export function Footer() {
  return (
    <footer className="bg-inverse text-fg-inverse">
      <div className="mx-auto max-w-container px-5 pb-8 pt-16 tablet:px-8 desktop:px-0">
        <div className="grid gap-10 tablet:grid-cols-2 desktop:grid-cols-[400px_repeat(4,1fr)] desktop:gap-0">
          <div className="max-w-[300px]">
            <Logo theme="inverse" />
            <p className="mt-4 text-body-sm text-fg-inverse-secondary">
              A microtask marketplace. Earn from small online tasks, or get work done by many people at once.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 tablet:col-span-1 desktop:contents">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="text-label-md text-fg-inverse">{col.title}</h2>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-body-sm text-fg-inverse-secondary hover:text-fg-inverse">
                          {l.label}
                        </a>
                      ) : (
                        <NextLink href={l.href} className="text-body-sm text-fg-inverse-secondary hover:text-fg-inverse">
                          {l.label}
                        </NextLink>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-line-inverse pt-6 text-body-xs text-fg-inverse-secondary tablet:flex-row tablet:justify-between">
          <p>© 2026 24 Freelancing. All rights reserved.</p>
          <p>Payout methods, fees and limits are shown in your wallet before you confirm.</p>
        </div>
      </div>
    </footer>
  );
}
