import type { Metadata } from 'next';
import { SignedInPlaceholder } from '@/components/auth/SignedInPlaceholder';

export const metadata: Metadata = { title: 'Worker', robots: { index: false } };

/** TEMPORARY: replaced by the worker dashboard. */
export default function Page() {
  return <SignedInPlaceholder mode="worker" />;
}
