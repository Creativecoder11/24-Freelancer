import type { Metadata } from 'next';
import { DepositStatus } from '@/components/employer/DepositStatus';

export const metadata: Metadata = { title: 'Deposit' };

/** SCR-WAL-ND2 (G-11). */
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <DepositStatus refId={ref} />;
}
