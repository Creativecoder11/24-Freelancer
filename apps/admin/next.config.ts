import type { NextConfig } from 'next';

/** API origin; `/api/v1/*` is proxied so the `fl_admin_rt` cookie stays same-origin (Doc 09 §22.5). */
const API_ORIGIN = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

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
    return [{ source: '/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
