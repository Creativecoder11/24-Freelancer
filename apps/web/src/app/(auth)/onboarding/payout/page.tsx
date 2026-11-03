import type { Metadata } from 'next';
import { PayoutStep } from '@/components/auth/onboarding/PayoutStep';

export const metadata: Metadata = { title: 'Payout method', robots: { index: false } };

export default function Page() {
  return <PayoutStep />;
}
