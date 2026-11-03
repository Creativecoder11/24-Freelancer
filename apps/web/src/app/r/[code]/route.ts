import { NextResponse, type NextRequest } from 'next/server';

/** Invite links `/r/CODE` (FR-REF-001): remember the code for 30 days, then open sign-up. */
export function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return params.then(({ code }) => {
    const clean = decodeURIComponent(code).trim().toUpperCase();
    const url = req.nextUrl.clone();
    url.pathname = '/signup';
    url.search = '';
    if (!/^[A-Z0-9]{4,12}$/.test(clean)) return NextResponse.redirect(url);
    url.searchParams.set('ref', clean);
    const res = NextResponse.redirect(url);
    res.cookies.set('fl_ref', clean, {
      maxAge: 30 * 86400, // referral_cookie_days
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
    return res;
  });
}
