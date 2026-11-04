import type { Metadata } from 'next';
import { MockGateway } from '@/components/employer/MockGateway';

export const metadata: Metadata = { title: 'Test payment', robots: { index: false } };

/** PAYMENTS_MODE=mock hosted checkout (Doc 06 §7.1). Local/dev only; the API 404s elsewhere. */
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <MockGateway refId={ref} />;
}
