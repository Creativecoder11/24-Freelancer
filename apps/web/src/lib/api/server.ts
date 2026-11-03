import 'server-only';
import type { ApiEnvelope } from '@24f/shared';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side GET for public data (RSC). Revalidates every `revalidate` seconds. */
export async function apiGet<T, M = Record<string, unknown>>(path: string, revalidate = 60): Promise<ApiEnvelope<T, M>> {
  const res = await fetch(`${API}${path}`, { next: { revalidate } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new ApiRequestError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Request failed');
  }
  return body as ApiEnvelope<T, M>;
}

/** Like apiGet but returns null on failure, for optional page sections. */
export async function apiTry<T, M = Record<string, unknown>>(path: string, revalidate = 60) {
  try {
    return await apiGet<T, M>(path, revalidate);
  } catch {
    return null;
  }
}
