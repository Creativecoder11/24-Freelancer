'use client';
import { useEffect, useState } from 'react';
import { Navbar } from '@24f/ui';
import { getAccessToken, hasSessionHint, isSignedOutError } from '@/lib/api/client';
import { signedInDestination, useMe } from '@/lib/auth/session';

/**
 * Public navbar that swaps the auth buttons for "Open dashboard" when the visitor is signed in.
 * Read on the client so public pages stay statically rendered (the home page is ISR).
 */
export function PublicNavbar() {
  const [hinted, setHinted] = useState(false);
  useEffect(() => setHinted(hasSessionHint() || !!getAccessToken()), []);
  const me = useMe();

  const signedOut = me.isError && isSignedOutError(me.error);
  const signedIn = !!me.data || (hinted && !signedOut);
  const href = me.data ? signedInDestination(me.data) : '/worker';

  return <Navbar signedInHref={signedIn ? href : undefined} />;
}
