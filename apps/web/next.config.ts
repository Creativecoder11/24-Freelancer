import type { NextConfig } from 'next';

/** API origin the web server proxies `/api/v1/*` to (same-origin cookies in dev and behind one host). */
const API_ORIGIN = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

const nextConfig: NextConfig = {
  transpilePackages: ['@24f/ui', '@24f/shared'],
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
};

export default nextConfig;
