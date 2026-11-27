import type { Metadata } from 'next';
import type { PublicCategory } from '@24f/shared';
import { apiTry, LIVE } from '@/lib/api/server';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { CategorySearch } from '@/components/public/categories/CategorySearch';

// Open-job counts per category are live.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Job categories',
  description: 'Find microtasks by category — data entry, surveys, testing, writing and more — with live open-job counts and average rewards.',
  alternates: { canonical: '/jobs/categories' },
};

/** SCR-PUB-04 directory only (Figma 21:1053). Typing a search switches the URL to /jobs/search. */
export default async function CategoriesPage() {
  const cats = await apiTry<PublicCategory[]>('/public/categories', LIVE);
  return (
    <MarketingMotion>
      <CategorySearch categories={cats?.data ?? []} initialQuery="" initialTab="all" initial={null} initialCounts={null} />
    </MarketingMotion>
  );
}
