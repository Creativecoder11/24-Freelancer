'use client';
import { useRef } from 'react';
import { cn } from '../utils/cn';
import { Portal } from '../utils/Portal';
import { useEscape, useOutsideClick } from '../utils/hooks';
import { useAnchoredPosition, type Align, type Side } from '../utils/position';
import { useOverlayTransition } from '../motion/overlay';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  side?: Side;
  align?: Align;
  offset?: number;
  className?: string;
  /** Match the anchor's width (select menus). */
  matchWidth?: boolean;
  role?: string;
  id?: string;
  'aria-label'?: string;
  /** Return focus to the anchor on Esc (default true). */
  returnFocus?: boolean;
}

/** Anchored, portalled popup that flips to stay in the viewport (Doc 02 §7.3). */
export function Popover({
  open,
  onOpenChange,
  anchorRef,
  children,
  side = 'bottom',
  align = 'start',
  offset = 8,
  className,
  matchWidth,
  role,
  id,
  returnFocus = true,
  ...aria
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const present = useOverlayTransition(open, panelRef, null, 'popover');
  const pos = useAnchoredPosition(present, anchorRef, panelRef, { side, align, offset });
  useOutsideClick([anchorRef, panelRef], open, () => onOpenChange(false));
  useEscape(open, () => {
    onOpenChange(false);
    if (returnFocus) anchorRef.current?.focus();
  });
  if (!present) return null;
  const width = matchWidth ? anchorRef.current?.offsetWidth : undefined;
  return (
    <Portal>
      <div
        ref={panelRef}
        id={id}
        role={role}
        aria-label={aria['aria-label']}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
        className={cn('fixed z-[200] rounded-[12px] border border-line bg-surface shadow-lg', className)}
      >
        {children}
      </div>
    </Portal>
  );
}
