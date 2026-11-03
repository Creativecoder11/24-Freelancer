import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { BRAND } from '@/components/auth/brand';
import { SignupForm } from '@/components/auth/forms/SignupForm';

export const metadata: Metadata = { title: 'Create your account', robots: { index: false } };

export default function SignupPage() {
  return (
    <AuthShell brand={BRAND.signup} desktopTop={120} switchLink={{ prompt: 'Have an account?', label: 'Sign in', href: '/login' }}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
