import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployerWallet } from '@/components/employer/Wallet';

export const metadata: Metadata = { title: 'Wallet' };

/** SCR-WAL-05 (Figma 42:1206). */
export default function Page() {
  return (
    <Suspense>
      <EmployerWallet />
    </Suspense>
  );
}
