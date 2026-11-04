import type { Metadata } from 'next';
import { OverviewPage } from '@/components/worker/overview/OverviewPage';

export const metadata: Metadata = { title: 'Overview' };

/** SCR-WRK-01 Worker overview. */
export default function Page() {
  return <OverviewPage />;
}
