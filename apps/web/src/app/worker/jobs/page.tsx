import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobsPage } from '@/components/worker/jobs/JobsPage';

export const metadata: Metadata = { title: 'Find jobs' };

/** SCR-WRK-02 Find jobs (+ SCR-WRK-03 drawer at ?filters=open). */
export default function Page() {
  return (
    <Suspense>
      <JobsPage />
    </Suspense>
  );
}
