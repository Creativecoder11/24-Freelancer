'use client';
import NextLink from 'next/link';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { Spinner } from './Spinner';
import type { ControlSize } from '../types';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  fullWidth?: boolean;
  /** Keeps width, sets aria-busy, ignores clicks (Doc 02 §5.53). */
  loading?: boolean;
  /** Short label shown next to the spinner when width allows ("Publishing…"). */
  loadingText?: string;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  /** Renders <a> through next/link. */
  href?: string;
  /** aria-describedby target for the visible disabled reason. Keeps the button focusable (aria-disabled). */
  disabledReasonId?: string;
}

const SIZE: Record<ControlSize, string> = {
  L: 'h-[52px] min-w-[120px] rounded-[12px] px-5 text-label-lg gap-2',
  M: 'h-11 min-w-[88px] rounded-[10px] px-4 text-label-md gap-2',
  S: 'h-9 min-w-[72px] rounded-[8px] px-3 text-label-md gap-2',
};

const VARIANT: Record<ButtonVariant, { base: string; disabled: string }> = {
  primary: {
    base: 'bg-brand text-fg-on-brand shadow-xs hover:bg-brand-hover active:bg-brand-active',
    disabled: 'bg-muted text-fg-disabled shadow-none',
  },
  secondary: {
    base: 'bg-surface text-fg border border-line shadow-xs hover:bg-subtle hover:border-line-strong active:bg-muted',
    disabled: 'bg-muted text-fg-disabled border border-transparent shadow-none',
  },
  tertiary: {
    base: 'bg-transparent text-fg-brand hover:bg-brand-subtle active:bg-brand-muted',
    disabled: 'bg-transparent text-fg-disabled',
  },
  destructive: {
    base: 'bg-danger text-fg-inverse shadow-xs hover:bg-danger-hover active:bg-[color-mix(in_srgb,var(--fl-bg-danger-hover),var(--fl-ink-950)_18%)]',
    disabled: 'bg-muted text-fg-disabled shadow-none',
  },
};

export function buttonClasses({
  variant = 'primary',
  size = 'M',
  fullWidth,
  disabled,
  className,
}: { variant?: ButtonVariant; size?: ControlSize; fullWidth?: boolean; disabled?: boolean; className?: string }) {
  const v = VARIANT[variant];
  return cn(
    'relative inline-flex select-none items-center justify-center whitespace-nowrap font-sans transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
    'focus-visible:outline-none focus-visible:shadow-focus',
    // 44 px hit area on touch for S
    size === 'S' && "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
    SIZE[size],
    disabled ? cn(v.disabled, 'cursor-not-allowed') : v.base,
    fullWidth && 'w-full',
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'M',
    fullWidth,
    loading = false,
    loadingText,
    leadingIcon,
    trailingIcon,
    href,
    disabledReasonId,
    disabled,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const innerRef = useRef<HTMLElement | null>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);
  const iconSize = size === 'S' ? 16 : 20;

  // Lock width at the pre-loading width.
  const useIso = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
  useIso(() => {
    if (loading && innerRef.current && lockedWidth === null) setLockedWidth(innerRef.current.offsetWidth);
    if (!loading && lockedWidth !== null) setLockedWidth(null);
  }, [loading]);

  if (process.env.NODE_ENV !== 'production' && disabled && !disabledReasonId && !loading && typeof window !== 'undefined') {
    // Doc 03 §5.1: never disable without a reason nearby.
    console.warn('[Button] disabled without disabledReasonId:', typeof children === 'string' ? children : '');
  }

  const softDisabled = Boolean(disabled && disabledReasonId);
  const content = loading ? (
    <>
      <Spinner size={size === 'L' ? 20 : 16} />
      {loadingText ? <span>{loadingText}</span> : <span className="sr-only">{children}</span>}
    </>
  ) : (
    <>
      {leadingIcon ? <Icon name={leadingIcon} size={iconSize} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={iconSize} /> : null}
    </>
  );

  const classes = buttonClasses({ variant, size, fullWidth, disabled: disabled && !loading, className });
  const style = lockedWidth ? { width: lockedWidth, ...rest.style } : rest.style;

  if (href && !disabled) {
    return (
      <NextLink
        href={href}
        ref={(el) => {
          innerRef.current = el;
        }}
        className={classes}
        style={style}
        aria-busy={loading || undefined}
        onClick={loading ? (e) => e.preventDefault() : (onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>)}
        id={rest.id}
        aria-label={rest['aria-label']}
      >
        {content}
      </NextLink>
    );
  }

  return (
    <button
      {...rest}
      ref={(el) => {
        innerRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      type={type}
      className={classes}
      style={style}
      disabled={disabled && !softDisabled && !loading ? true : undefined}
      aria-disabled={softDisabled || loading || undefined}
      aria-describedby={cn(rest['aria-describedby'], softDisabled && disabledReasonId) || undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (loading || softDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {content}
    </button>
  );
});
