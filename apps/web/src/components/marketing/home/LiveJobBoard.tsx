'use client';
import { useState, useTransition } from 'react';
import NextLink from 'next/link';
import { FilterChip, Icon, JobRow, gsap } from '@24f/ui';
import type { JobCard, PublicCategory } from '@24f/shared';
import { toRowData } from '@/lib/jobs';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** "Open jobs right now" (Figma 18:608): category chips filter a 6-row live list. */
export function LiveJobBoard({ initial, categories, total }: { initial: JobCard[]; categories: PublicCategory[]; total: number }) {
  const [active, setActive] = useState<string>('all');
  const [jobs, setJobs] = useState(initial);
  const [pending, start] = useTransition();
  const now = Date.now();

  async function pick(slug: string) {
    setActive(slug);
    start(async () => {
      const qs = slug === 'all' ? '' : `&category=${slug}`;
      const res = await fetch(`${API}/public/jobs?per_page=6${qs}`).then((r) => r.json());
      setJobs(res.data ?? []);
      requestAnimationFrame(() => {
        gsap.fromTo('.live-board li', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.04, ease: 'power2.out' });
      });
    });
  }

  return (
    <div>
      <div className="-mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-1 tablet:mx-0 tablet:flex-wrap tablet:px-0" role="group" aria-label="Filter by category">
        <FilterChip label="All jobs" count={total} selected={active === 'all'} onClick={() => pick('all')} />
        {categories.slice(0, 6).map((c) => (
          <FilterChip key={c.slug} label={c.name} count={c.open_jobs} selected={active === c.slug} onClick={() => pick(c.slug)} />
        ))}
      </div>
      <ul
        aria-busy={pending}
        data-reveal-group
        className="live-board mt-6 divide-y divide-line-subtle overflow-hidden rounded-card border border-line bg-surface shadow-xs"
      >
        {jobs.map((j) => (
          <JobRow key={j.public_id} job={toRowData(j, now)} href={`/jobs/${j.public_id}`} />
        ))}
        {!jobs.length ? <li className="px-6 py-10 text-center text-body-sm text-fg-tertiary">No open jobs in this category right now.</li> : null}
      </ul>
      <p className="mt-4 text-body-xs text-fg-tertiary">New jobs are added throughout the day. Slots close when the employer’s budget is used.</p>
      <NextLink href="/jobs" className="sr-only">
        See all jobs <Icon name="arrow-right" size={16} />
      </NextLink>
    </div>
  );
}
