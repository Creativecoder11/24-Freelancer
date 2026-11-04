import type { Metadata } from 'next';
import { JobDetail } from '@/components/worker/job/JobDetail';

export const metadata: Metadata = { title: 'Job details' };

/** SCR-WRK-04 Job details and instructions. */
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <JobDetail publicId={publicId.toUpperCase()} />;
}
