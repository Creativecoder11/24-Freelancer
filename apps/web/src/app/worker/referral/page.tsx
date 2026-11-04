import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReferralPage } from '@/components/referral/ReferralPage';

export const metadata: Metadata = { title: 'Referral' };

/** SCR-REF-01 Referral dashboard (Figma 43:477). */
export default function Page() {
  return (
    <Suspense>
      <ReferralPage />
    </Suspense>
  );
}
