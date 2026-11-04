import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WalletPage } from '@/components/wallet/WalletPage';

export const metadata: Metadata = { title: 'Wallet' };

/** SCR-WAL-01 Earnings wallet (Figma 41:477). */
export default function Page() {
  return (
    <Suspense>
      <WalletPage />
    </Suspense>
  );
}
