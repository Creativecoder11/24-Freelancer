'use client';
import { useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Portal } from '../utils/Portal';
import { useEscape, useFocusTrap, useIsMobile, useScrollLock } from '../utils/hooks';
import { useOverlayTransition } from '../motion/overlay';
import { IconButton } from '../primitives/IconButton';
import { Button } from '../primitives/Button';
import { SheetHandle, useSheetDrag, useVisualViewportInset } from './BottomSheet';

export interface DialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** confirm/destructive → role="alertdialog". success: ×/Esc/scrim act as Done. */
  type?: 'confirm' | 'destructive' | 'success' | 'form';
  title: string;
  description?: React.ReactNode;
  width?: 480 | 560;
  children?: React.ReactNode;
  footer: React.ReactNode;
  /** Disables ×, Esc and scrim while a request is pending. */
  busy?: boolean;
  /** Closing asks once to discard typed text. */
  dirty?: boolean;
  /** false: no ×, Esc or scrim close (e.g. slot expired). */
  dismissible?: boolean;
  /** Mobile presentation. Default: forms → sheet, others → centred. */
  mobile?: 'sheet' | 'center';
  /** Called when focus cannot return to the trigger (row moved away). */
  fallbackFocus?: () => HTMLElement | null;
  discardCopy?: { title: string; keep: string; discard: string };
}

/**
 * Dialog / modal (Doc 02 §5.41, §7.1): scrim 48 %, radius 20, padding 24, Shadow/XL;
 * focus trap, Esc, return focus, background scroll lock, GSAP fade + 8 px rise.
 */
export function Dialog({
  open,
  onOpenChange,
  type = 'confirm',
  title,
  description,
  width = 480,
  children,
  footer,
  busy = false,
  dirty = false,
  dismissible = true,
  mobile,
  fallbackFocus,
  discardCopy = { title: 'Discard your changes?', keep: 'Keep editing', discard: 'Discard' },
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const asSheet = isMobile && (mobile ?? (type === 'form' ? 'sheet' : 'center')) === 'sheet';
  const [askDiscard, setAskDiscard] = useState(false);
  const present = useOverlayTransition(open, panelRef, scrimRef, asSheet ? 'sheet' : 'dialog', () => setAskDiscard(false));
  useScrollLock(open);
  useFocusTrap(panelRef, open && present, { fallbackReturn: fallbackFocus });

  const requestClose = () => {
    if (busy || !dismissible) return;
    if (dirty && !askDiscard) {
      setAskDiscard(true);
      return;
    }
    onOpenChange(false);
  };
  useEscape(open, (e) => {
    e.stopPropagation();
    requestClose();
  });
  const drag = useSheetDrag(panelRef, requestClose, asSheet && dismissible && !busy);
  const kbInset = useVisualViewportInset(open && asSheet);

  if (!present) return null;
  const alert = type === 'confirm' || type === 'destructive';

  return (
    <Portal>
      <div className={cn('fixed inset-0 z-[500] flex justify-center', asSheet ? 'items-end' : 'items-center p-4')}>
        <div ref={scrimRef} aria-hidden className="absolute inset-0 bg-scrim" onClick={requestClose} />
        <div
          ref={panelRef}
          role={alert ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          aria-busy={busy || undefined}
          tabIndex={-1}
          style={asSheet ? { marginBottom: kbInset } : undefined}
          className={cn(
            'relative flex flex-col bg-surface shadow-xl outline-none',
            asSheet
              ? 'max-h-[90vh] w-full rounded-t-[20px] pb-[env(safe-area-inset-bottom)]'
              : cn('max-h-[calc(100vh-48px)] w-full rounded-[20px]', width === 560 ? 'max-w-[560px]' : 'max-w-[480px]'),
          )}
        >
          {asSheet ? <SheetHandle {...drag} /> : null}
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', asSheet ? 'px-5 pb-5 pt-3' : 'p-6')}>
            <h2 id={titleId} className={cn('pr-10 font-display', asSheet ? 'text-h5 font-sans' : 'text-h4', 'text-fg')}>
              {title}
            </h2>
            {description ? (
              <div id={descId} className="mt-2 text-body-md text-fg-secondary">
                {description}
              </div>
            ) : null}
            {children ? <div className="mt-4">{children}</div> : null}
            {askDiscard ? (
              <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-warning-subtle p-3">
                <span className="text-label-md text-fg">{discardCopy.title}</span>
                <span className="flex gap-2">
                  <Button size="S" variant="secondary" onClick={() => setAskDiscard(false)}>
                    {discardCopy.keep}
                  </Button>
                  <Button size="S" variant="destructive" onClick={() => onOpenChange(false)}>
                    {discardCopy.discard}
                  </Button>
                </span>
              </div>
            ) : null}
            <div
              data-dialog-footer
              className={cn(
                'mt-6 flex gap-3',
                asSheet ? 'flex-col-reverse [&>*]:w-full' : 'flex-wrap justify-end max-tablet:[&>*]:flex-1',
              )}
            >
              {footer}
            </div>
          </div>
          {dismissible ? (
            <span className={cn('absolute', asSheet ? 'right-3 top-4' : 'right-4 top-4')}>
              <IconButton
                aria-label={type === 'success' ? 'Done' : 'Close'}
                icon="x"
                variant="ghost"
                size="M"
                tooltip={false}
                disabled={busy}
                onClick={requestClose}
              />
            </span>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
