'use client';
import { useEffect, useState } from 'react';

/** Milliseconds left until `target` (ms epoch or ISO), ticking every 250 ms. 0 when done or unset. */
export function useCountdown(target: number | string | null | undefined): number {
  const at = target == null ? null : typeof target === 'number' ? target : new Date(target).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [at]);
  return at == null ? 0 : Math.max(0, at - now);
}
