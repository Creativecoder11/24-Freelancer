'use client';
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Portal } from '../utils/Portal';
import { useAnchoredPosition, type Side } from '../utils/position';
import { useEscape, useOutsideClick } from '../utils/hooks';
import { Icon } from '../utils/icons';

export interface TooltipProps {
  /** Max 2 lines, no interactive content. */
  content: string;
  children: React.ReactElement;
  side?: Side;
  /** Show delay on hover (ms). Focus shows immediately. */
  delay?: number;
  /** Force-open (gallery / docs). */
  open?: boolean;
  /** Tap on the trigger toggles (touch). */
  toggleOnClick?: boolean;
  /** Link the trigger via aria-describedby (false when the text equals the trigger's label). */
  describe?: boolean;
}

/** Dark tooltip (Doc 02 §5.24): 240 max, radius 10, padding 10×12, Body/XS, 16×8 arrow. */
export function Tooltip({ content, children, side = 'top', delay = 500, open: forced, toggleOnClick = false, describe = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = forced ?? open;
  const pos = useAnchoredPosition(isOpen, triggerRef, panelRef, { side, align: 'center', offset: 8 });

  const clear = () => {
    if (showT.current) clearTimeout(showT.current);
    if (hideT.current) clearTimeout(hideT.current);
  };
  useEffect(() => clear, []);
  useEscape(open, () => setOpen(false));
  useOutsideClick([triggerRef, panelRef], open && toggleOnClick, () => setOpen(false));

  const child = describe && isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { 'aria-describedby': id })
    : children;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          clear();
          showT.current = setTimeout(() => setOpen(true), delay);
        }}
        onPointerLeave={() => {
          clear();
          hideT.current = setTimeout(() => setOpen(false), 100);
        }}
        onFocus={() => {
          clear();
          setOpen(true);
        }}
        onBlur={() => {
          clear();
          setOpen(false);
        }}
        onClick={toggleOnClick ? () => setOpen((o) => !o) : undefined}
      >
        {child}
      </span>
      {/* Always present for aria-describedby; visually hidden while closed. */}
      <Portal>
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
          className={cn(
            'pointer-events-none fixed z-[300] max-w-[240px] rounded-[10px] bg-inverse px-3 py-2.5 text-body-xs text-fg-inverse',
            'transition-opacity duration-[120ms]',
            isOpen && pos ? 'opacity-100' : 'invisible opacity-0',
          )}
        >
          {content}
          {pos ? <TooltipArrow side={pos.side} offset={pos.arrow} /> : null}
        </div>
      </Portal>
    </>
  );
}

function TooltipArrow({ side, offset }: { side: Side; offset: number }) {
  const common = 'absolute size-0 border-solid border-transparent';
  if (side === 'top')
    return <span className={cn(common, 'top-full border-x-8 border-t-8 border-t-inverse')} style={{ left: offset - 8 }} />;
  if (side === 'bottom')
    return <span className={cn(common, 'bottom-full border-x-8 border-b-8 border-b-inverse')} style={{ left: offset - 8 }} />;
  if (side === 'left')
    return <span className={cn(common, 'left-full border-y-8 border-l-8 border-l-inverse')} style={{ top: offset - 8 }} />;
  return <span className={cn(common, 'right-full border-y-8 border-r-8 border-r-inverse')} style={{ top: offset - 8 }} />;
}

/** Static tooltip bubble for documentation / gallery (non-positioned). */
export function TooltipBubble({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative inline-block max-w-[240px] rounded-[10px] bg-inverse px-3 py-2.5 text-body-xs text-fg-inverse', className)}>
      {children}
      <span className="absolute left-1/2 top-full size-0 -translate-x-1/2 border-x-8 border-t-8 border-solid border-transparent border-t-inverse" />
    </div>
  );
}

export interface InfoTipProps {
  /** Accessible name of the trigger: "More info about review window". */
  label: string;
  content: string;
  side?: Side;
}

/** Info icon-button trigger; tap toggles on touch. */
export function InfoTip({ label, content, side }: InfoTipProps) {
  return (
    <Tooltip content={content} side={side} toggleOnClick>
      <button
        type="button"
        aria-label={label}
        className="relative inline-flex size-6 items-center justify-center rounded-full text-fg-tertiary hover:text-fg-secondary focus-visible:shadow-focus before:absolute before:-inset-2.5 before:content-['']"
      >
        <Icon name="info" size={16} />
      </button>
    </Tooltip>
  );
}
