import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotificationsPage } from '@/components/worker/notifications/NotificationsPage';

export const metadata: Metadata = { title: 'Notifications' };

/** SCR-WRK-09 Notifications. */
export default function Page() {
  return (
    <Suspense>
      <NotificationsPage />
    </Suspense>
  );
}
