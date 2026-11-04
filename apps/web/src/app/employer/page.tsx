import type { Metadata } from 'next';
import { Overview } from '@/components/employer/Overview';

export const metadata: Metadata = { title: 'Overview' };

/** SCR-EMP-01 (Figma 32:477). */
export default function Page() {
  return <Overview />;
}
