import type { Metadata } from 'next';
import type { JobCard, PublicCategory } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import type { SearchMeta } from '@/lib/api/public-actions';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { CategorySearch } from '@/components/public/categories/CategorySearch';

type Props = { searchParams: Promise<{ q?: string; tab?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q = '' } = await searchParams;
  return {
    title: q.trim() ? `Results for “${q.trim()}”` : 'Search jobs',
    description: 'Search open microtasks by what you’ll do or by the proof required. Results update as you type.',
    robots: { index: false },
  };
}

/** SCR-PUB-04 directory + keyword results (Figma 21:1053). */
export default async function SearchPage({ searchParams }: Props) {
  const { q: rawQ = '', tab: rawTab = 'all' } = await searchParams;
  const q = rawQ.trim().slice(0, 100);
  const searching = q.length >= 2;
  const enc = encodeURIComponent(q);
  const [cats, all, filtered] = await Promise.all([
    apiTry<PublicCategory[]>('/public/categories'),
    searching ? apiTry<JobCard[], SearchMeta>(`/public/search?q=${enc}`, 30) : null,
    searching && rawTab !== 'all' ? apiTry<JobCard[], SearchMeta>(`/public/search?q=${enc}&category=${encodeURIComponent(rawTab)}`, 30) : null,
  ]);
  const tab = rawTab !== 'all' && filtered ? rawTab : 'all';
  const current = tab === 'all' ? all : filtered;
  return (
    <MarketingMotion>
      <CategorySearch
        categories={cats?.data ?? []}
        initialQuery={q}
        initialTab={tab}
        initial={current?.meta ? { jobs: current.data, meta: current.meta } : null}
        initialCounts={all?.meta ? { total: all.meta.total, counts: all.meta.counts } : null}
      />
    </MarketingMotion>
  );
}
