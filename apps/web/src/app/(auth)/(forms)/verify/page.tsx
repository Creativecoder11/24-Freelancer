import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { BRAND } from '@/components/auth/brand';
import { VerifyForm } from '@/components/auth/forms/VerifyForm';

export const metadata: Metadata = { title: 'Enter the 6-digit code', robots: { index: false } };

export default function VerifyPage() {
  return (
    <AuthShell brand={BRAND.verify} desktopTop={200}>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </AuthShell>
  );
}
