import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyJobs } from '@/components/employer/MyJobs';

export const metadata: Metadata = { title: 'My jobs' };

/** SCR-EMP-07 (Figma 36:1496). */
export default function Page() {
  return (
    <Suspense>
      <MyJobs />
    </Suspense>
  );
}
