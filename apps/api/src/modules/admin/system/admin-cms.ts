import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@24f/db';
import { PrismaService } from '../../../common/prisma.service';
import { RedisService } from '../../../common/redis.service';
import { ApiError } from '../../../common/api-error';
import { getEnv } from '../../../config/env';
import { AdminGuard, AdminAuditInterceptor } from '../core/admin.guard';
import { Admin, Perms, type AdminCtx } from '../core/admin-context';
import { AuditService } from '../core/audit.service';
import { adminEnv } from '../core/admin-env';
import { bool, iso, isUnique, needEnum, needReason, needText, optText, paged, paging, type Q } from '../core/helpers';

const CONTACT_STATUS = ['new', 'in_progress', 'answered', 'closed', 'spam'] as const;
const LEGAL = ['terms', 'privacy', 'refund', 'cancellation'] as const;
const PLACEMENTS = ['home', 'help'] as const;

/** Support inbox, content CMS and broadcast (Doc 06 §6.14–6.16; Doc 09 SCR-ADM-15/16/17, §16). */
@Injectable()
export class AdminCmsService {
  private readonly log = new Logger('AdminCms');
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** On-demand revalidation of apps/web (best effort). */
  private async revalidate(paths: string[]) {
    try {
      await fetch(`${getEnv().WEB_APP_URL}/api/revalidate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-revalidate-secret': process.env.REVALIDATE_SECRET ?? '' }, body: JSON.stringify({ paths }), signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ support

  private financeOnly(ctx: AdminCtx) {
    return !ctx.isSuper && ctx.roles.includes('finance_admin') && !ctx.roles.some((r) => ['ops_admin', 'moderator', 'support_agent'].includes(r));
  }

  async messages(ctx: AdminCtx, q: Q) {
    const p = paging(q);
    const where: Prisma.ContactMessageWhereInput = {};
    if (this.financeOnly(ctx)) where.topic = 'payments_withdrawals';
    else if (q.topic) where.topic = q.topic as 'referral';
    if (q.status) where.status = q.status as 'new';
    if (q.assigned === 'me') where.assignedAdminId = ctx.id;
    const term = (q.q ?? '').trim();
    if (term) where.OR = [{ email: { contains: term, mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }, { accountPublicId: term }, { message: { contains: term, mode: 'insensitive' } }];
    const base = this.financeOnly(ctx) ? { topic: 'payments_withdrawals' as const } : {};
    const [rows, total, counts] = await Promise.all([
      this.db.contactMessage.findMany({ where, orderBy: { createdAt: 'asc' }, skip: p.skip, take: p.take, include: { assignedAdmin: { select: { fullName: true } } } }),
      this.db.contactMessage.count({ where }),
      this.db.contactMessage.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const ids = rows.map((r) => r.accountPublicId).filter((x): x is string => !!x);
    const users = ids.length ? await this.db.user.findMany({ where: { publicId: { in: ids } }, select: { publicId: true } }) : [];
    const matched = new Set(users.map((u) => u.publicId));
    return paged(
      rows.map((m) => ({ id: m.id, full_name: m.fullName, email: m.email, topic: m.topic, account_public_id: m.accountPublicId, account_matched: !!m.accountPublicId && matched.has(m.accountPublicId), message: m.message, status: m.status, assigned_admin: m.assignedAdmin?.fullName ?? null, assigned_to_me: m.assignedAdminId === ctx.id, created_at: iso(m.createdAt) })),
      total,
      p,
      { counts: Object.fromEntries(CONTACT_STATUS.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) },
    );
  }

  private async message(ctx: AdminCtx, id: string) {
    const m = await this.db.contactMessage.findUnique({ where: { id }, include: { assignedAdmin: { select: { fullName: true } }, replies: { orderBy: { createdAt: 'asc' }, include: { adminUser: { select: { fullName: true } } } } } });
    if (!m) throw new ApiError('NOT_FOUND');
    if (this.financeOnly(ctx) && m.topic !== 'payments_withdrawals') throw new ApiError('ADMIN_FORBIDDEN');
    return m;
  }

  async messageDetail(ctx: AdminCtx, id: string) {
    const m = await this.message(ctx, id);
    const u = m.accountPublicId ? await this.db.user.findUnique({ where: { publicId: m.accountPublicId }, select: { publicId: true, status: true, kycStatus: true } }) : null;
    return {
      id: m.id,
      full_name: m.fullName,
      email: m.email,
      topic: m.topic,
      account_public_id: m.accountPublicId,
      message: m.message,
      status: m.status,
      consent_at: iso(m.consentAt),
      created_at: iso(m.createdAt),
      answered_at: iso(m.answeredAt),
      assigned_admin_id: m.assignedAdminId,
      assigned_admin: m.assignedAdmin?.fullName ?? null,
      replies: m.replies.map((r) => ({ admin: r.adminUser.fullName, body: r.body, sent_at: iso(r.emailSentAt ?? r.createdAt) })),
      linked_user: u ? { public_id: u.publicId, status: u.status, kyc_status: u.kycStatus } : null,
    };
  }

  async reply(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const body = needText(b.body, 5000, 'body', 'Write a reply.');
    const close = b.close !== false;
    const m = await this.message(ctx, id);
    const now = new Date();
    const status = close ? 'answered' : m.status === 'new' ? 'in_progress' : m.status;
    await this.db.$transaction(async (tx) => {
      await tx.supportReply.create({ data: { contactMessageId: id, adminUserId: ctx.id, body, emailSentAt: now } });
      await tx.contactMessage.update({ where: { id }, data: { status, answeredAt: close ? now : m.answeredAt, assignedAdminId: m.assignedAdminId ?? ctx.id } });
      await this.audit.record(ctx, { action: 'contact.reply', entityType: 'contact_message', entityId: id, after: { status, length: body.length } }, tx);
    });
    // Email delivery uses the log driver in local dev (EMAIL_PROVIDER=log).
    this.log.log(`[email] to=${m.email} subject="Re: your message to 24 Freelancing" chars=${body.length}`);
    return { id, status, answered_at: close ? now.toISOString() : iso(m.answeredAt) };
  }

  async patchMessage(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const m = await this.message(ctx, id);
    const data: Prisma.ContactMessageUpdateInput = {};
    if (b.status !== undefined) data.status = needEnum(b.status, CONTACT_STATUS, 'status');
    if (b.assigned_admin_id !== undefined) data.assignedAdmin = b.assigned_admin_id ? { connect: { id: String(b.assigned_admin_id) } } : { disconnect: true };
    const upd = await this.db.$transaction(async (tx) => {
      const u = await tx.contactMessage.update({ where: { id }, data });
      await this.audit.record(ctx, { action: 'contact.update', entityType: 'contact_message', entityId: id, before: { status: m.status, assignee: m.assignedAdminId }, after: { status: u.status, assignee: u.assignedAdminId } }, tx);
      return u;
    });
    return { id, status: upd.status, assigned_admin_id: upd.assignedAdminId };
  }

  // ------------------------------------------------------------------ FAQs

  async faqs(q: Q) {
    const where: Prisma.FaqWhereInput = {};
    if (q.placement) where.placements = { has: q.placement };
    if (q.published !== undefined) where.isPublished = bool(q.published);
    const rows = await this.db.faq.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return paged(rows.map((f) => ({ id: f.id, question: f.question, answer_md: f.answerMd.trim() ? f.answerMd : null, placements: f.placements, sort_order: f.sortOrder, is_published: f.isPublished, updated_at: iso(f.updatedAt) })), rows.length, { page: 1, perPage: Math.max(rows.length, 1) });
  }

  private faqInput(b: Record<string, unknown>, partial: boolean) {
    const d: Prisma.FaqUncheckedUpdateInput = {};
    if (!partial || b.question !== undefined) d.question = needText(b.question, 200, 'question', 'Enter the question.');
    if (!partial || b.answer_md !== undefined) d.answerMd = typeof b.answer_md === 'string' ? b.answer_md : '';
    if (!partial || b.placements !== undefined) {
      const pl = Array.isArray(b.placements) ? (b.placements as string[]).filter((x) => (PLACEMENTS as readonly string[]).includes(x)) : [];
      if (!pl.length) throw new ApiError('VALIDATION_FAILED', undefined, { placements: ['Choose at least one placement.'] });
      d.placements = pl;
    }
    if (b.sort_order !== undefined) d.sortOrder = Math.max(0, Math.min(999, Math.floor(Number(b.sort_order) || 0)));
    if (b.is_published !== undefined) d.isPublished = b.is_published === true;
    return d;
  }

  async createFaq(ctx: AdminCtx, b: Record<string, unknown>) {
    const d = this.faqInput(b, false);
    if (d.isPublished && !String(d.answerMd ?? '').trim()) throw new ApiError('INVALID_STATE', 'An FAQ can’t be published without an answer.');
    const max = await this.db.faq.aggregate({ _max: { sortOrder: true } });
    const f = await this.db.$transaction(async (tx) => {
      const f = await tx.faq.create({ data: { ...(d as Prisma.FaqUncheckedCreateInput), sortOrder: (d.sortOrder as number | undefined) ?? (max._max.sortOrder ?? 0) + 1, updatedByAdminId: ctx.id } });
      await this.audit.record(ctx, { action: f.isPublished ? 'content.publish' : 'content.save', entityType: 'faq', entityId: f.id, after: { question: f.question, is_published: f.isPublished } }, tx);
      return f;
    });
    const rv = await this.revalidate(['/', '/help']);
    return { id: f.id, question: f.question, is_published: f.isPublished, revalidated: rv };
  }

  async updateFaq(ctx: AdminCtx, id: string, b: Record<string, unknown>) {
    const cur = await this.db.faq.findUnique({ where: { id } });
    if (!cur) throw new ApiError('NOT_FOUND');
    const d = this.faqInput(b, true);
    const answer = d.answerMd !== undefined ? String(d.answerMd) : cur.answerMd;
    const pub = d.isPublished !== undefined ? d.isPublished : cur.isPublished;
    if (pub && !answer.trim()) throw new ApiError('INVALID_STATE', 'An FAQ can’t be published without an answer.');
    const f = await this.db.$transaction(async (tx) => {
      const f = await tx.faq.update({ where: { id }, data: { ...d, updatedByAdminId: ctx.id } });
      await this.audit.record(ctx, { action: !cur.isPublished && f.isPublished ? 'content.publish' : 'content.save', entityType: 'faq', entityId: id, before: { question: cur.question, is_published: cur.isPublished, sort_order: cur.sortOrder }, after: { question: f.question, is_published: f.isPublished, sort_order: f.sortOrder } }, tx);
      return f;
    });
    const rv = await this.revalidate(['/', '/help']);
    return { id, is_published: f.isPublished, revalidated: rv };
  }

  async deleteFaq(ctx: AdminCtx, id: string) {
    const cur = await this.db.faq.findUnique({ where: { id } });
    if (!cur) throw new ApiError('NOT_FOUND');
    await this.db.$transaction(async (tx) => {
      await tx.faq.delete({ where: { id } });
      await this.audit.record(ctx, { action: 'content.delete', entityType: 'faq', entityId: id, before: { question: cur.question } }, tx);
    });
    await this.revalidate(['/', '/help']);
    return { deleted: true };
  }

  // ------------------------------------------------------------------ help

  async topics() {
    const rows = await this.db.helpTopic.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { helpArticles: true } } } });
    return paged(rows.map((t) => ({ id: t.id, slug: t.slug, title: t.title, description: t.description, contact_topic: t.contactTopic, sort_order: t.sortOrder, is_published: t.isPublished, article_count: t._count.helpArticles })), rows.length, { page: 1, perPage: Math.max(rows.length, 1) });
  }

  private topicInput(b: Record<string, unknown>, partial: boolean) {
    const d: Prisma.HelpTopicUncheckedUpdateInput = {};
    if (!partial || b.slug !== undefined) {
      const s = needText(b.slug, 60, 'slug', 'Enter a slug.');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new ApiError('VALIDATION_FAILED', undefined, { slug: ['Use lowercase letters, digits and hyphens.'] });
      d.slug = s;
    }
    if (!partial || b.title !== undefined) d.title = needText(b.title, 60, 'title', 'Enter a title.');
    if (!partial || b.description !== undefined) d.description = needText(b.description, 160, 'description', 'Enter a description.');
    if (b.contact_topic !== undefined) d.contactTopic = (b.contact_topic || null) as 'referral' | null;
    if (b.sort_order !== undefined) d.sortOrder = Math.floor(Number(b.sort_order) || 0);
    if (b.is_published !== undefined) d.isPublished = b.is_published === true;
    return d;
  }

  async saveTopic(ctx: AdminCtx, id: string | null, b: Record<string, unknown>) {
    const d = this.topicInput(b, !!id);
    try {
      const t = await this.db.$transaction(async (tx) => {
        const t = id ? await tx.helpTopic.update({ where: { id }, data: d }) : await tx.helpTopic.create({ data: d as Prisma.HelpTopicUncheckedCreateInput });
        await this.audit.record(ctx, { action: 'content.save', entityType: 'help_topic', entityId: t.id, after: { slug: t.slug, title: t.title, is_published: t.isPublished } }, tx);
        return t;
      });
      await this.revalidate(['/help']);
      return { id: t.id, slug: t.slug, is_published: t.isPublished };
    } catch (e) {
      if (isUnique(e)) throw new ApiError('INVALID_STATE', 'That slug is already used.', { slug: ['That slug is already used.'] });
      throw e;
    }
  }

  async articles(q: Q) {
    const p = paging(q, 50);
    const where: Prisma.HelpArticleWhereInput = {};
    if (q.topic) where.topicId = q.topic;
    if (q.published !== undefined) where.publishedAt = bool(q.published) ? { not: null } : null;
    if (q.q) where.title = { contains: q.q, mode: 'insensitive' };
    const [rows, total] = await Promise.all([this.db.helpArticle.findMany({ where, orderBy: [{ topicId: 'asc' }, { sortOrder: 'asc' }], skip: p.skip, take: p.take, include: { topic: { select: { slug: true, title: true } } } }), this.db.helpArticle.count({ where })]);
    return paged(rows.map((a) => ({ id: a.id, topic_id: a.topicId, topic_slug: a.topic.slug, topic_title: a.topic.title, slug: a.slug, title: a.title, summary: a.summary, body_md: a.bodyMd, is_popular: a.isPopular, popular_label: a.popularLabel, published_at: iso(a.publishedAt), updated_at: iso(a.updatedAt) })), total, p);
  }

  async saveArticle(ctx: AdminCtx, id: string | null, b: Record<string, unknown>) {
    const d: Prisma.HelpArticleUncheckedUpdateInput = {};
    const partial = !!id;
    if (!partial || b.topic_id !== undefined) d.topicId = needText(b.topic_id, 40, 'topic_id', 'Choose a topic.');
    if (!partial || b.title !== undefined) d.title = needText(b.title, 160, 'title', 'Enter a title.');
    if (!partial || b.slug !== undefined) {
      const s = needText(b.slug, 120, 'slug', 'Enter a slug.');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new ApiError('VALIDATION_FAILED', undefined, { slug: ['Use lowercase letters, digits and hyphens.'] });
      d.slug = s;
    }
    if (b.summary !== undefined) d.summary = optText(b.summary, 300, 'summary');
    if (!partial || b.body_md !== undefined) d.bodyMd = needText(b.body_md, 50000, 'body_md', 'Write the article.');
    if (b.is_popular !== undefined) d.isPopular = b.is_popular === true;
    if (b.popular_label !== undefined) d.popularLabel = optText(b.popular_label, 40, 'popular_label');
    if (b.publish !== undefined) d.publishedAt = b.publish === true ? new Date() : null;
    try {
      const a = await this.db.$transaction(async (tx) => {
        const a = id ? await tx.helpArticle.update({ where: { id }, data: { ...d, updatedByAdminId: ctx.id } }) : await tx.helpArticle.create({ data: { ...(d as Prisma.HelpArticleUncheckedCreateInput), updatedByAdminId: ctx.id } });
        await this.audit.record(ctx, { action: b.publish === true ? 'content.publish' : 'content.save', entityType: 'help_article', entityId: a.id, after: { slug: a.slug, title: a.title, published: !!a.publishedAt } }, tx);
        return a;
      });
      const rv = await this.revalidate(['/help']);
      return { id: a.id, slug: a.slug, published_at: iso(a.publishedAt), revalidated: rv };
    } catch (e) {
      if (isUnique(e)) throw new ApiError('INVALID_STATE', 'That slug is already used in this topic.', { slug: ['That slug is already used in this topic.'] });
      throw e;
    }
  }

  async deleteArticle(ctx: AdminCtx, id: string) {
    const a = await this.db.helpArticle.findUnique({ where: { id } });
    if (!a) throw new ApiError('NOT_FOUND');
    await this.db.$transaction(async (tx) => {
      await tx.helpArticle.delete({ where: { id } });
      await this.audit.record(ctx, { action: 'content.delete', entityType: 'help_article', entityId: id, before: { slug: a.slug, title: a.title } }, tx);
    });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ legal

  async legal(slug: string) {
    const s = needEnum(slug, LEGAL, 'slug');
    const rows = await this.db.legalPage.findMany({ where: { slug: s }, orderBy: { createdAt: 'desc' }, include: { publishedByAdmin: { select: { fullName: true } } } });
    return { slug: s, versions: rows.map((v) => ({ id: v.id, version: v.version, title: v.title, body_md: v.bodyMd, effective_at: iso(v.effectiveAt), is_current: v.isCurrent, published_by: v.publishedByAdmin?.fullName ?? null, created_at: iso(v.createdAt) })) };
  }

  async publishLegal(ctx: AdminCtx, slug: string, b: Record<string, unknown>) {
    const s = needEnum(slug, LEGAL, 'slug');
    const version = needText(b.version, 20, 'version', 'Enter a version, like 1.1.');
    const title = needText(b.title, 80, 'title', 'Enter a title.');
    const body = needText(b.body_md, 200000, 'body_md', 'Paste the client-supplied text.');
    const eff = new Date(String(b.effective_at ?? ''));
    if (Number.isNaN(eff.getTime())) throw new ApiError('VALIDATION_FAILED', undefined, { effective_at: ['Choose the effective date.'] });
    const reaccept = (s === 'terms' || s === 'privacy') && b.require_reaccept === true;
    try {
      const v = await this.db.$transaction(async (tx) => {
        await tx.legalPage.updateMany({ where: { slug: s, isCurrent: true }, data: { isCurrent: false } });
        const v = await tx.legalPage.create({ data: { slug: s, version, title, bodyMd: body, effectiveAt: eff, isCurrent: true, publishedByAdminId: ctx.id } });
        await this.audit.record(ctx, { action: 'legal.publish', entityType: 'legal_page', entityId: v.id, entityRef: `${s}:${version}`, after: { slug: s, version, require_reaccept: reaccept } }, tx);
        return v;
      });
      if (reaccept) await this.redis.client.set(`legal:reaccept:${s}`, version).catch(() => undefined);
      await this.revalidate([`/legal/${s}`]);
      return { id: v.id, version, is_current: true };
    } catch (e) {
      if (isUnique(e)) throw new ApiError('INVALID_STATE', 'That version already exists for this page.', { version: ['That version already exists for this page.'] });
      throw e;
    }
  }

  // ------------------------------------------------------------------ broadcast

  private segmentWhere(seg: Record<string, unknown>): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { anonymisedAt: null, status: seg.status === 'active_restricted' ? { in: ['active', 'restricted'] } : 'active' };
    if (seg.audience === 'workers') where.signupRole = 'worker';
    if (seg.audience === 'employers') where.employerProfile = { isNot: null };
    if (seg.kyc_status && seg.kyc_status !== 'any') where.kycStatus = seg.kyc_status as 'verified';
    if (seg.country_code) where.countryCode = String(seg.country_code).toUpperCase().slice(0, 2);
    const days = Number(seg.active_days);
    if (days > 0) where.lastLoginAt = { gte: new Date(Date.now() - days * 86_400_000) };
    return where;
  }

  private broadcastInput(b: Record<string, unknown>) {
    const seg = (b.segment ?? {}) as Record<string, unknown>;
    needEnum(seg.audience, ['all', 'workers', 'employers'] as const, 'segment.audience');
    const title = needText(b.title, 120, 'title', 'Enter a title.');
    const body = needText(b.body, 300, 'body', 'Enter a message.');
    const link = optText(b.link_path, 300, 'link_path');
    if (link && (!link.startsWith('/') || link.startsWith('//'))) throw new ApiError('VALIDATION_FAILED', undefined, { link_path: ['Use a same-site path that starts with /.'] });
    return { seg, title, body, link };
  }

  private token(payload: string) {
    return createHmac('sha256', Buffer.from(String(process.env.ADMIN_JWT_ACCESS_SECRET ?? getEnv().JWT_ACCESS_SECRET))).update(payload).digest('base64url');
  }

  async preview(b: Record<string, unknown>) {
    const i = this.broadcastInput(b);
    const count = await this.db.user.count({ where: this.segmentWhere(i.seg) });
    const nonce = randomBytes(8).toString('hex');
    const exp = Date.now() + 15 * 60_000;
    const payload = JSON.stringify([i.seg, i.title, i.body, i.link, exp, nonce]);
    return { recipient_count: count, confirm_token: `brc_${exp}_${nonce}_${this.token(payload)}`, sample: { title: i.title, body: i.body, link_path: i.link } };
  }

  async send(ctx: AdminCtx, b: Record<string, unknown>) {
    const i = this.broadcastInput(b);
    const reason = needReason(b.reason);
    const tok = String(b.confirm_token ?? '');
    const m = /^brc_(\d+)_([0-9a-f]{16})_(.+)$/.exec(tok);
    if (!m || Number(m[1]) < Date.now() || this.token(JSON.stringify([i.seg, i.title, i.body, i.link, Number(m[1]), m[2]])) !== m[3]) throw new ApiError('INVALID_STATE', 'The preview expired. Preview again.');
    const users = await this.db.user.findMany({ where: this.segmentWhere(i.seg), select: { id: true, activeMode: true } });
    if (!users.length) throw new ApiError('INVALID_STATE', 'No users match this group. Change the filters.');
    const env = adminEnv();
    if ((users.length >= 1000 || b.send_email === true) && (env.totpRequired || ctx.totpEnrolled) && (!ctx.reauthAt || ctx.reauthAt.getTime() + env.reauthWindowMinutes * 60_000 < Date.now())) throw new ApiError('ADMIN_REAUTH_REQUIRED');
    const broadcastId = (await this.db.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7() AS id`)[0]!.id;
    const exp = new Date(Date.now() + 90 * 86_400_000);
    for (let k = 0; k < users.length; k += 500) {
      await this.db.notification.createMany({ data: users.slice(k, k + 500).map((u) => ({ userId: u.id, audience: u.activeMode, category: 'system' as const, type: 'broadcast', title: i.title, body: i.body, linkPath: i.link, data: { broadcast_id: broadcastId }, dedupeKey: `broadcast:${broadcastId}`, expiresAt: exp })) });
    }
    await this.audit.record(ctx, { action: 'notification.broadcast', entityType: 'broadcast', entityId: broadcastId, reason, after: { segment: i.seg, count: users.length, title: i.title, body: i.body, link_path: i.link, send_email: b.send_email === true } });
    return { broadcast_id: broadcastId, recipient_count: users.length, status: 'sent' };
  }

  async history(q: Q) {
    const p = paging(q);
    const where: Prisma.AuditLogWhereInput = { action: 'notification.broadcast' };
    const [rows, total] = await Promise.all([this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actorAdmin: { select: { fullName: true } } } }), this.db.auditLog.count({ where })]);
    return paged(rows.map((r) => { const a = (r.afterData ?? {}) as Record<string, unknown>; return { broadcast_id: r.entityId, title: a.title, body: a.body, recipient_count: a.count, segment: a.segment, sent_by: r.actorAdmin?.fullName ?? null, created_at: iso(r.createdAt), status: 'sent' }; }), total, p);
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminCmsController {
  constructor(private readonly svc: AdminCmsService) {}

  @Get('support/messages')
  @Perms('support.reply')
  messages(@Admin() ctx: AdminCtx, @Query() q: Q) {
    return this.svc.messages(ctx, q);
  }

  @Get('support/messages/:id')
  @Perms('support.reply')
  message(@Admin() ctx: AdminCtx, @Param('id') id: string) {
    return this.svc.messageDetail(ctx, id);
  }

  @Post('support/messages/:id/reply')
  @Perms('support.reply')
  reply(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.reply(ctx, id, b ?? {});
  }

  @Patch('support/messages/:id')
  @Perms('support.reply')
  patch(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.patchMessage(ctx, id, b ?? {});
  }

  @Get('content/faqs')
  @Perms('content.write')
  faqs(@Query() q: Q) {
    return this.svc.faqs(q);
  }

  @Post('content/faqs')
  @Perms('content.write')
  createFaq(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.createFaq(ctx, b ?? {});
  }

  @Patch('content/faqs/:id')
  @Perms('content.write')
  updateFaq(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.updateFaq(ctx, id, b ?? {});
  }

  @Delete('content/faqs/:id')
  @Perms('content.write')
  deleteFaq(@Admin() ctx: AdminCtx, @Param('id') id: string) {
    return this.svc.deleteFaq(ctx, id);
  }

  @Get('content/help/topics')
  @Perms('content.write')
  topics() {
    return this.svc.topics();
  }

  @Post('content/help/topics')
  @Perms('content.write')
  createTopic(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.saveTopic(ctx, null, b ?? {});
  }

  @Patch('content/help/topics/:id')
  @Perms('content.write')
  updateTopic(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.saveTopic(ctx, id, b ?? {});
  }

  @Get('content/help/articles')
  @Perms('content.write')
  articles(@Query() q: Q) {
    return this.svc.articles(q);
  }

  @Post('content/help/articles')
  @Perms('content.write')
  createArticle(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.saveArticle(ctx, null, b ?? {});
  }

  @Patch('content/help/articles/:id')
  @Perms('content.write')
  updateArticle(@Admin() ctx: AdminCtx, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.svc.saveArticle(ctx, id, b ?? {});
  }

  @Delete('content/help/articles/:id')
  @Perms('content.write')
  deleteArticle(@Admin() ctx: AdminCtx, @Param('id') id: string) {
    return this.svc.deleteArticle(ctx, id);
  }

  @Get('content/legal/:slug')
  @Perms('content.write')
  legal(@Param('slug') slug: string) {
    return this.svc.legal(slug);
  }

  @Post('content/legal/:slug')
  @Perms('content.write')
  publishLegal(@Admin() ctx: AdminCtx, @Param('slug') slug: string, @Body() b: Record<string, unknown>) {
    return this.svc.publishLegal(ctx, slug, b ?? {});
  }

  @Post('notifications/broadcast/preview')
  @HttpCode(200)
  @Perms('broadcast.send')
  preview(@Body() b: Record<string, unknown>) {
    return this.svc.preview(b ?? {});
  }

  @Post('notifications/broadcast')
  @HttpCode(202)
  @Perms('broadcast.send')
  send(@Admin() ctx: AdminCtx, @Body() b: Record<string, unknown>) {
    return this.svc.send(ctx, b ?? {});
  }

  @Get('notifications/broadcast')
  @Perms('broadcast.send')
  history(@Query() q: Q) {
    return this.svc.history(q);
  }
}
