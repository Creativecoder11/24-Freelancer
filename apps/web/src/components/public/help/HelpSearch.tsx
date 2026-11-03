'use client';
import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from '@24f/ui';

/** Help hero search (Figma 23:1407): debounced 300 ms, syncs `?q=` so results render on the server. */
export function HelpSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, start] = useTransition();
  const go = (v: string) => {
    const q = v.trim();
    start(() => router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false }));
  };
  return (
    <div className="[&_input]:text-body-md">
      <Search size="L" label="Search help articles" placeholder="Search help articles — e.g. “withdrawal pending”" value={initial} onValueChange={go} onSubmit={go} />
    </div>
  );
}
