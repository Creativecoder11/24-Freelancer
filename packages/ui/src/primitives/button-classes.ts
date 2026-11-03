/** Server-safe button class builder (no 'use client'), shared by Button and link-styled cards. */
import { cn } from '../utils/cn';
import type { ControlSize } from '../types';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';


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

