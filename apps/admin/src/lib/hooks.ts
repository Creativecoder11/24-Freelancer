'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@24f/ui';
import { api, ApiError, type CallOpts, type Envelope } from './api';

/** Fetches `path` and refetches on dependency change, window focus and every `pollMs` (Doc 09 §5.4 rule 6). */
export function useApi<T>(path: string | null, query?: CallOpts['query'], opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<{ data: T | null; meta: Envelope<T>['meta']; error: ApiError | null; loading: boolean }>({ data: null, meta: undefined, error: null, loading: !!path });
  const key = path ? `${path}${JSON.stringify(query ?? {})}` : null;
  const seq = useRef(0);
  const load = useCallback(
    async (background = false) => {
      if (!path) return;
      const n = ++seq.current;
      if (!background) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const r = await api<T>(path, { query, background });
        if (n === seq.current) setState({ data: r.data, meta: r.meta, error: null, loading: false });
      } catch (e) {
        if (n === seq.current) setState((s) => ({ ...s, error: e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)), loading: false }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!path) return;
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    const t = opts.pollMs ? setInterval(() => void load(true), opts.pollMs) : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (t) clearInterval(t);
    };
  }, [load, path, opts.pollMs]);
  return { ...state, reload: () => load(true), hardReload: () => load(false) };
}

/** Shared error copy (Doc 09 §5.3). Returns field errors for forms. */
export function reportError(e: unknown): Record<string, string[]> | undefined {
  if (!(e instanceof ApiError)) {
    toast.error('Something went wrong', String(e));
    return;
  }
  if (e.code === 'REAUTH_CANCELLED') return;
  if (e.code === 'ADMIN_FORBIDDEN') toast.error("Your role can't do this.", e.message !== "Your role can't do this." ? e.message : undefined);
  else if (e.code === 'SELF_APPROVAL_FORBIDDEN') toast.error('A different admin must approve this.');
  else if (e.code === 'ALREADY_DECIDED' || (e.code === 'INVALID_STATE' && !e.fields)) toast.warning(e.message && e.code === 'INVALID_STATE' ? e.message : "This was already handled by someone else. We've refreshed the list.");
  else if (e.code === 'RATE_LIMITED') toast.error('Too many requests. Wait a moment and try again.');
  else if (e.status >= 500 || e.code === 'PROVIDER_UNAVAILABLE') toast.error(e.message, e.requestId ? `Reference: ${e.requestId}` : undefined);
  else if (!e.fields) toast.error(e.message);
  return e.fields;
}

/** URL-synced filters (Doc 09 §2.4 rule 5). Never put PII in these. */
export function useUrlState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string, d = '') => sp.get(k) ?? d;
  const set = (patch: Record<string, string | null | undefined>, resetPage = true) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
    if (resetPage && !('page' in patch)) p.delete('page');
    const s = p.toString();
    router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
  };
  return { get, set, sp };
}

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
