import type { BrandPanelContent } from './BrandPanel';

/** Brand panel copy per screen, verbatim from Figma page 3:4. Static, decorative. */
export const BRAND = {
  login: {
    overline: 'WHILE YOU WERE AWAY',
    headline: 'Your tasks, approvals and balance are right where you left them.',
    notes: [
      { title: '3 tasks approved', body: 'Added to your balance', amount: '+$0.420', top: 560 },
      { title: 'Withdrawal paid', body: '$10.00 to mobile wallet ••569', top: 660, left: 120 },
    ],
  },
  signup: {
    overline: '24 FREELANCING',
    headline: 'Earn from small tasks — or get them done.',
    lineSize: 'lg',
    lines: [
      { text: 'See the reward before you start', top: 458 },
      { text: 'Clear steps and proof on every job', top: 502 },
      { text: 'Every review and payout tracked', top: 546 },
    ],
    notes: [{ title: 'Task approved', body: 'Categorize 20 product photos', amount: '+$0.180', top: 700 }],
  },
  forgot: {
    overline: 'ACCOUNT SECURITY',
    headline: 'We’ll never ask for your password or code.',
    lineSize: 'md',
    lineWidth: 480,
    lines: [
      { text: '24 Freelancing staff never ask for codes by phone, chat or Facebook.', top: 488 },
      { text: 'Only enter codes on 24freelancing.com or the official app.', top: 544 },
      { text: 'Use a password you don’t use anywhere else.', top: 600 },
    ],
  },
  reset: {
    overline: 'ALMOST DONE',
    headline: 'A strong password protects your balance.',
    notes: [{ title: 'Signed out elsewhere', body: 'Other devices will need the new password', top: 520 }],
  },
  verify: {
    overline: 'VERIFY IT’S YOU',
    headline: 'One code keeps your earnings safe.',
    lineSize: 'md',
    lines: [
      { text: 'Required when you sign up and before your first withdrawal', top: 458 },
      { text: 'Codes expire after 10 minutes', top: 502 },
      { text: 'You can request a new code after 60 seconds', top: 546 },
    ],
  },
} satisfies Record<string, BrandPanelContent>;
