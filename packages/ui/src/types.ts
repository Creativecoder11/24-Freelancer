// Shared types (Doc 03 §5)
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
export type ControlSize = 'L' | 'M' | 'S';
export interface WithClassName {
  className?: string;
}

/** Server-synchronised clock (Doc 03 §7.6). The API client provides the real one. */
export interface ServerClock {
  now(): number;
  offsetMs?(): number;
  subscribe?(cb: () => void): () => void;
}
