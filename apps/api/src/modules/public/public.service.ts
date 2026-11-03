import { Injectable } from '@nestjs/common';
import { Prisma } from '@24f/db';
import {
  initials,
  maskName,
  type ContactInput,
  type JobDetailPublic,
  type PublicCategory,
  type PublicJobsQuery,
  type PublicSearchQuery,
} from '@24f/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ApiError } from '../../common/api-error';
import { proofLabel, toJobCard, type JobRowRaw } from './job-mapper';

/** A-53 filter buckets on est_minutes. */
const BUCKET_MINUTES: Record<string, number[]> = { under_5: [2, 5], '5_15': [10, 15], over_15: [30, 60] };

const SORT_SQL: Record<string, Prisma.Sql> = {
  newest: Prisma.sql`j.published_at DESC`,
  highest_reward: Prisma.sql`j.reward_usd DESC, j.published_at DESC`,
  shortest_time: Prisma.sql`j.display_minutes ASC, j.published_at DESC`,
  most_slots: Prisma.sql`j.slots_left DESC, j.published_at DESC`,
  ending_soon: Prisma.sql`j.ends_at ASC`,
};

/** Default job rules shown on public detail (A-54). */
const DEFAULT_RULES = {
  allowed: ['Do your own work — every row is checked against the photo.', 'One submission per worker. Fix and resubmit if asked.'],
  not_allowed: ['No copy-paste from other workers or automated tools.', 'Don’t share the photos or sheet outside this task.'],
};

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private liveWhere = Prisma.sql`j.status = 'running' AND j.ends_at > now() AND j.deleted_at IS NULL AND c.is_public`;

  private filterSql(q: Partial<PublicJobsQuery>, skip: 'category' | null = null) {
    const parts: Prisma.Sql[] = [this.liveWhere];
    if (q.q) parts.push(Prisma.sql`(j.title ILIKE ${'%' + q.q + '%'} OR c.name ILIKE ${'%' + q.q + '%'})`);
    if (skip !== 'category' && q.category?.length) parts.push(Prisma.sql`c.slug IN (${Prisma.join(q.category)})`);
    if (q.reward_min) parts.push(Prisma.sql`j.reward_usd >= ${q.reward_min}::numeric`);
    if (q.time?.length) {
      const mins = q.time.flatMap((t) => BUCKET_MINUTES[t] ?? []);
      if (mins.length) parts.push(Prisma.sql`j.est_minutes IN (${Prisma.join(mins)})`);
    }
    if (q.proof?.length) parts.push(Prisma.sql`j.proof_types && ${q.proof}::proof_type[]`);
    return Prisma.join(parts, ' AND ');
  }

  private selectCols = Prisma.sql`j.public_id, j.title, c.slug AS category_slug, c.name AS category_name, e.business_name,
    (e.employer_verified_at IS NOT NULL) AS employer_verified, j.reward_usd::text AS reward_usd, j.display_minutes,
    j.proof_types::text[] AS proof_types, j.slots_total, j.slots_left, j.published_at, j.ends_at`;

  private fromSql = Prisma.sql`FROM jobs j JOIN categories c ON c.id = j.category_id JOIN employer_profiles e ON e.user_id = j.employer_user_id`;

  async jobs(q: PublicJobsQuery) {
    const db = this.prisma.db;
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const where = this.filterSql(q);
    const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${this.fromSql} WHERE ${where}`;
    const facetRows = await db.$queryRaw<{ slug: string; n: number }[]>`
      SELECT c.slug, count(*)::int AS n ${this.fromSql} WHERE ${this.filterSql(q, 'category')} GROUP BY c.slug`;
    const facets = { category: Object.fromEntries(facetRows.map((r) => [r.slug, r.n])) };
    const perPage = q.per_page;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (q.count_only) return { data: [], meta: { total, page: 1, per_page: perPage, total_pages: totalPages, has_more: false, facets } };
    const page = Math.min(q.page, totalPages);
    const rows = await db.$queryRaw<JobRowRaw[]>`
      SELECT ${this.selectCols} ${this.fromSql} WHERE ${where}
      ORDER BY ${SORT_SQL[q.sort] ?? SORT_SQL.newest} LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;
    return {
      data: rows.map((r) => toJobCard(r, newMin)),
      meta: { total, page, per_page: perPage, total_pages: totalPages, has_more: page < totalPages, facets, applied_filters: q },
    };
  }

  async jobDetail(publicId: string): Promise<JobDetailPublic> {
    const db = this.prisma.db;
    const job = await db.job.findUnique({
      where: { publicId },
      include: {
        category: true,
        jobSteps: { orderBy: { position: 'asc' } },
        jobProofRequirements: { orderBy: { position: 'asc' } },
        employerUser: { include: { employerProfile: true } },
      },
    });
    if (!job || job.status === 'draft' || job.deletedAt || job.status === 'suspended') throw new ApiError('NOT_FOUND');
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const emp = job.employerUser.employerProfile;
    const slotsLeft = job.slotsLeft ?? 0;
    const slotsTotal = job.slotsTotal ?? 0;
    const ended = !job.endsAt || job.endsAt.getTime() < Date.now();
    const availability: JobDetailPublic['availability'] =
      job.status === 'paused' ? 'paused' : job.status !== 'running' || ended ? 'closed' : slotsLeft <= 0 ? 'full' : 'open';
    const rules = (job.rules as JobDetailPublic['rules'] | null) ?? DEFAULT_RULES;
    const name = emp?.businessName ?? 'Employer';
    return {
      public_id: job.publicId,
      title: job.title,
      category: job.category ? { slug: job.category.slug as never, name: job.category.name } : null,
      is_new: !!job.publishedAt && Date.now() - job.publishedAt.getTime() <= newMin * 60_000,
      availability,
      reward_usd: Number(job.rewardUsd ?? 0).toFixed(3),
      display_minutes: job.displayMinutes,
      display_minutes_is_average: job.avgCompletionSeconds !== null,
      proof_label: proofLabel(job.proofTypes as never),
      proof_types: job.proofTypes as never,
      slots_total: slotsTotal,
      slots_left: slotsLeft,
      slots_filled: slotsTotal - slotsLeft,
      published_at: job.publishedAt?.toISOString() ?? null,
      ends_at: job.endsAt?.toISOString() ?? null,
      steps: job.jobSteps.map((s) => ({ position: s.position, body: s.body })),
      proof_requirements: job.jobProofRequirements.map((p) => ({ position: p.position, proof_type: p.proofType as never, title: p.title, helper: p.helper })),
      rules,
      terms: { review_window_hours: job.reviewWindowHours, auto_approve: job.autoApprove, allow_resubmission: job.allowResubmission, rejections_need_reason: true },
      employer: {
        business_name: name,
        initials: initials(name),
        logo_url: null,
        employer_verified: !!emp?.employerVerifiedAt,
        since: emp?.employerVerifiedAt ? emp.employerVerifiedAt.toISOString().slice(0, 7) : null,
        approval_rate_pct: emp?.approvalRatePct ?? null,
        avg_review_hours: emp?.avgReviewSeconds ? Math.round(emp.avgReviewSeconds / 3600) : null,
        jobs_posted: emp?.jobsPostedCount ?? 0,
      },
    };
  }

  async similar(publicId: string, perPage: number) {
    const job = await this.prisma.db.job.findUnique({ where: { publicId }, select: { categoryId: true } });
    if (!job) throw new ApiError('NOT_FOUND');
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const rows = await this.prisma.db.$queryRaw<JobRowRaw[]>`
      SELECT ${this.selectCols} ${this.fromSql}
      WHERE ${this.liveWhere} AND j.category_id = ${job.categoryId}::uuid AND j.public_id <> ${publicId} AND j.slots_left > 0
      ORDER BY j.published_at DESC LIMIT ${perPage}`;
    return rows.map((r) => toJobCard(r, newMin));
  }

  async categories(includeOther: boolean): Promise<PublicCategory[]> {
    const rows = await this.prisma.db.$queryRaw<{ slug: string; name: string; open_jobs: number; avg: string | null }[]>`
      SELECT c.slug, c.name, count(j.id)::int AS open_jobs, round(avg(j.reward_usd), 2)::text AS avg
      FROM categories c LEFT JOIN jobs j ON j.category_id = c.id AND j.status = 'running' AND j.ends_at > now() AND j.deleted_at IS NULL
      WHERE c.is_active AND (c.is_public OR ${includeOther})
      GROUP BY c.id ORDER BY c.sort_order`;
    return rows.map((r) => ({ slug: r.slug as never, name: r.name, open_jobs: r.open_jobs, avg_reward_usd: r.avg }));
  }

  async search(q: PublicSearchQuery) {
    const offset = q.cursor ? Math.max(0, Number(Buffer.from(q.cursor, 'base64url').toString()) || 0) : 0;
    const base: Partial<PublicJobsQuery> = { q: q.q, category: q.category ? [q.category as never] : [] };
    const where = this.filterSql(base);
    const db = this.prisma.db;
    const newMin = await this.settings.number('job_new_badge_minutes', 60);
    const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${this.fromSql} WHERE ${where}`;
    const countRows = await db.$queryRaw<{ slug: string; n: number }[]>`
      SELECT c.slug, count(*)::int AS n ${this.fromSql} WHERE ${this.filterSql({ q: q.q })} GROUP BY c.slug ORDER BY n DESC`;
    const rows = await db.$queryRaw<JobRowRaw[]>`
      SELECT ${this.selectCols} ${this.fromSql} WHERE ${where} ORDER BY j.published_at DESC LIMIT ${q.per_page} OFFSET ${offset}`;
    const next = offset + rows.length < total ? Buffer.from(String(offset + rows.length)).toString('base64url') : null;
    return {
      data: rows.map((r) => toJobCard(r, newMin)),
      meta: { total, per_page: q.per_page, next_cursor: next, has_more: !!next, counts: Object.fromEntries(countRows.map((r) => [r.slug, r.n])) },
    };
  }

  async config() {
    const s = this.settings;
    const g = <T>(k: string, d: T) => s.get<T>(k, d);
    return {
      referral: { enabled: await g('referral_enabled', true), task_rate: String(await g('referral_task_rate', '0.05')), deposit_rate: String(await g('referral_deposit_rate', '0.05')) },
      features: {
        public_payout_history_enabled: await g('public_payout_history_enabled', true),
        live_chat_enabled: await g('live_chat_enabled', true),
        maintenance_mode: await g('maintenance_mode', false),
        deposits_paused: await g('deposits_paused', false),
        withdrawals_paused: await g('withdrawals_paused', false),
      },
      banner_text: await g<string | null>('banner_text', null),
      countries: [{ code: 'BD', name: 'Bangladesh' }, { code: 'IN', name: 'India' }, { code: 'PK', name: 'Pakistan' }, { code: 'NP', name: 'Nepal' }, { code: 'LK', name: 'Sri Lanka' }],
      industries: ['Retail & e-commerce', 'Technology', 'Marketing & media', 'Education', 'Finance', 'Health', 'Food & hospitality', 'Research', 'Non-profit', 'Other'],
      social: { facebook_page: 'https://facebook.com/24freelancing', facebook_group: null, youtube: null },
      company: { legal_name: await g<string | null>('company_legal_name', null), registered_address: await g<string | null>('company_registered_address', null) },
      support: { hours_text: await g<string | null>('support_hours_text', null), live_chat_provider: await g<string | null>('live_chat_provider', 'tawk') },
      job_options: {
        open_for_days: await g('open_for_days_options', [1, 3, 7, 14, 30]),
        min_approval_rate: await g('min_approval_rate_options', [0, 60, 70, 80, 90, 95]),
        review_window_hours: await g('review_window_options_hours', [24, 48, 72]),
        reward_min_usd: String(await g('reward_min_usd', '0.010')),
        reward_max_usd: String(await g('reward_max_usd', '10.000')),
        reward_step_usd: String(await g('reward_step_usd', '0.001')),
        slots_min: await s.number('slots_min', 1),
        slots_max: await s.number('slots_max', 10000),
      },
      slot_hold_minutes: await s.number('slot_hold_minutes', 60),
      platform_fee_percent: String(await g('platform_fee_percent', '0')),
      deposit: {
        methods_enabled: await g<string[]>('deposit_methods_enabled', ['mobile_wallet', 'card']),
        presets_usd: (await g<number[]>('deposit_presets_usd', [10, 25, 50, 100])).map(String),
        min_usd: String(await g('deposit_min_usd', '10.00')),
        max_usd: String(await g('deposit_max_usd', '1000.00')),
      },
      legal_versions: { terms: '2026-01-01', privacy: '2026-01-01' },
      otp: { length: await s.number('otp_length', 6), ttl_minutes: await s.number('otp_ttl_minutes', 10), resend_seconds: await s.number('otp_resend_seconds', 60) },
    };
  }

  async faqs(placement: string | null) {
    const rows = await this.prisma.db.faq.findMany({
      where: { isPublished: true, ...(placement ? { placements: { has: placement } } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((f) => ({ id: f.id, question: f.question, answer_md: f.answerMd, sort_order: f.sortOrder }));
  }

  async helpTopics() {
    const rows = await this.prisma.db.helpTopic.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { helpArticles: { where: { publishedAt: { not: null } } } } } },
    });
    return rows.map((t) => ({ slug: t.slug, title: t.title, description: t.description, contact_topic: t.contactTopic, article_count: t._count.helpArticles }));
  }

  async helpArticles(topic: string | null | undefined, q: string, popular: boolean) {
    const rows = await this.prisma.db.helpArticle.findMany({
      where: {
        publishedAt: { not: null },
        ...(topic ? { topic: { slug: topic } } : {}),
        ...(popular ? { isPopular: true } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      include: { topic: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((a) => ({ slug: a.slug, topic_slug: a.topic.slug, title: a.title, summary: a.summary, popular_label: a.popularLabel }));
  }

  async helpArticle(slug: string) {
    const a = await this.prisma.db.helpArticle.findFirst({ where: { slug, publishedAt: { not: null } }, include: { topic: true } });
    if (!a) throw new ApiError('NOT_FOUND');
    return { slug: a.slug, topic: { slug: a.topic.slug, title: a.topic.title }, title: a.title, body_md: a.bodyMd, updated_at: a.updatedAt.toISOString() };
  }

  async legal(slug: string) {
    const pages = await this.prisma.db.legalPage.findMany({ where: { slug: slug as never }, orderBy: { effectiveAt: 'desc' } });
    const cur = pages.find((p) => p.isCurrent) ?? pages[0];
    if (!cur) throw new ApiError('NOT_FOUND');
    return {
      slug,
      title: cur.title,
      version: cur.version,
      body_md: cur.bodyMd,
      effective_at: cur.effectiveAt.toISOString(),
      versions: pages.map((p) => ({ version: p.version, effective_at: p.effectiveAt.toISOString() })),
    };
  }

  async contact(input: ContactInput & { full_name: string; email: string; topic: string; message: string; account_id?: string | null }, ip: string | undefined, ua: string | undefined) {
    const msg = await this.prisma.db.contactMessage.create({
      data: {
        fullName: input.full_name,
        email: input.email,
        topic: input.topic as never,
        accountPublicId: input.account_id || null,
        message: input.message,
        consentAt: new Date(),
        ipAddress: ip ?? null,
        userAgent: ua?.slice(0, 512) ?? null,
      },
    });
    return { id: msg.id, status: 'received' };
  }

  async referralCode(code: string) {
    const u = await this.prisma.db.user.findFirst({ where: { referralCode: { equals: code, mode: 'insensitive' } }, select: { fullName: true } });
    return { code: code.toUpperCase(), valid: !!u, referrer_name_masked: u ? maskName(u.fullName) : null };
  }

  async recentPayouts(perPage: number) {
    const rows = await this.prisma.db.withdrawal.findMany({
      where: { status: 'paid' },
      orderBy: { paidAt: 'desc' },
      take: perPage,
      include: { user: { select: { fullName: true } } },
    });
    const label: Record<string, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', usdt_trc20: 'USDT TRC20' };
    return rows.map((w) => ({
      name_masked: maskName(w.user.fullName),
      method: w.method,
      method_label: label[w.method] ?? w.method,
      amount_usd: Number(w.amountUsd).toFixed(2),
      paid_at: w.paidAt?.toISOString() ?? null,
    }));
  }
}
