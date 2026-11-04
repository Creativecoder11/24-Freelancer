import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WithdrawPage } from '@/components/wallet/WithdrawPage';

export const metadata: Metadata = { title: 'Withdraw' };

/** SCR-WAL-02/03 Withdraw funds and the request-sent dialog (Figma 41:753, 41:989, mobile 48:1238). */
export default function Page() {
  return (
    <Suspense>
      <WithdrawPage />
    </Suspense>
  );
}
