'use client';
/**
 * Browser API client (Doc 03 §8). Same-origin `/api/v1` (Next rewrites proxy to the API), so the
 * httpOnly `fl_rt` cookie and the `fl_session` hint work without CORS.
 *
 * - Access token lives in memory only.
 * - On load, if `fl_session` is present, the first authenticated call runs a refresh.
 * - A 401 `TOKEN_EXPIRED` triggers one single-flight refresh, then the call is retried once.
 * - Errors are thrown as typed `ApiError` (the Doc 06 §4 envelope).
 */
import { COOKIE_NAMES, type ApiEnvelope, type ErrorCode, type ClientErrorCode, type RefreshResponse } from '@24f/shared';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | ClientErrorCode | string,
    message: string,
    public readonly fields: Record<string, string[]> = {},
    public readonly details: Record<string, unknown> = {},
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  is(...codes: string[]) {
    return codes.includes(this.code);
  }
}

// ----- token and session hint -----

let accessToken: string | null = null;
let accessExpiresAt = 0;
const tokenListeners = new Set<(t: string | null) => void>();
const expiredListeners = new Set<() => void>();

export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token: string | null, expiresInSeconds = 900) {
  accessToken = token;
  accessExpiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
  tokenListeners.forEach((l) => l(token));
}
export function onAccessToken(cb: (t: string | null) => void) {
  tokenListeners.add(cb);
  return () => void tokenListeners.delete(cb);
}
/** Fires when the refresh cookie is gone or revoked (Doc 06 §2.2 rule 4). */
export function onSessionExpired(cb: () => void) {
  expiredListeners.add(cb);
  return () => void expiredListeners.delete(cb);
}

export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(/;\s*/).some((c) => c === `${COOKIE_NAMES.session}=1`);
}
export function clearSessionHint() {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAMES.session}=; Max-Age=0; Path=/`;
}

// ----- low-level fetch -----

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | (string | number)[]>;
  /** Attach the bearer token (and refresh when needed). Default true. */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${url}?${qs}` : url;
}

async function raw<T>(path: string, opts: RequestOptions, token: string | null): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': 'web', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', "You're offline. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as (ApiEnvelope<T> & { error?: never }) | { error: { code: string; message: string; fields?: Record<string, string[]>; details?: Record<string, unknown>; request_id?: string } } | null;
  if (!res.ok || !json || 'error' in (json as object)) {
    const err = (json as { error?: { code: string; message: string; fields?: Record<string, string[]>; details?: Record<string, unknown>; request_id?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Something went wrong on our side. Try again in a moment.',
      err?.fields ?? {},
      err?.details ?? {},
      err?.request_id ?? null,
    );
  }
  return json as ApiEnvelope<T>;
}

// ----- single-flight refresh -----

let refreshing: Promise<string | null> | null = null;

/** Swaps the refresh cookie for an access token. One request in flight at a time. */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await raw<RefreshResponse>('/auth/refresh', { method: 'POST' }, null);
        setAccessToken(r.data.access_token, r.data.expires_in);
        return r.data.access_token;
      } catch (e) {
        // Another tab rotated the cookie a moment ago: wait and retry with the new cookie.
        if (e instanceof ApiError && e.code === 'REFRESH_RACE') {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
          continue;
        }
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) {
          setAccessToken(null);
          clearSessionHint();
          expiredListeners.forEach((l) => l());
          return null;
        }
        throw e;
      }
    }
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Full envelope (`data`, `meta`, `serverTime`). */
export async function apiFetch<T, M = Record<string, unknown>>(path: string, opts: RequestOptions = {}): Promise<ApiEnvelope<T, M>> {
  const auth = opts.auth ?? true;
  if (!auth) return raw<T>(path, opts, null) as Promise<ApiEnvelope<T, M>>;

  let token = accessToken;
  // Bootstrap (page load) or proactive refresh shortly before expiry.
  if ((!token && hasSessionHint()) || (token && Date.now() > accessExpiresAt - 15_000)) {
    token = (await refreshAccessToken()) ?? null;
  }
  try {
    return (await raw<T>(path, opts, token)) as ApiEnvelope<T, M>;
  } catch (e) {
    // Only TOKEN_EXPIRED refreshes; other 401s (INVALID_PASSWORD, INVALID_CREDENTIALS) are form errors.
    if (e instanceof ApiError && e.status === 401 && e.code === 'TOKEN_EXPIRED') {
      const next = await refreshAccessToken();
      if (next) return (await raw<T>(path, opts, next)) as ApiEnvelope<T, M>;
      throw new ApiError(401, 'SESSION_EXPIRED', 'Your session ended. Sign in again.');
    }
    if (e instanceof ApiError && (e.code === 'SESSION_EXPIRED' || e.code === 'ACCOUNT_SUSPENDED' || e.code === 'ACCOUNT_CLOSED')) {
      setAccessToken(null);
      clearSessionHint();
      expiredListeners.forEach((l) => l());
    }
    throw e;
  }
}

/** Convenience wrappers returning `data` only. */
export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) => apiFetch<T>(path, { ...opts, method: 'GET' }).then((r) => r.data),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body: body ?? {} }).then((r) => r.data),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', body: body ?? {} }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body: body ?? {} }).then((r) => r.data),
  delete: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) => apiFetch<T>(path, { ...opts, method: 'DELETE' }).then((r) => r.data),
};

/** Sign out: revokes the session server-side, clears token and hint. */
export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* idempotent */
  }
  setAccessToken(null);
  clearSessionHint();
}
