import type { Metadata } from 'next';
import { Footer, Navbar } from '@24f/ui';
import { ErrorScreen } from '@/components/public/ErrorScreen';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

/** Root 404 for unmatched URLs (G-17), rendered with the public shell. */
export default function NotFound() {
  return (
    <>
      <Navbar />
      <main id="main">
        <ErrorScreen
          code="404"
          title="We can’t find that page"
          body="It may have moved. Let’s get you back on track."
          actions={[
            { label: 'Back to home', href: '/' },
            { label: 'Browse jobs', href: '/jobs', variant: 'secondary' },
          ]}
        />
      </main>
      <Footer />
    </>
  );
}
