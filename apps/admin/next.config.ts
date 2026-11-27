import type { NextConfig } from 'next';

/** API origin; `/api/v1/*` is proxied so the `fl_admin_rt` cookie stays same-origin (Doc 09 §22.5). */
const API_ORIGIN = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

/** Baseline security headers: no framing by other sites (clickjacking), no MIME sniffing, HSTS. */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

const nextConfig: NextConfig = {
  basePath: '/admin',
  transpilePackages: ['@24f/ui', '@24f/shared'],
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*`, basePath: false }];
  },
  async redirects() {
    return [
      { source: '/', destination: '/admin', permanent: false, basePath: false },
      { source: '/favicon.ico', destination: '/admin/favicon.ico', permanent: false, basePath: false },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, ...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
