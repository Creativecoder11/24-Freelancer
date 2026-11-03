'use client';
import NextLink from 'next/link';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { Spinner } from './Spinner';
import type { ControlSize } from '../types';

export { buttonClasses, type ButtonVariant } from './button-classes';
import { buttonClasses, type ButtonVariant } from './button-classes';

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
