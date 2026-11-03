'use client';
import { createPortal } from 'react-dom';
import { useMounted } from './hooks';

export function Portal({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(children, document.body);
}
