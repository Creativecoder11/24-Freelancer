import type { Metadata } from 'next';
import { WorkerShell } from '@/components/worker/shell';

export const metadata: Metadata = { title: { default: 'Worker', template: '%s · 24 Freelancing' }, robots: { index: false } };

/** Worker dashboard layout: AppShell in worker mode around every /worker/* page (Doc 03 §3). */
export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return <WorkerShell>{children}</WorkerShell>;
}
