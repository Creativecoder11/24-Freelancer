'use client';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { Button } from '../primitives/Button';
import { StatusBadge } from '../primitives/Badge';
import { Progress } from './Progress';
import { CountUp } from '../motion/CountUp';
import type { Tone, WithClassName } from '../types';
import { useId } from 'react';

export type StatCardProps = WithClassName & { label: string } & (
    | { type: 'default'; value: string; badge?: { label: string; tone: Tone }; meta?: string }
    | { type: 'balance'; value: string; action?: { label: string; href?: string; onClick?: () => void }; meta?: string }
    | { type: 'progress'; value: string; meta: string; progress: { value: number; max: number; valueText: string } }
    | { type: 'trend'; value: string; trendPercent: number | null; meta?: string; valueTone?: 'success' }
  ) & {
    /** Compact padding (20). */
    compact?: boolean;
    /** Mobile mini card (171×104): smaller value. */
    mini?: boolean;
    /** Count the value up on mount (subtle dashboard motion). */
    countUp?: boolean;
  };

/** Split "$1,234.56" / "94%" into prefix, number, suffix for count-up; display stays string-formatted. */
function AnimatedValue({ value, animate }: { value: string; animate?: boolean }) {
  const m = value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!animate || !m) return <>{value}</>;
  const [, pre = '', num = '0', post = ''] = m;
  const decimals = num.includes('.') ? num.split('.')[1]!.length : 0;
  const n = Number(num.replace(/,/g, ''));
  const fmt = (x: number) => `${pre}${x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${post}`;
  return <CountUp value={n} format={fmt} />;
}

/** KPI stat card (Doc 02 §5.26): 136 high, radius 16, Shadow/XS, padding 24; Balance is the one dark card. */
export function StatCard(props: StatCardProps) {
  const id = useId();
  const { label, className, compact, mini, countUp } = props;
  const dark = props.type === 'balance';
  const valueClass = cn(
    'font-display tabular-nums',
    mini ? 'text-num-lg' : 'text-num-xl',
    dark ? 'text-fg-inverse' : props.type === 'trend' && props.valueTone === 'success' ? 'text-fg-success' : 'text-fg',
  );
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'relative flex flex-col rounded-card shadow-xs',
        mini ? 'min-h-[104px] p-4' : compact ? 'min-h-[96px] p-5' : 'min-h-[136px] p-6',
        dark ? 'bg-inverse' : 'border border-line bg-surface',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id} className={cn('text-body-sm', dark ? 'text-fg-inverse-secondary' : 'text-fg-secondary')}>
            {label}
          </h3>
          <p className={cn(valueClass, 'mt-1')}>
            <AnimatedValue value={props.value} animate={countUp} />
          </p>
        </div>
        {props.type === 'balance' && props.action ? (
          <Button size="S" href={props.action.href} onClick={props.action.onClick} className="mt-0.5 min-w-[104px]">
            {props.action.label}
          </Button>
        ) : null}
        {props.type === 'progress' ? <p className="mt-9 shrink-0 text-body-xs text-fg-tertiary">{props.meta}</p> : null}
      </div>
      <div className="mt-auto pt-3">
        {props.type === 'default' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {props.badge ? <StatusBadge tone={props.badge.tone} label={props.badge.label} /> : null}
            {props.meta ? <span className="text-body-xs text-fg-tertiary">{props.meta}</span> : null}
          </div>
        ) : null}
        {props.type === 'balance' && props.meta ? <p className="text-body-xs text-fg-inverse-secondary">{props.meta}</p> : null}
        {props.type === 'progress' ? <Progress tone="success" {...props.progress} /> : null}
        {props.type === 'trend' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {props.trendPercent !== null ? <TrendChip percent={props.trendPercent} /> : null}
            {props.meta ? <span className="text-body-xs text-fg-tertiary">{props.meta}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Trend chip: positive success + trending-up; negative danger + trending-down; zero neutral "—". */
export function TrendChip({ percent }: { percent: number }) {
  const tone = percent > 0 ? 'bg-success-subtle text-fg-success' : percent < 0 ? 'bg-danger-subtle text-fg-danger' : 'bg-muted text-fg-secondary';
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1 rounded-[11px] px-2 text-label-sm font-semibold tabular-nums', tone)}>
      {percent !== 0 ? <Icon name={percent > 0 ? 'trending-up' : 'trending-down'} size={14} /> : null}
      {percent === 0 ? '—' : `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`}
    </span>
  );
}
