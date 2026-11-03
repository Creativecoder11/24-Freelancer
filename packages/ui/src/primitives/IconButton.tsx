'use client';
import NextLink from 'next/link';
import { forwardRef } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  icon: IconName;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'M' | 'S';
  /** Unread dot (8 px danger, 2 px white outline). */
  dot?: boolean;
  /** Tooltip with the aria-label text (desktop hover after 500 ms). Default true. */
  tooltip?: boolean;
  href?: string;
}

const VARIANT = {
  primary: 'bg-brand text-fg-on-brand hover:bg-brand-hover active:bg-brand-active',
  secondary: 'bg-surface border border-line text-fg-secondary hover:bg-subtle hover:border-line-strong active:bg-muted',
  ghost: 'bg-transparent text-fg-secondary hover:bg-muted active:bg-muted',
};

export function iconButtonClasses(variant: 'primary' | 'secondary' | 'ghost', size: 'M' | 'S', disabled?: boolean, className?: string) {
  return cn(
    'relative inline-flex shrink-0 items-center justify-center transition-colors duration-[120ms] focus-visible:outline-none focus-visible:shadow-focus',
    // 44 px touch hit area
    "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
    size === 'M' ? 'size-10 rounded-[10px]' : 'size-8 rounded-[8px]',
    disabled
      ? cn('cursor-not-allowed text-fg-disabled', variant !== 'ghost' && 'bg-muted', variant === 'secondary' && 'border border-line')
      : VARIANT[variant],
    className,
  );
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', size = 'M', dot, tooltip = true, href, className, type = 'button', disabled, ...rest },
  ref,
) {
  const label = rest['aria-label'];
  const inner = (
    <>
      <Icon name={icon} size={size === 'M' ? 20 : 16} />
      {dot ? (
        <span aria-hidden className="absolute right-[7px] top-[7px] size-2 rounded-full bg-danger ring-2 ring-surface" />
      ) : null}
    </>
  );
  const el = href ? (
    <NextLink href={href} aria-label={label} className={iconButtonClasses(variant, size, disabled, className)}>
      {inner}
    </NextLink>
  ) : (
    <button ref={ref} type={type} disabled={disabled} {...rest} className={iconButtonClasses(variant, size, disabled, className)}>
      {inner}
    </button>
  );
  return tooltip && !disabled ? <Tooltip content={label} describe={false}>{el}</Tooltip> : el;
});
