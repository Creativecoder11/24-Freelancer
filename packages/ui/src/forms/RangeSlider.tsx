'use client';
import { useId, useRef } from 'react';
import { cn } from '../utils/cn';

export type RangeSliderProps =
  | { mode: 'single'; label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string; labelHidden?: boolean; className?: string; showValues?: boolean }
  | { mode: 'dual'; label: string; value: [number, number]; onChange: (v: [number, number]) => void; min: number; max: number; step: number; format: (v: number) => string; labelHidden?: boolean; className?: string; showValues?: boolean };

/**
 * Range slider (Doc 02 §5.47.11): track 6 px bg/muted, brand fill, 20 px white knob with
 * 2 px brand border. Knobs cannot cross. Arrows ±step, PageUp/Down ×10, Home/End.
 */
export function RangeSlider(props: RangeSliderProps) {
  const { label, min, max, step, format, labelHidden, className, showValues = true } = props;
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const values: number[] = props.mode === 'single' ? [props.value] : [...props.value];
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));

  const set = (i: number, raw: number) => {
    const v = snap(raw);
    if (props.mode === 'single') props.onChange(v);
    else {
      const [lo, hi] = props.value;
      props.onChange(i === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]);
    }
  };

  const fromPointer = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return min + ((clientX - r.left) / r.width) * (max - min);
  };

  const onTrackDown = (e: React.PointerEvent) => {
    const v = fromPointer(e.clientX);
    const i = values.length === 1 ? 0 : Math.abs(v - values[0]!) <= Math.abs(v - values[1]!) ? 0 : 1;
    set(i, v);
    const knob = trackRef.current?.querySelectorAll<HTMLElement>('[role="slider"]')[i];
    knob?.focus();
    const move = (ev: PointerEvent) => set(i, fromPointer(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const v = values[i]!;
    const map: Record<string, number> = {
      ArrowRight: v + step,
      ArrowUp: v + step,
      ArrowLeft: v - step,
      ArrowDown: v - step,
      PageUp: v + step * 10,
      PageDown: v - step * 10,
      Home: min,
      End: max,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    set(i, map[e.key]!);
  };

  const lo = values.length === 1 ? min : values[0]!;
  const hi = values.length === 1 ? values[0]! : values[1]!;

  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      <div className={cn('flex items-baseline justify-between', labelHidden && 'sr-only')}>
        <span id={`${id}-label`} className="text-label-md text-fg">
          {label}
        </span>
        {showValues ? (
          <span className="font-display text-num-sm text-fg-secondary">
            {values.length === 1 ? format(values[0]!) : `${format(values[0]!)} – ${format(values[1]!)}`}
          </span>
        ) : null}
      </div>
      <div ref={trackRef} className="relative flex h-6 cursor-pointer touch-none items-center" onPointerDown={onTrackDown}>
        <span className="absolute inset-x-0 h-1.5 rounded-[3px] bg-muted" />
        <span className="absolute h-1.5 rounded-[3px] bg-brand" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        {values.map((v, i) => (
          <span
            key={i}
            role="slider"
            tabIndex={0}
            aria-labelledby={`${id}-label`}
            aria-label={values.length === 2 ? (i === 0 ? 'Minimum' : 'Maximum') : undefined}
            aria-valuemin={values.length === 2 && i === 1 ? values[0] : min}
            aria-valuemax={values.length === 2 && i === 0 ? values[1] : max}
            aria-valuenow={v}
            aria-valuetext={format(v)}
            onKeyDown={onKey(i)}
            className="absolute size-5 -translate-x-1/2 rounded-full border-2 border-line-brand bg-surface shadow-sm outline-none focus-visible:shadow-focus before:absolute before:-inset-3 before:content-['']"
            style={{ left: `${pct(v)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
