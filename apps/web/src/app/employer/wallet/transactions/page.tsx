import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Transactions } from '@/components/employer/Transactions';

export const metadata: Metadata = { title: 'Transactions' };

/** SCR-WAL-06 (Figma 42:1425). */
export default function Page() {
  return (
    <Suspense>
      <Transactions />
    </Suspense>
  );
}
