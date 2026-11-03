import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Avatar, Breadcrumbs, Button, Icon, JobCard, Link, Progress, StatusBadge } from '@24f/ui';
import { formatRelative, formatReward, type JobCard as JobCardT, type JobDetailPublic } from '@24f/shared';
import { apiGet, apiTry, ApiRequestError } from '@/lib/api/server';
import { toCardData } from '@/lib/jobs';
import { MarketingMotion } from '@/components/marketing/MarketingMotion';

type Props = { params: Promise<{ publicId: string }> };

async function load(id: string) {
  try {
    return (await apiGet<JobDetailPublic>(`/public/jobs/${encodeURIComponent(id)}`, 30)).data;
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await load((await params).publicId);
  if (!job) return { title: 'Job not found' };
  return {
    title: job.title,
    description: `${formatReward(job.reward_usd)} per approved task · about ${job.display_minutes} min · ${job.slots_left} of ${job.slots_total} slots left.`,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** SCR-PUB-03 Public job details (Figma 21:781). Task link and materials stay hidden until sign-in + start. */
export default async function JobDetailPage({ params }: Props) {
  const id = (await params).publicId.toUpperCase();
  const job = await load(id);
  if (!job) notFound();
  const similar = await apiTry<JobCardT[]>(`/public/jobs/${id}/similar?per_page=3`, 60);
  const proofParts = job.proof_label.split(' + ');
  const since = job.employer.since ? `${MONTHS[Number(job.employer.since.slice(5, 7)) - 1]} ${job.employer.since.slice(0, 4)}` : null;
  const next = encodeURIComponent(`/worker/jobs/${job.public_id}`);
  const open = job.availability === 'open';

  return (
    <MarketingMotion>
      <div className="mx-auto max-w-container px-5 pb-24 pt-8 tablet:px-8 desktop:px-0">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Browse jobs', href: '/jobs' },
            ...(job.category ? [{ label: job.category.name, href: `/jobs?category=${job.category.slug}` }] : []),
            { label: job.title.length > 28 ? `${job.title.slice(0, 26)}…` : job.title },
          ]}
        />
        <div className="mt-6 grid gap-8 desktop:grid-cols-[760px_416px] desktop:justify-between [&>*]:min-w-0">
          <div className="space-y-6">
            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-xs tablet:p-8">
              <div className="flex items-center gap-3">
                <p className="text-overline uppercase text-fg-brand">{job.category?.name}</p>
                {job.is_new ? <StatusBadge tone="brand" label="New" /> : null}
                {!open ? <StatusBadge tone="neutral" label={job.availability === 'full' ? 'All slots are taken' : job.availability === 'paused' ? 'Paused' : 'Closed'} /> : null}
              </div>
              <h1 className="mt-3 font-display text-[28px] font-bold leading-9 text-fg tablet:text-h1">{job.title}</h1>
              <p className="mt-3 text-body-sm text-fg-tertiary">
                Posted {formatRelative(job.published_at)} by {job.employer.business_name} · Job ID {job.public_id}
              </p>
              <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-[14px] border border-line-subtle bg-subtle tablet:grid-cols-4">
                {[
                  ['Reward', formatReward(job.reward_usd), 'per approved task', true],
                  ['Slots left', String(job.slots_left), `of ${job.slots_total}`, false],
                  ['Takes about', `${job.display_minutes} min`, job.display_minutes_is_average ? 'average' : 'estimate', false],
                  ['Proof', proofParts[0], proofParts.length > 1 ? `+ ${proofParts.slice(1).join(' + ').toLowerCase()}` : '', false],
                ].map(([k, v, sub, money], i) => (
                  <div key={k as string} className={`px-4 py-4 ${i % 2 ? 'border-l border-line-subtle' : ''} ${i > 1 ? 'border-t border-line-subtle tablet:border-t-0' : ''} ${i === 2 ? 'tablet:border-l' : ''}`}>
                    <dt className="text-overline uppercase text-fg-tertiary">{k}</dt>
                    <dd className={`mt-1 font-display text-num-md ${money ? 'text-fg-success' : 'text-fg'}`}>{v}</dd>
                    <dd className="text-body-xs text-fg-tertiary">{sub}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-xs tablet:p-8">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-h3 text-fg">What you’ll do</h2>
                <span className="text-body-sm text-fg-tertiary">{job.steps.length} steps</span>
              </div>
              <ol data-reveal-group className="mt-6 space-y-3">
                {job.steps.map((s) => (
                  <li data-reveal-item key={s.position} className="flex gap-4 rounded-[14px] bg-subtle p-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-subtle font-display text-num-sm text-fg-brand">{s.position}</span>
                    <div>
                      <p className="text-overline uppercase text-fg-brand">Step {s.position}</p>
                      <p className="mt-1 text-body-md text-fg">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Alert brand className="mt-5">
                The task link and photo folder appear after you sign in and start the job.
              </Alert>
            </section>

            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-xs tablet:p-8">
              <h2 className="font-display text-h3 text-fg">Proof the employer needs</h2>
              <ul className="mt-5 space-y-4">
                {job.proof_requirements.map((p) => (
                  <li key={p.position} className="flex gap-3">
                    <Icon name={p.proof_type === 'link' ? 'link' : p.proof_type === 'text' ? 'file-text' : p.proof_type === 'file' ? 'upload' : 'image'} size={20} className="mt-0.5 text-fg-brand" />
                    <div>
                      <p className="text-label-lg text-fg">{p.title}</p>
                      {p.helper ? <p className="text-body-sm text-fg-tertiary">{p.helper}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-xs tablet:p-8">
              <h2 className="font-display text-h3 text-fg">Rules for this job</h2>
              <ul className="mt-5 space-y-3">
                {job.rules.allowed.map((r) => (
                  <li key={r} className="flex gap-3 text-body-md text-fg">
                    <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-fg-success" />
                    {r}
                  </li>
                ))}
                {job.rules.not_allowed.map((r) => (
                  <li key={r} className="flex gap-3 text-body-md text-fg">
                    <Icon name="x-circle" size={20} className="mt-0.5 shrink-0 text-fg-danger" />
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-6 desktop:sticky desktop:top-[100px] desktop:h-fit">
            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-md">
              <p className="text-body-sm text-fg-secondary">Reward per approved task</p>
              <p className="mt-1 font-display text-num-2xl text-fg-success">{formatReward(job.reward_usd)}</p>
              <div className="mt-4 flex items-center justify-between text-body-sm">
                <span className="text-fg">
                  {job.slots_left} of {job.slots_total} slots left
                </span>
                <span className="text-fg-tertiary">Closes when filled</span>
              </div>
              <Progress className="mt-2" value={job.slots_filled} max={job.slots_total} valueText={`${job.slots_filled} of ${job.slots_total} slots filled`} />
              {open ? (
                <>
                  <Button href={`/signup?next=${next}`} size="L" fullWidth className="mt-6">
                    Sign up to start this job
                  </Button>
                  <p className="mt-3 text-center text-body-sm text-fg-secondary">
                    Already have an account?{' '}
                    <Link href={`/login?next=${next}`} variant="inline">
                      Log in
                    </Link>
                  </p>
                </>
              ) : (
                <Alert tone="info" className="mt-6">
                  {job.availability === 'full' ? 'All slots are taken. Check back — slots reopen if work is returned.' : 'This job isn’t taking new workers right now.'}
                </Alert>
              )}
              <dl className="mt-6 space-y-3 border-t border-line-subtle pt-5 text-body-sm">
                {[
                  ['Review window', `Within ${job.terms.review_window_hours} hours`],
                  ['If not reviewed in time', job.terms.auto_approve ? 'Auto-approved' : 'Escalated to support'],
                  ['Rejections', 'Always include a reason'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-fg-secondary">{k}</dt>
                    <dd className="text-right text-label-md text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section data-reveal className="rounded-card border border-line bg-surface p-6 shadow-xs">
              <div className="flex items-center gap-3">
                <Avatar initials={job.employer.initials} size="L" shape="square" tone="accent" name={job.employer.business_name} />
                <div>
                  <p className="text-label-lg text-fg">{job.employer.business_name}</p>
                  <p className="text-body-xs text-fg-tertiary">
                    {job.employer.employer_verified ? 'Verified employer' : 'Employer'}
                    {since ? ` · since ${since}` : ''}
                  </p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-2">
                {[
                  [job.employer.approval_rate_pct !== null ? `${job.employer.approval_rate_pct}%` : '—', 'Approval rate'],
                  [job.employer.avg_review_hours !== null ? `${job.employer.avg_review_hours} h` : '—', 'Avg. review'],
                  [String(job.employer.jobs_posted), 'Jobs posted'],
                ].map(([v, k]) => (
                  <div key={k} className="rounded-[12px] bg-subtle px-3 py-3 text-center">
                    <dd className="font-display text-num-md text-fg">{v}</dd>
                    <dt className="text-body-xs text-fg-tertiary">{k}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-body-xs text-fg-tertiary">Rejections must include a reason.</p>
            </section>
            <Link href={`/login?next=${encodeURIComponent(`/jobs/${job.public_id}`)}`} variant="standalone" className="inline-flex items-center gap-2">
              <Icon name="flag" size={16} /> Report this job
            </Link>
          </aside>
        </div>

        {similar?.data.length ? (
          <section className="mt-20">
            <div data-reveal className="flex items-end justify-between">
              <h2 className="font-display text-h3 text-fg">Similar jobs</h2>
              {job.category ? (
                <Link href={`/jobs?category=${job.category.slug}`} variant="arrow">
                  See all {job.category.name.toLowerCase()} jobs
                </Link>
              ) : null}
            </div>
            <div data-reveal-group className="mt-6 grid gap-6 tablet:grid-cols-2 desktop:grid-cols-3">
              {similar.data.map((j) => (
                <div data-reveal-item key={j.public_id}>
                  <JobCard job={toCardData(j)} href={`/jobs/${j.public_id}`} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </MarketingMotion>
  );
}
