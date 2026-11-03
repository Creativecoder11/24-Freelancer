'use client';
import NextLink from 'next/link';
import { cloneElement, useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon, type IconName } from '../utils/icons';
import { useIsMobile } from '../utils/hooks';
import { Popover } from './Popover';
import { BottomSheet } from './BottomSheet';
import { IconButton } from '../primitives/IconButton';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  href?: string;
  onSelect?: () => void;
  tone?: 'danger';
  disabled?: boolean;
  disabledReason?: string;
  /** Render a divider before this item. */
  divider?: boolean;
}

export interface ActionMenuProps {
  trigger: React.ReactElement;
  items: ActionMenuItem[];
  /** Accessible name of the menu ("Job actions"). */
  label: string;
  align?: 'start' | 'end';
}

/**
 * Action menu (Doc 02 §5.51): min 200, radius 12, padding 6, items 40 high, 16 px icons.
 * WAI-ARIA menu button; arrows / Home / End / type-ahead; action sheet below 768 px.
 */
export function ActionMenu({ trigger, items, label, align = 'end' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const typed = useRef({ s: '', t: 0 });

  const focusItem = (i: number) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (!els.length) return;
    els[(i + els.length) % els.length]?.focus();
  };
  const triggerEl = () => anchorRef.current?.querySelector<HTMLElement>('button,a') ?? null;
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerEl()?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') (e.preventDefault(), focusItem(i + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focusItem(i - 1));
    else if (e.key === 'Home') (e.preventDefault(), focusItem(0));
    else if (e.key === 'End') (e.preventDefault(), focusItem(els.length - 1));
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current.s = now - typed.current.t > 600 ? e.key.toLowerCase() : typed.current.s + e.key.toLowerCase();
      typed.current.t = now;
      const hit = els.findIndex((el) => el.textContent?.trim().toLowerCase().startsWith(typed.current.s));
      if (hit >= 0) focusItem(hit);
    }
  };

  const select = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close(!item.href);
    item.onSelect?.();
  };

  const list = (
    <div ref={listRef} role="menu" aria-label={label} id={menuId} onKeyDown={onKeyDown} className={cn(!isMobile && 'min-w-[200px] p-1.5')}>
      {items.map((item) => {
        const cls = cn(
          'flex w-full items-center gap-2.5 rounded-[8px] px-3 text-left outline-none',
          isMobile ? 'h-12 text-body-md' : 'h-10 text-body-sm',
          item.disabled
            ? 'cursor-not-allowed text-fg-disabled'
            : cn(item.tone === 'danger' ? 'text-fg-danger' : 'text-fg', 'hover:bg-muted focus-visible:bg-muted'),
        );
        const content = (
          <>
            {item.icon ? <Icon name={item.icon} size={16} className={item.disabled ? undefined : item.tone === 'danger' ? undefined : 'text-fg-secondary'} /> : null}
            <span className="flex-1">{item.label}</span>
          </>
        );
        return (
          <div key={item.key}>
            {item.divider ? <div role="separator" className="mx-0 my-1.5 h-px bg-line-subtle" /> : null}
            {item.href && !item.disabled ? (
              <NextLink role="menuitem" tabIndex={-1} href={item.href} className={cls} onClick={() => select(item)}>
                {content}
              </NextLink>
            ) : (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                title={item.disabled ? item.disabledReason : undefined}
                className={cls}
                onClick={() => select(item)}
              >
                {content}
                {item.disabled && item.disabledReason ? <span className="sr-only">, {item.disabledReason}</span> : null}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const triggerNode = cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    ...(trigger.type === IconButton ? { tooltip: false } : {}),
    onClick: () => {
      setOpen((o) => !o);
      if (!isMobile) requestAnimationFrame(() => requestAnimationFrame(() => focusItem(0)));
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
        const target = e.key === 'ArrowDown' ? 0 : -1;
        requestAnimationFrame(() => requestAnimationFrame(() => focusItem(target)));
      }
    },
  });

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        {triggerNode}
      </span>
      {isMobile ? (
        <BottomSheet open={open} onOpenChange={setOpen} title={label} titleHidden bodyClassName="px-3 pb-3">
          {list}
        </BottomSheet>
      ) : (
        <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} anchorRef={anchorRef} align={align} offset={6}>
          {list}
        </Popover>
      )}
    </>
  );
}
