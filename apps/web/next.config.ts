import type { NextConfig } from 'next';

/** API origin the web server proxies `/api/v1/*` to (same-origin cookies in dev and behind one host). */
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
  transpilePackages: ['@24f/ui', '@24f/shared'],
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
