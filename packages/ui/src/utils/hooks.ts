'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Subscribe to a media query. Returns `fallback` on the server. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** Below 768 px (Doc 02 §12.1). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767.98px)');
}

export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const mobile = useMediaQuery('(max-width: 767.98px)');
  const desktop = useMediaQuery('(min-width: 1280px)', true);
  return mobile ? 'mobile' : desktop ? 'desktop' : 'tablet';
}

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Controlled/uncontrolled value helper. */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? (value as T) : inner;
  const set = useCallback(
    (v: T) => {
      if (!isControlled) setInner(v);
      onChange?.(v);
    },
    [isControlled, onChange],
  );
  return [current, set] as const;
}

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('data-focus-skip') && el.getClientRects().length > 0,
  );
}

/**
 * Traps Tab inside `ref` while active, moves initial focus and returns focus to the
 * previously focused element (or `fallbackReturn`) when deactivated (Doc 02 §7.1).
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  opts: { initialFocus?: React.RefObject<HTMLElement | null>; fallbackReturn?: () => HTMLElement | null } = {},
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusFirst = () => {
      const target =
        optsRef.current.initialFocus?.current ??
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        getFocusable(root)[0] ??
        root;
      target.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = getFocusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      const back = previous && previous.isConnected ? previous : optsRef.current.fallbackReturn?.();
      back?.focus?.({ preventScroll: true });
    };
  }, [active, ref]);
}

let lockCount = 0;
let savedOverflow = '';
let savedPadding = '';
/** Locks body scroll with scrollbar compensation (Doc 02 §7.1 rule 7). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (lockCount === 0) {
      const sbw = window.innerWidth - document.documentElement.clientWidth;
      savedOverflow = body.style.overflow;
      savedPadding = body.style.paddingRight;
      body.style.overflow = 'hidden';
      if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0) {
        body.style.overflow = savedOverflow;
        body.style.paddingRight = savedPadding;
      }
    };
  }, [active]);
}

export function useEscape(active: boolean, handler: (e: KeyboardEvent) => void) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') h.current(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

export function useOutsideClick(
  refs: React.RefObject<HTMLElement | null>[],
  active: boolean,
  handler: (e: PointerEvent) => void,
) {
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      h.current(e);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (t.current) clearTimeout(t.current);
  }, []);
  const call = useCallback(
    (...a: A) => {
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => fnRef.current(...a), ms);
    },
    [ms],
  );
  const cancel = useCallback(() => {
    if (t.current) clearTimeout(t.current);
  }, []);
  return [call, cancel] as const;
}
