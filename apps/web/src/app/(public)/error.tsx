'use client';
import { useEffect } from 'react';
import { ErrorScreen } from '@/components/public/ErrorScreen';

/** 500 for the public area (G-17). The navbar and footer stay usable. */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorScreen
      title="Something went wrong on our side"
      body="Your balance and work are safe. Try again in a moment."
      actions={[
        { label: 'Try again', onClick: reset },
        { label: 'Contact support', href: '/about#contact', variant: 'secondary' },
      ]}
    />
  );
}
