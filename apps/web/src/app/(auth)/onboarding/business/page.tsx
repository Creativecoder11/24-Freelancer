import type { Metadata } from 'next';
import { BusinessStep } from '@/components/auth/onboarding/BusinessStep';

export const metadata: Metadata = { title: 'Business profile', robots: { index: false } };

export default function Page() {
  return <BusinessStep />;
}
