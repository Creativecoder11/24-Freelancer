import type { Metadata, Viewport } from 'next';
import { bricolage, caveat, inter } from '@/lib/fonts';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — Earn from small tasks, or get them done`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'microtask',
    'micro jobs',
    'earn money online',
    'online tasks',
    'small tasks',
    'freelancing Bangladesh',
    'earn with bKash',
    'surveys',
    'data entry',
    'app testing',
    'website testing',
    'crowdsourcing',
    'hire workers online',
  ],
  category: 'business',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    url: '/',
    title: `${SITE_NAME} — Earn from small tasks, or get them done`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Earn from small tasks, or get them done`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  // Google Search Console "HTML tag" method: set GOOGLE_SITE_VERIFICATION to the content value.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: '#004488' };

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
      <body className="bg-surface">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
