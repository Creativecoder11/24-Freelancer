import type { Metadata } from 'next';
import { Breadcrumbs, Button, JobCard, Pagination } from '@24f/ui';
import type { JobCard as JobCardT, ListMeta, PublicCategory } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { toCardData } from '@/lib/jobs';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { BrowseFilters } from '@/components/jobs/BrowseFilters';
import { ActiveFilters, BrowseSearch } from '@/components/jobs/BrowseToolbar';
import { parseFilters, toQuery } from '@/components/jobs/query';

export const metadata: Metadata = {
  title: 'Browse all jobs',
  description: 'Open microjobs on 24 Freelancing. Every job shows its reward, time and required proof up front.',
};

/** SCR-PUB-02 Browse all jobs (Figma 20:477). */
export default async function BrowsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const applied = parseFilters(await searchParams);
  const [jobs, all, cats] = await Promise.all([
    apiTry<JobCardT[], ListMeta>(`/public/jobs${toQuery(applied, { per_page: '8' })}`, 30),
    apiTry<JobCardT[], ListMeta>('/public/jobs?count_only=true', 60),
    apiTry<PublicCategory[]>('/public/categories', 60),
  ]);
  const meta = jobs?.meta;
  const totalOpen = all?.meta?.total ?? 0;
  const now = Date.now();
  const filtered = toQuery({ ...applied, page: 1 }) !== '';

  return (
    <MarketingMotion>
      <section className="border-b border-line-subtle">
        <div className="mx-auto max-w-container px-5 pb-10 pt-8 tablet:px-8 desktop:px-0">
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Browse jobs' }]} />
          <h1 data-reveal className="mt-4 font-display text-[36px] font-extrabold leading-[44px] tracking-[-1px] text-fg tablet:text-display-xl">
            Browse all jobs
          </h1>
          <p data-reveal className="mt-3 text-body-lg text-fg-secondary">
            {totalOpen} open jobs. Every job shows its reward, time and required proof up front.
          </p>
          <BrowseSearch applied={applied} />
        </div>
      </section>

      <div className="mx-auto grid max-w-container gap-8 px-5 py-8 tablet:px-8 [&>*]:min-w-0 desktop:grid-cols-[272px_904px] desktop:justify-between desktop:px-0">
        <BrowseFilters applied={applied} categories={cats?.data ?? []} />
        <section aria-label="Results">
          <p className="text-body-md text-fg-secondary">
            <span className="font-display text-h4 text-fg">{meta?.total ?? 0} jobs</span> {filtered ? 'match your filters' : 'open now'}
          </p>
          <ActiveFilters applied={applied} categories={cats?.data ?? []} />
          {jobs && jobs.data.length ? (
            <div data-reveal-group className="mt-6 grid gap-6 tablet:grid-cols-2">
              {jobs.data.map((j) => (
                <div data-reveal-item key={j.public_id}>
                  <JobCard job={toCardData(j, now)} href={`/jobs/${j.public_id}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-card border border-line bg-surface p-10 text-center">
              <p className="text-h5 text-fg">{jobs ? 'No jobs match these filters' : 'We couldn’t load jobs'}</p>
              <p className="mt-2 text-body-sm text-fg-secondary">
                {jobs ? 'Try fewer filters or a different search.' : 'Check your connection and try again.'}
              </p>
              <div className="mt-6">
                <Button href="/jobs" variant="secondary">
                  {jobs ? 'Clear all filters' : 'Try again'}
                </Button>
              </div>
            </div>
          )}
          {meta && meta.total_pages > 1 ? (
            <Pagination
              className="mt-10"
              page={meta.page}
              totalPages={meta.total_pages}
              total={meta.total}
              perPage={meta.per_page}
              itemLabel="jobs"
              hrefPattern={`/jobs${toQuery({ ...applied, page: 1 }, { page: '__PAGE__' })}`}
            />
          ) : null}
        </section>
      </div>
    </MarketingMotion>
  );
}
