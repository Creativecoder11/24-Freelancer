'use client';
import { useRef } from 'react';
import { Icon, buttonClasses, gsap, useGSAP, MOTION_OK } from '@24f/ui';

const SHARE = ['WhatsApp', 'Messenger', 'Facebook', 'Telegram'];

/** Static invite visual (Figma 24:1402 right, 600×464 brand panel). Decorative: aria-hidden + inert. */
export function InviteVisual() {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(scope);
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from(q('.iv-panel'), { opacity: 0, scale: 0.96, duration: 0.7 })
          .from(q('.iv-card'), { opacity: 0, y: 30, duration: 0.6 }, 0.2)
          .from(q('.iv-chip'), { opacity: 0, y: 8, duration: 0.35, stagger: 0.06 }, 0.5)
          .from(q('.iv-earn'), { opacity: 0, y: 24, scale: 0.94, duration: 0.55, ease: 'back.out(1.7)' }, 0.7);
        gsap.to(q('.iv-earn'), { y: -6, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.4 });
      });
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} aria-hidden inert className="relative">
      <div className="iv-panel rounded-[32px] bg-brand px-4 pb-6 pt-6 tablet:px-10 tablet:py-10 desktop:min-h-[400px]">
        <div className="iv-card rounded-xl bg-surface p-4 shadow-lg tablet:p-5">
          <p className="text-label-sm font-semibold text-fg">Your invite link</p>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[10px] border border-line bg-subtle py-1 pl-3 pr-1">
            <span className="truncate text-body-sm text-fg">24freelancing.com/r/NUSRAT24</span>
            <span className={`${buttonClasses({ variant: 'primary', size: 'S' })} shrink-0`}>Copy link</span>
          </div>
          <p className="mt-4 text-body-xs text-fg-tertiary">Share on</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SHARE.map((s) => (
              <span key={s} className="iv-chip inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-label-sm text-fg">
                <Icon name="share" size={12} />
                {s}
              </span>
            ))}
          </div>
          <p className="mt-4 text-body-xs text-fg-tertiary">Code: NUSRAT24</p>
        </div>
        <div className="iv-earn mt-6 rounded-xl bg-surface px-4 py-4 shadow-lg tablet:ml-auto tablet:w-[296px]">
          <p className="text-body-xs text-fg-tertiary">Referral commission</p>
          <p className="mt-0.5 font-display text-num-md text-fg-success">+$0.50 this week</p>
        </div>
      </div>
    </div>
  );
}
