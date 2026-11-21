import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from './lib/next-param';

const PROTECTED = [/^\/worker(\/|$)/, /^\/employer(\/|$)/, /^\/onboarding(\/|$)/];

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|icons|api/).*)'],
};

/**
 * Edge gate (Doc 03 §2.4). `fl_session=1` is a non-sensitive hint set by the API; it grants
 * nothing. Guests opening a signed-in area go to /login?next=… before render.
 * Signed-in users on /login are redirected client-side (GuestOnlyGate), not here.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // One host for the site: www.<domain> → <domain>. Login cookies belong to the exact host that set
  // them, so with both hosts live a sign-in on one looked signed out on the other (Post a job → login).
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0]!.trim().toLowerCase();
  if (host.startsWith('www.')) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, `https://${host.slice(4)}`), 308);
  }

  const hasSession = req.cookies.get('fl_session')?.value === '1';
  if (!hasSession && PROTECTED.some((re) => re.test(pathname))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    const next = safeNext(pathname + search);
    if (next) url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
