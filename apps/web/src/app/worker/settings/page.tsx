import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkerSettings } from '@/components/settings/WorkerSettings';

export const metadata: Metadata = { title: 'Settings' };

/** SCR-SET-01 Worker profile and settings (Figma 44:757). */
export default function Page() {
  return (
    <Suspense>
      <WorkerSettings />
    </Suspense>
  );
}
