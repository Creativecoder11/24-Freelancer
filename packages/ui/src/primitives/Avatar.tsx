'use client';
import { useState } from 'react';
import { cn } from '../utils/cn';
import type { WithClassName } from '../types';

type AvatarTone = 'brand' | 'success' | 'warning' | 'info' | 'accent';

export interface AvatarProps extends WithClassName {
  /** From the API: "NJ". Use `initialsFrom()` only for business/display names already masked by the server. */
  initials: string;
  /** Falls back to initials on load error. */
  src?: string | null;
  size?: 'S' | 'M' | 'L' | 'XL';
  /** square = logo tile (radius 14). */
  shape?: 'circle' | 'square';
  /** Picks a subtle pair deterministically (lists of many people). */
  colorSeed?: string;
  tone?: AvatarTone;
  /** When set: role="img" + aria-label. When absent: aria-hidden (decorative next to the name). */
  name?: string;
}

const SIZE = {
  S: 'size-8 text-label-sm font-semibold',
  M: 'size-10 text-label-md',
  L: 'size-14 text-h5 font-semibold',
  XL: 'size-16 font-display text-h4',
};
const TONES: Record<AvatarTone, string> = {
  brand: 'bg-brand-subtle text-fg-brand',
  success: 'bg-success-subtle text-fg-success',
  warning: 'bg-warning-subtle text-fg-warning',
  info: 'bg-info-subtle text-fg-info',
  accent: 'bg-accent-subtle text-fg-accent',
};
const SEEDED: AvatarTone[] = ['brand', 'success', 'warning', 'info', 'accent'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials avatar (Doc 02 §5.25): S 32 · M 40 · L 56 · XL 64. */
export function Avatar({ initials, src, size = 'M', shape = 'circle', colorSeed, tone, name, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const t: AvatarTone = tone ?? (colorSeed ? SEEDED[hash(colorSeed) % SEEDED.length]! : 'brand');
  const showImg = src && !failed;
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden uppercase',
        shape === 'circle' ? 'rounded-full' : 'rounded-[14px]',
        SIZE[size],
        !showImg && TONES[t],
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials.slice(0, 2)
      )}
    </span>
  );
}

/** First letters of first + last name ("Nusrat Jahan" → "NJ"); businesses → first two letters ("Shelfwise" → "SH"). */
export function initialsFrom(name: string, kind: 'person' | 'business' = 'person'): string {
  const clean = name.trim();
  if (!clean) return '';
  if (kind === 'business') return clean.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
  const parts = clean.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * Display-only masking helper ("Rahman" → "Ra***n"; < 4 chars → first letter + ***).
 * Real masking is server-side (Doc 02 §5.25); use this only for previews/tests.
 */
export function maskName(name: string): string {
  const n = name.trim();
  if (n.length < 4) return `${n.charAt(0)}***`;
  return `${n.slice(0, 2)}***${n.slice(-1)}`;
}
