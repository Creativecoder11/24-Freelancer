'use client';
import { SessionProvider } from '@/lib/session';
import { Shell } from '@/components/shell';

/** Signed-in shell: loads GET /admin/me first; permissions drive navigation (Doc 09 §2.4). */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
