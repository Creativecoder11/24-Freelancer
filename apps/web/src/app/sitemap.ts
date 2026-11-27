import type { MetadataRoute } from 'next';
import type { HelpArticleRow, HelpTopic, JobCard } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { abs } from '@/lib/site';

// Rebuilt at most hourly, so new jobs and help articles reach Google without a deploy.
export const revalidate = 3600;

const STATIC: { path: string; priority: number; changeFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/jobs', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/jobs/categories', priority: 0.7, changeFrequency: 'daily' },
  { path: '/how-it-works', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/referral-program', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/payout-history', priority: 0.6, changeFrequency: 'daily' },
  { path: '/help', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/refund', priority: 0.3, changeFrequency: 'monthly' },
];

async function openJobs(): Promise<JobCard[]> {
  const out: JobCard[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await apiTry<JobCard[], { has_more?: boolean }>(`/public/jobs?per_page=100&page=${page}`, 3600);
    if (!r) break;
    out.push(...r.data);
    if (!r.meta?.has_more) break;
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [jobs, topics, articles] = await Promise.all([
    openJobs(),
    apiTry<HelpTopic[]>('/public/help/topics', 3600),
    apiTry<HelpArticleRow[]>('/public/help/articles', 3600),
  ]);

  return [
    ...STATIC.map((s) => ({ url: abs(s.path), lastModified: now, changeFrequency: s.changeFrequency, priority: s.priority })),
    ...jobs.map((j) => ({ url: abs(`/jobs/${j.public_id}`), lastModified: j.published_at ? new Date(j.published_at) : now, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...(topics?.data ?? []).map((t) => ({ url: abs(`/help/${t.slug}`), lastModified: now, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...(articles?.data ?? []).map((a) => ({ url: abs(`/help/${a.topic_slug}/${a.slug}`), lastModified: now, changeFrequency: 'monthly' as const, priority: 0.5 })),
  ];
}
