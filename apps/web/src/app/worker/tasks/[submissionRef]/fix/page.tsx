import type { Metadata } from 'next';
import { FixPage } from '@/components/worker/tasks/FixPage';

export const metadata: Metadata = { title: 'Fix & resubmit' };

/** SCR-WRK-08 Fix and resubmit. */
export default async function Page({ params }: { params: Promise<{ submissionRef: string }> }) {
  const { submissionRef } = await params;
  return <FixPage submissionRef={submissionRef.toUpperCase()} />;
}
