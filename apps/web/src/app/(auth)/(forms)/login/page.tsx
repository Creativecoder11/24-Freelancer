import type { Metadata } from 'next';
import NextLink from 'next/link';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { BRAND } from '@/components/auth/brand';
import { LoginForm } from '@/components/auth/forms/LoginForm';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage() {
  return (
    <AuthShell
      brand={BRAND.login}
      desktopTop={248}
      switchLink={{ prompt: 'New here?', label: 'Create an account', href: '/signup' }}
      legal={
        <>
          By signing in you agree to our{' '}
          <NextLink href="/legal/terms" className="hover:underline">
            Terms &amp; conditions
          </NextLink>{' '}
          and{' '}
          <NextLink href="/legal/privacy" className="hover:underline">
            Privacy policy
          </NextLink>
          .
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
