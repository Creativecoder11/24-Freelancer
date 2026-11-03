import type { Metadata } from 'next';
import { InterestsStep } from '@/components/auth/onboarding/InterestsStep';

export const metadata: Metadata = { title: 'Your interests', robots: { index: false } };

export default function Page() {
  return <InterestsStep />;
}
