/** Hand-drawn arrow (Figma 70:382 / 70:386), drawn in by GSAP via [data-draw]. */
export function HandArrow({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg data-draw viewBox="0 0 96 48" fill="none" className={className} style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden>
      <path d="M92 38C70 44 34 42 12 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8 26L11 12L25 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
