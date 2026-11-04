import type { Metadata } from 'next';
import { JobPerformance } from '@/components/employer/JobPerformance';

export const metadata: Metadata = { title: 'Job performance' };

/** SCR-EMP-08 (Figma 36:1826). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobPerformance publicId={id} />;
}
