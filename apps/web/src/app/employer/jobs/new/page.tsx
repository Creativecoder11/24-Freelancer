import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JobWizard } from '@/components/employer/wizard/JobWizard';

export const metadata: Metadata = { title: 'Post a job' };

/** SCR-EMP-02…06 (Figma 34:648, 34:903, 35:1021, 35:1261, 35:1491). */
export default function Page() {
  return (
    <Suspense>
      <JobWizard />
    </Suspense>
  );
}
