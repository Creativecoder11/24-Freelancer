'use client';
import { useRef, useState } from 'react';
import { RangeSlider, gsap, useGSAP, prefersReducedMotion } from '@24f/ui';
import { formatMoney } from '@24f/shared';

/**
 * Earnings example (Figma 24:1490): friends 1–50, monthly earnings $1–$100.
 * result = friends × earnings × rate; the big number tweens with GSAP on change.
 */
export function EarningsCalculator({ rate }: { rate: number }) {
  const [friends, setFriends] = useState(5);
  const [earnings, setEarnings] = useState(10);
  const result = Math.round(friends * earnings * rate * 100) / 100;
  const pct = +(rate * 100).toFixed(2);
  const out = useRef<HTMLParagraphElement>(null);
  const shown = useRef({ v: result });
  // React renders the first value only; GSAP owns the text afterwards.
  const [firstText] = useState(() => formatMoney(result.toFixed(2)));

  useGSAP(
    () => {
      const el = out.current!;
      const render = () => (el.textContent = formatMoney(shown.current.v.toFixed(2)));
      if (prefersReducedMotion()) {
        shown.current.v = result;
        render();
        return;
      }
      gsap.to(shown.current, { v: result, duration: 0.5, ease: 'power3.out', overwrite: true, onUpdate: render });
      gsap.fromTo(el, { scale: 1.06 }, { scale: 1, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
    },
    { dependencies: [result] },
  );

  return (
    <div className="grid gap-8 rounded-xl border border-line bg-surface p-5 shadow-xs tablet:p-8 desktop:grid-cols-[1fr_456px] desktop:gap-12 desktop:p-8">
      <div>
        <h2 className="font-display text-h3 text-fg">See what referrals could add</h2>
        <p className="mt-2 max-w-[520px] text-body-sm text-fg-secondary">
          Move the sliders — this is an example, not a promise. Real earnings depend on your friends’ activity.
        </p>
        <div className="mt-6 space-y-6 desktop:max-w-[620px]">
          <RangeSlider mode="single" label="Friends who join" value={friends} onChange={setFriends} min={1} max={50} step={1} format={(v) => String(v)} />
          <RangeSlider
            mode="single"
            label="Each friend’s monthly task earnings"
            value={earnings}
            onChange={setEarnings}
            min={1}
            max={100}
            step={1}
            format={(v) => formatMoney(v.toFixed(2))}
          />
        </div>
      </div>
      <div className="rounded-xl bg-inverse p-6 tablet:p-7">
        <p className="text-body-sm text-fg-inverse-secondary">You could earn about</p>
        <p ref={out} aria-hidden className="mt-1 origin-left font-display text-num-2xl tabular-nums text-fg-money-bright">
          {firstText}
        </p>
        <p className="mt-2 text-body-sm text-fg-inverse-secondary">per month from tasks</p>
        <div className="mt-5 border-t border-line-inverse pt-5">
          <p aria-live="polite" className="text-label-sm font-semibold text-fg-inverse tabular-nums">
            {friends} {friends === 1 ? 'friend' : 'friends'} × {formatMoney(earnings.toFixed(2))} × {pct}% = {formatMoney(result.toFixed(2))}
          </p>
          <p className="mt-2 text-body-xs text-fg-inverse-secondary">Plus {pct}% of any deposits they make.</p>
        </div>
      </div>
    </div>
  );
}
