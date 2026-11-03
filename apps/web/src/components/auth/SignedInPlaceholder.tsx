'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ActiveMode } from '@24f/shared';
import { Button, Logo, toast } from '@24f/ui';
import { api } from '@/lib/api/client';
import { RequireSession, meKey, useLogout } from '@/lib/auth/session';

/**
 * TEMPORARY placeholder for /worker and /employer until the dashboard shells land. Shows who is
 * signed in, keeps `active_mode` in sync with the route (ModeSync) and offers log out.
 */
export function SignedInPlaceholder({ mode }: { mode: ActiveMode }) {
  const logout = useLogout();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const sync = useMutation({
    mutationFn: () => api.patch('/me/preferences', { active_mode: mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  return (
    <RequireSession>
      {(me) => (
        <ModeSync current={me.active_mode} mode={mode} onSync={() => sync.mutate()}>
          <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-5 text-center">
            <Logo />
            <div>
              <p className="text-overline uppercase text-fg-brand">{mode === 'employer' ? 'Employer' : 'Worker'} · ID {me.public_id}</p>
              <h1 className="mt-2 font-display text-h2 text-fg">
                Signed in as {mode === 'employer' && me.employer ? me.employer.business_name : me.full_name}
              </h1>
              <p className="mt-2 text-body-md text-fg-secondary">{me.email ?? me.phone_masked}</p>
            </div>
            <Button
              variant="secondary"
              size="L"
              loading={leaving}
              loadingText="Signing out…"
              onClick={async () => {
                setLeaving(true);
                await logout('/login');
                toast.show({ tone: 'info', title: 'You’re signed out.' });
              }}
            >
              Log out
            </Button>
          </main>
        </ModeSync>
      )}
    </RequireSession>
  );
}

function ModeSync({ current, mode, onSync, children }: { current: ActiveMode; mode: ActiveMode; onSync: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (current !== mode) onSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, mode]);
  return <>{children}</>;
}
