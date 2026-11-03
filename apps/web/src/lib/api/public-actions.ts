'use server';
import { headers } from 'next/headers';
import type { ContactInput, JobCard } from '@24f/shared';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1';

export interface SearchMeta {
  total: number;
  per_page: number;
  next_cursor: string | null;
  has_more: boolean;
  counts: Record<string, number>;
}
export type SearchResult = { ok: true; data: JobCard[]; meta: SearchMeta } | { ok: false };

/** GET /public/search (SCR-PUB-04). Runs on the server so the browser never needs CORS for the API. */
export async function searchJobsAction(params: { q: string; category?: string | null; cursor?: string | null }): Promise<SearchResult> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.category && params.category !== 'all') qs.set('category', params.category);
  if (params.cursor) qs.set('cursor', params.cursor);
  try {
    const res = await fetch(`${API}/public/search?${qs}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false };
    const body = await res.json();
    return { ok: true, data: body.data ?? [], meta: body.meta };
  } catch {
    return { ok: false };
  }
}

export type ContactResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message?: string; fields?: Record<string, string[]> };

/** POST /public/contact (SCR-PUB-08). Forwards the visitor IP so API rate limits apply per visitor. */
export async function sendContactAction(input: ContactInput): Promise<ContactResult> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  try {
    const res = await fetch(`${API}/public/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(fwd ? { 'x-forwarded-for': fwd } : {}) },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    return { ok: false, status: res.status, code: body?.error?.code ?? 'UNKNOWN', message: body?.error?.message, fields: body?.error?.fields };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
}
