import type { Metadata } from 'next';
import { RoleStep } from '@/components/auth/onboarding/RoleStep';

export const metadata: Metadata = { title: 'How do you want to use 24 Freelancing?', robots: { index: false } };

export default function Page() {
  return <RoleStep />;
}
