import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@24f/ui', '@24f/shared'],
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
};

export default nextConfig;
