import { cn } from '../utils/cn';
import { LOGO_PATHS } from '../brand/logo-paths';
import type { WithClassName } from '../types';

export interface LogoProps extends WithClassName {
  type?: 'horizontal' | 'badge' | 'mark';
  theme?: 'default' | 'inverse';
  /** true → aria-hidden (decorative stickers). */
  decorative?: boolean;
  /** Render height in px; width follows the aspect ratio. Defaults to Figma sizes (36 / 96 / 32). */
  height?: number;
}

const SIZES = { horizontal: [171, 36], badge: [96, 96], mark: [53.168, 32] } as const;

/**
 * 24 Freelancing logo, traced vectors exported from Figma 6:21. Colour is locked to
 * brand/600 (#004488, via --fl-brand-600) or white on inverse.
 */
export function Logo({ type = 'horizontal', theme = 'default', decorative = false, height, className }: LogoProps) {
  const def = LOGO_PATHS[type];
  const [w, h] = SIZES[type];
  const renderH = height ?? h;
  const renderW = (w / h) * renderH;
  return (
    <svg
      width={renderW}
      height={renderH}
      viewBox={def.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block shrink-0', theme === 'inverse' ? 'text-fg-inverse' : 'text-brand-600', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : '24 Freelancing'}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      {def.paths.map((p, i) =>
        p.stroke ? (
          <path key={i} d={p.d} stroke="currentColor" strokeWidth={p.sw ?? 2} fill="none" />
        ) : (
          <path key={i} d={p.d} fill="currentColor" fillRule={p.evenodd ? 'evenodd' : undefined} clipRule={p.evenodd ? 'evenodd' : undefined} />
        ),
      )}
    </svg>
  );
}
