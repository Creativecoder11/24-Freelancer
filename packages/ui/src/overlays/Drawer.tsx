'use client';
import { useId, useRef } from 'react';
import { cn } from '../utils/cn';
import { Portal } from '../utils/Portal';
import { useEscape, useFocusTrap, useIsMobile, useScrollLock } from '../utils/hooks';
import { useOverlayTransition } from '../motion/overlay';
import { IconButton } from '../primitives/IconButton';
import { BottomSheet } from './BottomSheet';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  /** Live meta beside the title: "41 jobs match". */
  meta?: React.ReactNode;
  side?: 'right' | 'left';
  width?: 360 | 440;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Below 768 px render as a full-height bottom sheet (default true). */
  sheetOnMobile?: boolean;
}

/** Right drawer (Doc 02 §5.42): 440 wide, Shadow/XL, sticky footer, slide 280 ms over the scrim. */
export function Drawer({ open, onOpenChange, title, meta, side = 'right', width = 440, footer, children, sheetOnMobile = true }: DrawerProps) {
  const isMobile = useIsMobile();
  if (isMobile && sheetOnMobile) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title={title} footer={footer} fullHeight>
        {meta ? <p className="-mt-1 mb-3 text-body-sm text-fg-tertiary">{meta}</p> : null}
        {children}
      </BottomSheet>
    );
  }
  return <DrawerPanel {...{ open, onOpenChange, title, meta, side, width, footer, children }} />;
}

function DrawerPanel({ open, onOpenChange, title, meta, side = 'right', width = 440, footer, children }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const present = useOverlayTransition(open, panelRef, scrimRef, side === 'right' ? 'drawer-right' : 'drawer-left');
  useScrollLock(open);
  useFocusTrap(panelRef, open && present);
  useEscape(open, () => onOpenChange(false));
  if (!present) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[400]">
        <div ref={scrimRef} aria-hidden className="absolute inset-0 bg-scrim" onClick={() => onOpenChange(false)} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={{ width: `min(${width}px, 100vw)` }}
          className={cn('absolute inset-y-0 flex flex-col bg-surface shadow-xl outline-none', side === 'right' ? 'right-0' : 'left-0')}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line-subtle px-6 py-5">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-h4 text-fg">
                {title}
              </h2>
              {meta ? (
                <p aria-live="polite" className="mt-0.5 text-body-sm text-fg-tertiary">
                  {meta}
                </p>
              ) : null}
            </div>
            <IconButton aria-label="Close" icon="x" variant="ghost" tooltip={false} onClick={() => onOpenChange(false)} className="-mr-2 -mt-1" />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
          {footer ? <footer className="flex shrink-0 gap-3 border-t border-line-subtle bg-surface px-6 py-4">{footer}</footer> : null}
        </div>
      </div>
    </Portal>
  );
}
