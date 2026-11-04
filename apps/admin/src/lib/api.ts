'use client';
/**
 * Admin API client (Doc 09 §2.4, §5.3, §22). Access token lives in memory only; the refresh
 * cookie `fl_admin_rt` is httpOnly on `/api/v1/admin/auth`. 401s refresh once; 401
 * ADMIN_REAUTH_REQUIRED opens the re-auth dialog and retries with the same Idempotency-Key.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string[]>,
    public details?: Record<string, unknown>,
    public requestId?: string,
  ) {
    super(message);
  }
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown> & { total?: number; page?: number; per_page?: number; total_pages?: number; counts?: Record<string, number> };
  status: number;
}

let token: string | null = null;
let refreshing: Promise<boolean> | null = null;
let expiredHandler: (() => void) | null = null;
let reauthHandler: (() => Promise<boolean>) | null = null;

export const setToken = (t: string | null) => {
  token = t;
};
export const hasToken = () => !!token;
export const onSessionExpired = (fn: () => void) => {
  expiredHandler = fn;
};
export const onReauthRequired = (fn: () => Promise<boolean>) => {
  reauthHandler = fn;
};

export const newIdemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

const BASE = '/api/v1';

let lastRefreshOk = 0;

export async function refreshSession(): Promise<boolean> {
  // The refresh cookie rotates on every use: never send it twice in a row (StrictMode double effects).
  if (token && Date.now() - lastRefreshOk < 5000) return true;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${BASE}/admin/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!r.ok) return false;
      const j = await r.json();
      token = j.data.access_token;
      lastRefreshOk = Date.now();
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 1000);
    }
  })();
  return refreshing;
}

export interface CallOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idem?: string;
  background?: boolean;
  raw?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export function qs(q?: CallOpts['query']) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function doFetch(path: string, o: CallOpts) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.idem) headers['idempotency-key'] = o.idem;
  if (o.background) headers['x-admin-background'] = '1';
  return fetch(`${BASE}${path}${qs(o.query)}`, { method: o.method ?? 'GET', headers, credentials: 'include', body: o.body !== undefined ? JSON.stringify(o.body) : undefined, cache: 'no-store' });
}

async function toError(r: Response): Promise<ApiError> {
  try {
    const j = await r.json();
    const e = j.error ?? {};
    return new ApiError(r.status, e.code ?? 'ERROR', e.message ?? 'Something went wrong.', e.fields, e.details, e.request_id);
  } catch {
    return new ApiError(r.status, 'NETWORK', 'Check your connection and try again.');
  }
}

/** Raw call returning the Response (CSV downloads). Handles refresh and re-auth like `api`. */
export async function apiRaw(path: string, o: CallOpts = {}, attempt = 0): Promise<Response> {
  let r: Response;
  try {
    r = await doFetch(path, o);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Check your connection and try again.');
  }
  if (r.ok) return r;
  const err = await toError(r.clone());
  if (r.status === 401 && attempt < 2) {
    if (err.code === 'ADMIN_REAUTH_REQUIRED' && reauthHandler) {
      if (await reauthHandler()) return apiRaw(path, o, attempt + 1);
      throw new ApiError(401, 'REAUTH_CANCELLED', 'Confirmation cancelled.');
    }
    if (['TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(err.code) && !path.startsWith('/admin/auth/')) {
      if (await refreshSession()) return apiRaw(path, o, attempt + 1);
    }
    if (['SESSION_EXPIRED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(err.code) && !path.startsWith('/admin/auth/')) expiredHandler?.();
  }
  throw err;
}

export async function api<T = unknown>(path: string, o: CallOpts = {}): Promise<Envelope<T>> {
  const r = await apiRaw(path, o);
  const j = await r.json();
  return { data: j.data as T, meta: j.meta, status: r.status };
}

/** Saves a CSV/streamed response as a file. Returns response headers. */
export async function download(path: string, o: CallOpts = {}, fallbackName = 'export.csv') {
  const r = await apiRaw(path, o);
  const blob = await r.blob();
  const cd = r.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return r.headers;
}
