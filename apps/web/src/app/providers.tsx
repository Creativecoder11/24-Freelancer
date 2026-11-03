'use client';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@24f/ui';
import { ApiError, onSessionExpired } from '@/lib/api/client';

const PROTECTED = /^\/(worker|employer|onboarding)(\/|$)/;

/** Root client providers: TanStack Query, toasts, and the global session-expired redirect. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(
    () =>
      onSessionExpired(() => {
        client.removeQueries({ queryKey: ['me'] });
        const { pathname, search } = window.location;
        if (PROTECTED.test(pathname)) {
          const next = encodeURIComponent(pathname + search);
          window.location.replace(`/login?next=${next}&reason=session_expired`);
        }
      }),
    [client],
  );

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
