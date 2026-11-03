import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { BRAND } from '@/components/auth/brand';
import { ResetPasswordForm } from '@/components/auth/forms/ResetPasswordForm';

export const metadata: Metadata = { title: 'Create a new password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <AuthShell brand={BRAND.reset} desktopTop={200}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
