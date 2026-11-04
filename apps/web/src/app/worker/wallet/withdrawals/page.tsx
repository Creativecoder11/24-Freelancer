import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WithdrawalsPage } from '@/components/wallet/WithdrawalsPage';

export const metadata: Metadata = { title: 'Withdrawal history' };

/** SCR-WAL-04 Withdrawal history (Figma 42:927); ?ref=WD-… opens the detail panel. */
export default function Page() {
  return (
    <Suspense>
      <WithdrawalsPage />
    </Suspense>
  );
}
