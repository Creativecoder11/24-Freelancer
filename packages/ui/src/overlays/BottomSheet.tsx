'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Portal } from '../utils/Portal';
import { useEscape, useFocusTrap, useScrollLock } from '../utils/hooks';
import { useOverlayTransition } from '../motion/overlay';
import { IconButton } from '../primitives/IconButton';

/** Swipe-down to dismiss on the handle/header. Swipe is never the only way to close. */
export function useSheetDrag(panelRef: React.RefObject<HTMLElement | null>, onDismiss: () => void, enabled: boolean) {
  const start = useRef<number | null>(null);
  const dy = useRef(0);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      start.current = e.clientY;
      dy.current = 0;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current === null || !panelRef.current) return;
      dy.current = Math.max(0, e.clientY - start.current);
      panelRef.current.style.transform = `translateY(${dy.current}px)`;
    },
    onPointerUp: () => {
      if (start.current === null || !panelRef.current) return;
      const shouldClose = dy.current > 80;
      panelRef.current.style.transform = '';
      start.current = null;
      if (shouldClose) onDismiss();
    },
  };
}

/** Keeps sticky footers above the on-screen keyboard. */
export function useVisualViewportInset(active: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

export function SheetHandle(props: ReturnType<typeof useSheetDrag>) {
  return (
    <div {...props} className="flex h-5 shrink-0 cursor-grab touch-none items-start justify-center pt-2" aria-hidden>
      <span className="h-1 w-9 rounded-[2px] bg-line-strong" />
    </div>
  );
}

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  /** Hide the visible title (still the accessible name). */
  titleHidden?: boolean;
  footer?: React.ReactNode;
  fullHeight?: boolean;
  children: React.ReactNode;
  /** Body padding (default 20). */
  bodyClassName?: string;
}

/** Mobile bottom sheet (Doc 02 §5.52): top radius 20, 36×4 handle, max 90vh, sticky footer + safe area. */
export function BottomSheet({ open, onOpenChange, title, titleHidden, footer, fullHeight, children, bodyClassName }: BottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const present = useOverlayTransition(open, panelRef, scrimRef, 'sheet');
  useScrollLock(open);
  useFocusTrap(panelRef, open && present);
  useEscape(open, () => onOpenChange(false));
  const drag = useSheetDrag(panelRef, () => onOpenChange(false), true);
  const inset = useVisualViewportInset(open);
  if (!present) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[500] flex items-end">
        <div ref={scrimRef} aria-hidden className="absolute inset-0 bg-scrim" onClick={() => onOpenChange(false)} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={{ marginBottom: inset }}
          className={cn(
            'relative flex w-full flex-col rounded-t-[20px] bg-surface shadow-xl outline-none',
            fullHeight ? 'h-[90vh]' : 'max-h-[90vh]',
          )}
        >
          <div {...drag} className="touch-none">
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-9 rounded-[2px] bg-line-strong" />
            </div>
            <div className={cn('flex items-center justify-between gap-3 px-5 pb-2 pt-3', titleHidden && 'pb-0 pt-0')}>
              <h2 id={titleId} className={cn('text-h5 text-fg', titleHidden && 'sr-only')}>
                {title}
              </h2>
              {!titleHidden ? (
                <IconButton aria-label="Close" icon="x" size="M" tooltip={false} onClick={() => onOpenChange(false)} className="-mr-2" />
              ) : null}
            </div>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5', bodyClassName)}>{children}</div>
          {footer ? (
            <div className="flex shrink-0 gap-3 border-t border-line-subtle bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 [&>*]:flex-1">
              {footer}
            </div>
          ) : (
            <div className="h-[env(safe-area-inset-bottom)]" />
          )}
        </div>
      </div>
    </Portal>
  );
}
