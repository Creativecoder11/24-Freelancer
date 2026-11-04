import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TransactionsPage } from '@/components/wallet/TransactionsPage';

export const metadata: Metadata = { title: 'Transactions' };

/** SCR-WAL-ND1 Worker full ledger (G-10). */
export default function Page() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}
