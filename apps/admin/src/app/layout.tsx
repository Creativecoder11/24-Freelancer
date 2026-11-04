import type { Metadata } from 'next';
import { ToastProvider } from '@24f/ui';
import { bricolage, inter } from '@/lib/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '24F Admin', template: '%s · 24F Admin' },
  description: 'Staff-only admin panel for 24 Freelancing.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bricolage.variable} ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')" }} />
      </head>
      <body className="bg-canvas">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
