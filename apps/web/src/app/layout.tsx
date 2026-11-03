import type { Metadata } from 'next';
import { bricolage, caveat, inter } from '@/lib/fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '24 Freelancing — Earn from small tasks, or get them done', template: '%s · 24 Freelancing' },
  description:
    'A microtask marketplace. Earn from small online tasks, or get work done by many people at once.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bricolage.variable} ${inter.variable} ${caveat.variable}`}>
      <head>
        {/* Enable hide-before-animate only when JS runs and motion is allowed (GSAP takes over). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
