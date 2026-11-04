import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FriendsPage } from '@/components/referral/FriendsPage';

export const metadata: Metadata = { title: 'Invited friends' };

/** SCR-REF-02 Invited friends (Figma 43:737); ?friend= opens the panel. */
export default function Page() {
  return (
    <Suspense>
      <FriendsPage />
    </Suspense>
  );
}
