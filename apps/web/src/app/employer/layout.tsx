import type { Metadata } from 'next';
import { EmployerShell } from '@/components/employer/shell';

export const metadata: Metadata = { title: { template: '%s · Employer · 24 Freelancing', default: 'Employer · 24 Freelancing' }, robots: { index: false } };

/** Employer area: dashboard shell in employer mode (Doc 02 §6.1.1). */
export default function EmployerLayout({ children }: { children: React.ReactNode }) {
  return <EmployerShell>{children}</EmployerShell>;
}
