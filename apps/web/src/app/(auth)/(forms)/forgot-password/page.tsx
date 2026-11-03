import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { BRAND } from '@/components/auth/brand';
import { ForgotPasswordForm } from '@/components/auth/forms/ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell brand={BRAND.forgot} desktopTop={200}>
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
