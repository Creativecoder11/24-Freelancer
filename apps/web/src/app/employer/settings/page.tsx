import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployerSettings } from '@/components/settings/EmployerSettings';

export const metadata: Metadata = { title: 'Settings' };

/** SCR-SET-02 Employer profile and settings (Figma 44:1001). */
export default function Page() {
  return (
    <Suspense>
      <EmployerSettings />
    </Suspense>
  );
}
