'use client';
import { useRef, useState } from 'react';
import { Icon, cn, gsap, prefersReducedMotion } from '@24f/ui';
import { newStepId, type StepItem } from './model';

/**
 * Numbered steps editor (Doc 02 §5.47.8, Figma 34:1038): drag handle, number badge, text, delete.
 * Reorder by dragging the handle (mouse or touch) or with ↑/↓ on the focused handle.
 */
export function StepsEditor({ value, onChange, error, disabled }: { value: StepItem[]; onChange: (v: StepItem[]) => void; error?: string; disabled?: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const flash = (id: string) => {
    if (prefersReducedMotion()) return;
    requestAnimationFrame(() => {
      const el = list.current?.querySelector(`[data-step="${id}"]`);
      if (el) gsap.fromTo(el, { scale: 0.98, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'power2.out', clearProps: 'transform,opacity' });
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    onChange(next);
    setAnnounce(`Step moved to position ${to + 1} of ${next.length}.`);
    flash(it!.id);
  };

  /** Pointer drag: follow the pointer, swap with the row under it. */
  const startDrag = (e: React.PointerEvent, id: string) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    setDragId(id);
    const onMove = (ev: PointerEvent) => {
      const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-step]') ?? []);
      const cur = rows.findIndex((r) => r.dataset.step === id);
      const over = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY >= b.top && ev.clientY <= b.bottom;
      });
      if (over >= 0 && over !== cur) {
        onChangeRef.current((prev) => {
          const next = [...prev];
          const [it] = next.splice(cur, 1);
          next.splice(over, 0, it!);
          return next;
        });
      }
    };
    const onUp = () => {
      setDragId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      flash(id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Functional updates during a drag use the latest list.
  const latest = useRef(value);
  latest.current = value;
  const onChangeRef = useRef((fn: (p: StepItem[]) => StepItem[]) => onChange(fn(latest.current)));
  onChangeRef.current = (fn) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  };

  return (
    <fieldset aria-describedby={error ? 'steps-err' : undefined}>
      <legend className="mb-2 text-label-md text-fg">Steps</legend>
      <ol ref={list} className="space-y-3">
        {value.map((s, i) => (
          <li
            key={s.id}
            data-step={s.id}
            className={cn(
              'flex items-start gap-2 rounded-[12px] border bg-surface py-2.5 pl-2 pr-2 transition-shadow tablet:gap-3 tablet:pl-3',
              dragId === s.id ? 'border-line-brand shadow-md' : error && !s.body.trim() ? 'border-line-danger' : 'border-line',
            )}
          >
            <button
              type="button"
              aria-label={`Reorder step ${i + 1}. Use the up and down arrow keys.`}
              disabled={disabled || value.length < 2}
              onPointerDown={(e) => startDrag(e, s.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') (e.preventDefault(), move(i, i - 1));
                if (e.key === 'ArrowDown') (e.preventDefault(), move(i, i + 1));
              }}
              className="relative mt-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-[8px] text-fg-tertiary hover:bg-subtle focus-visible:shadow-focus focus-visible:outline-none active:cursor-grabbing disabled:cursor-default disabled:opacity-50"
            >
              <Icon name="menu" size={20} />
            </button>
            <span aria-hidden className="mt-1.5 grid size-7 shrink-0 place-items-center rounded-[8px] bg-brand-subtle text-label-sm font-semibold text-fg-brand">
              {i + 1}
            </span>
            <label className="sr-only" htmlFor={`step-${s.id}`}>
              Step {i + 1}
            </label>
            <textarea
              id={`step-${s.id}`}
              rows={1}
              value={s.body}
              disabled={disabled}
              maxLength={300}
              placeholder={i === 0 ? 'Open the task link and…' : 'Describe the next step'}
              onChange={(e) => onChange(value.map((x) => (x.id === s.id ? { ...x, body: e.target.value } : x)))}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              className="min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-body-sm text-fg outline-none placeholder:text-fg-disabled disabled:text-fg-disabled"
            />
            <button
              type="button"
              aria-label={`Delete step ${i + 1}`}
              disabled={disabled || value.length < 2}
              onClick={() => onChange(value.filter((x) => x.id !== s.id))}
              className="relative mt-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-fg-secondary hover:bg-danger-subtle hover:text-fg-danger focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-secondary"
            >
              <Icon name="trash" size={20} />
            </button>
          </li>
        ))}
      </ol>
      {value.length < 10 && !disabled ? (
        <button
          type="button"
          onClick={() => {
            const id = newStepId();
            onChange([...value, { id, body: '' }]);
            requestAnimationFrame(() => document.getElementById(`step-${id}`)?.focus());
          }}
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-[8px] px-1 text-label-md text-fg-brand hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Icon name="plus" size={20} />
          Add a step
        </button>
      ) : null}
      {error ? (
        <p id="steps-err" className="mt-1.5 flex items-center gap-1 text-body-xs text-fg-danger">
          <Icon name="alert-circle" size={14} />
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </fieldset>
  );
}
