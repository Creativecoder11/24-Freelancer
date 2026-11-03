import type { Metadata } from 'next';
import { bricolage, caveat, inter } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '24 Freelancing — Earn from small tasks, or get them done', template: '%s · 24 Freelancing' },
  description:
    'A microtask marketplace. Earn from small online tasks, or get work done by many people at once.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
