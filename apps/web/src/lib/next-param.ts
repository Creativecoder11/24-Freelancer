const ALLOWED_PREFIX = /^\/(?!\/|\\)/;

/** Returns a safe same-site relative path, or null (Doc 03 §2.6). */
export function safeNext(input: string | null | undefined): string | null {
  if (!input) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }
  if (!ALLOWED_PREFIX.test(decoded)) return null; // rejects //evil.com and /\evil.com
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(decoded)) return null;
  if (decoded.includes('://')) return null;
  if (decoded.startsWith('/login') || decoded.startsWith('/signup')) return null; // no loops
  return decoded;
}

/**
 * Where to go after authentication: onboarding (`next_path` while unfinished) always wins,
 * then a safe `next`, then the overview for the active mode.
 */
export function postAuthPath(user: { next_path: string; active_mode: 'worker' | 'employer' }, next: string | null | undefined) {
  if (user.next_path.startsWith('/onboarding')) return user.next_path;
  return safeNext(next) ?? user.next_path ?? (user.active_mode === 'employer' ? '/employer' : '/worker');
}
