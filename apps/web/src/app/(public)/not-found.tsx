import type { Metadata } from 'next';
import { ErrorScreen } from '@/components/public/ErrorScreen';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

/** 404 for the public area (G-17). */
export default function PublicNotFound() {
  return (
    <ErrorScreen
      code="404"
      title="We can’t find that page"
      body="It may have moved. Let’s get you back on track."
      actions={[
        { label: 'Back to home', href: '/' },
        { label: 'Browse jobs', href: '/jobs', variant: 'secondary' },
      ]}
    />
  );
}
