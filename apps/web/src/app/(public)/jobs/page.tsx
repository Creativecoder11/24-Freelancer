import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Breadcrumbs, Button, JobRow, Pagination } from '@24f/ui';
import { COOKIE_NAMES, type JobCard as JobCardT, type ListMeta, type PublicCategory } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { toRowData } from '@/lib/jobs';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';
import { BrowseFilters } from '@/components/jobs/BrowseFilters';
import { ActiveFilters } from '@/components/jobs/BrowseToolbar';
import { LockedJobList } from '@/components/jobs/LockedJobList';
import { parseFilters, toQuery } from '@/components/jobs/query';

export const metadata: Metadata = {
  title: 'Browse all jobs',
  description: 'Open microjobs on 24 Freelancing. Every job shows its reward, time and required proof up front.',
};

/** Rows guests see (blurred) behind the sign-in prompt. */
const GUEST_PREVIEW_ROWS = 6;

/** SCR-PUB-02 Browse all jobs (Figma 20:477). */
export default async function BrowsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const applied = parseFilters(await searchParams);
  // `fl_session` is the API's signed-in hint (see middleware.ts). Guests get a blurred preview.
  const signedIn = (await cookies()).get(COOKIE_NAMES.session)?.value === '1';
  const [jobs, all, cats] = await Promise.all([
    apiTry<JobCardT[], ListMeta>(`/public/jobs${toQuery(applied, { per_page: '20' })}`, 30),
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
        </div>
      </section>

      <div className="mx-auto max-w-container px-5 py-8 tablet:px-8 desktop:px-0">
        <BrowseFilters applied={applied} categories={cats?.data ?? []} facets={meta?.facets?.category ?? {}} />
        <section aria-label="Results" className="mt-6">
          <p className="text-body-md text-fg-secondary">
            <span className="font-display text-h4 text-fg">{meta?.total ?? 0} jobs</span> {filtered ? 'match your filters' : 'open now'}
          </p>
          <ActiveFilters applied={applied} categories={cats?.data ?? []} />
          {jobs && jobs.data.length ? (
            signedIn ? (
              <ul className="mt-4 divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs">
                {jobs.data.map((j) => (
                  <JobRow key={j.public_id} job={toRowData(j, now)} href={`/jobs/${j.public_id}`} />
                ))}
              </ul>
            ) : (
              <LockedJobList next={`/jobs${toQuery(applied)}`} className="mt-4">
                {jobs.data.slice(0, GUEST_PREVIEW_ROWS).map((j) => (
                  <JobRow key={j.public_id} job={toRowData(j, now)} href={`/jobs/${j.public_id}`} />
                ))}
              </LockedJobList>
            )
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
          {signedIn && meta && meta.total_pages > 1 ? (
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
