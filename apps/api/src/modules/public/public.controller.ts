import { Body, Controller, Get, Ip, Headers, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  contactSchema,
  faqsQuerySchema,
  helpArticlesQuerySchema,
  publicCategoriesQuerySchema,
  publicJobsQuerySchema,
  publicSearchQuerySchema,
  recentPayoutsQuerySchema,
  similarJobsQuerySchema,
} from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { PublicService } from './public.service';

/** Guest endpoints (Doc 06 §5.5, Canonical §11 "Public"). */
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('config')
  config() {
    return this.svc.config();
  }

  @Get('categories')
  categories(@Query(new ZodPipe(publicCategoriesQuerySchema)) q: { include_other: boolean }) {
    return this.svc.categories(q.include_other);
  }

  @Get('jobs')
  async jobs(@Query(new ZodPipe(publicJobsQuerySchema)) q: never) {
    const r = await this.svc.jobs(q);
    return new Paged(r.data, r.meta);
  }

  @Get('jobs/:publicId')
  job(@Param('publicId') id: string) {
    return this.svc.jobDetail(id.toUpperCase());
  }

  @Get('jobs/:publicId/similar')
  similar(@Param('publicId') id: string, @Query(new ZodPipe(similarJobsQuerySchema)) q: { per_page: number }) {
    return this.svc.similar(id.toUpperCase(), q.per_page);
  }

  @Get('search')
  async search(@Query(new ZodPipe(publicSearchQuerySchema)) q: never) {
    const r = await this.svc.search(q);
    return new Paged(r.data, r.meta);
  }

  @Get('help/topics')
  topics() {
    return this.svc.helpTopics();
  }

  @Get('help/articles')
  articles(@Query(new ZodPipe(helpArticlesQuerySchema)) q: { topic?: string | null; q: string; popular: boolean }) {
    return this.svc.helpArticles(q.topic, q.q, q.popular);
  }

  @Get('help/articles/:slug')
  article(@Param('slug') slug: string) {
    return this.svc.helpArticle(slug);
  }

  @Get('faqs')
  faqs(@Query(new ZodPipe(faqsQuerySchema)) q: { placement: string | null }) {
    return this.svc.faqs(q.placement);
  }

  @Get('legal/:slug')
  legal(@Param('slug') slug: string) {
    return this.svc.legal(slug);
  }

  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('contact')
  contact(@Body(new ZodPipe(contactSchema)) body: never, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.svc.contact(body, ip, ua);
  }

  @Get('referral-codes/:code')
  referral(@Param('code') code: string) {
    return this.svc.referralCode(code);
  }

  @Get('payouts/recent')
  payouts(@Query(new ZodPipe(recentPayoutsQuerySchema)) q: { per_page: number }) {
    return this.svc.recentPayouts(q.per_page);
  }
}
