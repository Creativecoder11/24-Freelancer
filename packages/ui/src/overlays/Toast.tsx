'use client';
import NextLink from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { Portal } from '../utils/Portal';
import { useIsMobile } from '../utils/hooks';
import { useOverlayTransition } from '../motion/overlay';
import type { AlertTone } from '../types';
import { toast, toastStore, type ToastItem } from './toast-store';

export const TOAST_TONE: Record<AlertTone, { icon: IconName; fg: string; bar: string }> = {
  info: { icon: 'info', fg: 'text-fg-info', bar: 'bg-fg-info' },
  success: { icon: 'check-circle', fg: 'text-fg-success', bar: 'bg-success-bright' },
  warning: { icon: 'alert-triangle', fg: 'text-fg-warning', bar: 'bg-warning' },
  danger: { icon: 'alert-circle', fg: 'text-fg-danger', bar: 'bg-danger' },
};

export interface ToastCardProps {
  tone: AlertTone;
  title: string;
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  onDismiss?: () => void;
  className?: string;
}

/** Visual toast (Doc 02 §5.43): 400 wide, radius 14, Shadow/LG, 4 px tone bar + 20 px icon. */
export function ToastCard({ tone, title, body, action, onDismiss, className }: ToastCardProps) {
  const t = TOAST_TONE[tone];
  return (
    <div className={cn('relative flex w-full overflow-hidden rounded-[14px] border border-line bg-surface shadow-lg tablet:w-[400px]', className)}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', t.bar)} />
      <Icon name={t.icon} size={20} className={cn('ml-4 mt-4 shrink-0', t.fg)} />
      <div className="min-w-0 flex-1 py-4 pl-3 pr-12">
        <p className="text-label-md text-fg">{title}</p>
        {body ? <p className="mt-0.5 line-clamp-2 text-body-sm text-fg-secondary">{body}</p> : null}
        {action ? (
          action.href ? (
            <NextLink href={action.href} className="mt-1.5 inline-block text-label-md text-fg-brand hover:underline" onClick={action.onClick}>
              {action.label}
            </NextLink>
          ) : (
            <button type="button" onClick={action.onClick} className="mt-1.5 text-label-md text-fg-brand hover:underline">
              {action.label}
            </button>
          )
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-[8px] text-fg-secondary hover:bg-muted focus-visible:shadow-focus"
        >
          <Icon name="x" size={20} />
        </button>
      ) : null}
    </div>
  );
}

function LiveToast({ item, mobile }: { item: ToastItem; mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.durationMs);
  const startedAt = useRef(Date.now());
  useOverlayTransition(!item.leaving, ref, null, mobile ? 'toast-down' : 'toast-up', () => toastStore.remove(item.id));

  useEffect(() => {
    if (item.leaving || paused) return;
    startedAt.current = Date.now();
    const id = setTimeout(() => toastStore.dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, item.leaving, item.id]);

  const assertive = item.tone === 'danger' || item.tone === 'warning';
  return (
    <div
      ref={ref}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto w-full tablet:w-auto"
    >
      <ToastCard tone={item.tone} title={item.title} body={item.body} action={item.action} onDismiss={() => toastStore.dismiss(item.id)} />
    </div>
  );
}

/** Desktop + tablet bottom-right (24 px); mobile top-center under the app bar (C-24). */
export function ToastViewport() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.getServer);
  const mobile = useIsMobile();
  return (
    <Portal>
      <section
        aria-label="Notifications"
        className={cn(
          'pointer-events-none fixed z-[600] flex gap-3',
          mobile
            ? 'inset-x-4 top-[calc(72px+env(safe-area-inset-top))] flex-col-reverse items-center'
            : 'bottom-[calc(24px+var(--sticky-bar-h,0px))] right-6 flex-col items-end',
        )}
      >
        {items.map((t) => (
          <LiveToast key={t.id} item={t} mobile={mobile} />
        ))}
      </section>
    </Portal>
  );
}

type ToastApi = typeof toast;
const ToastContext = createContext<ToastApi>(toast);

/** Root provider: mounts the viewport once; toasts survive route changes. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
