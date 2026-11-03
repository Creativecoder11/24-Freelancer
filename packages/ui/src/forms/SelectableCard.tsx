'use client';
import { useId } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import type { WithClassName } from '../types';

export interface SelectableCardProps extends WithClassName {
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  size?: 'tile' | 'large';
  disabled?: boolean;
  disabledReason?: string;
  children?: React.ReactNode;
}

/** Radio/checkbox card (Doc 02 §5.47.1). Selection style and check badge always move together (C-20). */
export function SelectableCard({ type, name, value, checked, onChange, title, subtitle, icon, size = 'tile', disabled, disabledReason, className, children }: SelectableCardProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'group/sc relative flex rounded-[14px] p-4 transition-colors duration-[120ms]',
        size === 'large' ? 'flex-col gap-3' : 'items-center gap-3',
        disabled
          ? 'cursor-not-allowed border border-line bg-muted'
          : checked
            ? cn('cursor-pointer bg-brand-subtle', size === 'large' ? 'border-2 border-line-brand p-[15px]' : 'border-[1.5px] border-line-brand p-[15.5px]')
            : 'cursor-pointer border border-line bg-surface hover:border-line-strong',
        'has-[:focus-visible]:shadow-focus',
        className,
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-describedby={disabled && disabledReason ? `${id}-reason` : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {icon ? (
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-[10px]', checked ? 'bg-surface text-fg-brand' : 'bg-muted text-fg-secondary')}>
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 pr-6">
        <span className={cn('block text-label-md', disabled ? 'text-fg-disabled' : 'text-fg')}>{title}</span>
        {subtitle ? <span className="mt-0.5 block text-body-xs text-fg-tertiary">{subtitle}</span> : null}
        {disabled && disabledReason ? (
          <span id={`${id}-reason`} className="mt-1 block text-body-xs text-fg-tertiary">
            {disabledReason}
          </span>
        ) : null}
        {children}
      </span>
      <span
        aria-hidden
        className={cn(
          'absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-brand text-fg-on-brand transition-transform duration-[120ms]',
          checked ? 'scale-100' : 'scale-0',
        )}
      >
        <Icon name="check" size={12} strokeWidth={3} />
      </span>
    </label>
  );
}
