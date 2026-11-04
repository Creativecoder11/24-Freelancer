import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Review } from '@/components/employer/Review';

export const metadata: Metadata = { title: 'Review submissions' };

/** SCR-EMP-09 / SCR-EMP-10 (Figma 40:1798, 40:2095, mobile 48:1336). */
export default function Page() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}
