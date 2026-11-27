import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Private areas (dashboards, sign-in flows, referral redirects, API) stay out of search and AI indexes. */
const PRIVATE = ['/worker', '/employer', '/onboarding', '/login', '/signup', '/verify', '/forgot-password', '/reset-password', '/r/', '/dev', '/api/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      // AI assistants and answer engines may read the public pages (and /llms.txt) so they describe
      // 24 Freelancing accurately when people ask about it.
      { userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot'], allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
