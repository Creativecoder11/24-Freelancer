import type { Metadata } from 'next';
import { SubmitProof } from '@/components/worker/submit/SubmitProof';

export const metadata: Metadata = { title: 'Submit proof' };

/** SCR-WRK-05 Submit proof (requires an active reservation, else back to job details). */
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <SubmitProof publicId={publicId.toUpperCase()} />;
}
