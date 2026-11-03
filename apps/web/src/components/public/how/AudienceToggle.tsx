'use client';
import { useEffect, useState } from 'react';
import { SegmentedControl, ScrollTrigger, prefersReducedMotion } from '@24f/ui';

type Audience = 'workers' | 'employers';

/** "For workers | For employers" (G-16): scrolls to the section; scroll-spy keeps the selection in sync. */
export function AudienceToggle() {
  const [value, setValue] = useState<Audience>('workers');

  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: '#employers',
      start: 'top 55%',
      onEnter: () => setValue('employers'),
      onLeaveBack: () => setValue('workers'),
    });
    if (window.location.hash === '#employers') setValue('employers');
    return () => st.kill();
  }, []);

  return (
    <SegmentedControl
      label="Audience"
      kind="radio"
      value={value}
      onChange={(v) => {
        setValue(v);
        const el = document.getElementById(v);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        window.history.replaceState(null, '', `#${v}`);
      }}
      options={[
        { value: 'workers', label: 'For workers' },
        { value: 'employers', label: 'For employers' },
      ]}
      className="w-full tablet:w-[300px]"
      fullWidth
    />
  );
}
