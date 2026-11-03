import type { Metadata } from 'next';
import { SignedInPlaceholder } from '@/components/auth/SignedInPlaceholder';

export const metadata: Metadata = { title: 'Employer', robots: { index: false } };

/** TEMPORARY: replaced by the employer dashboard. */
export default function Page() {
  return <SignedInPlaceholder mode="employer" />;
}
