'use client';
import { useEffect, useState } from 'react';

function fmt(ms: number, style: 'mmss' | 'hours') {
  if (ms <= 0) return style === 'mmss' ? '0:00' : '0 h';
  if (style === 'hours') {
    const h = Math.floor(ms / 3_600_000);
    return h >= 1 ? `${h} h` : `${Math.max(1, Math.ceil(ms / 60_000))} min`;
  }
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Live countdown to `until` (ISO). `serverOffsetMs` = serverTime − Date.now() at fetch, so clocks stay honest (Doc 03 §7.6).
 * Announces only at minute boundaries via aria-live off by default.
 */
export function Countdown({ until, serverOffsetMs = 0, style = 'mmss', onExpire, className }: { until: string; serverOffsetMs?: number; style?: 'mmss' | 'hours'; onExpire?: () => void; className?: string }) {
  const target = new Date(until).getTime();
  const [left, setLeft] = useState(() => target - (Date.now() + serverOffsetMs));
  useEffect(() => {
    const id = setInterval(() => {
      const l = target - (Date.now() + serverOffsetMs);
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [target, serverOffsetMs, onExpire]);
  return (
    <time dateTime={until} className={className} suppressHydrationWarning>
      {fmt(left, style)}
    </time>
  );
}
