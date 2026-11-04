import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployerNotifications } from '@/components/employer/Notifications';

export const metadata: Metadata = { title: 'Notifications' };

/** SCR-EMP-ND1 (G-18, A-33). */
export default function Page() {
  return (
    <Suspense>
      <EmployerNotifications />
    </Suspense>
  );
}
