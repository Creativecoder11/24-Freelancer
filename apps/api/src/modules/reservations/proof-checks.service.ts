import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Prisma } from '@24f/db';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';

interface CheckItem {
  key: string;
  pass: boolean | null;
  text: string;
}

const SIGN_IN_HOSTS = ['accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'www.dropbox.com/login', 'auth.'];

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? privateAddress(mapped[1]!) : false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * Proof auto-check (Doc 04 §6.7, A-25): link opens without sign-in, screenshot present, image
 * not reused (SHA-256 / pHash, A-26). Results inform the employer and never decide.
 */
@Injectable()
export class ProofChecksService {
  private readonly log = new Logger('ProofChecks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** SSRF-guarded link check: https only, public addresses only, ≤ 3 redirects, 5 s. Returns the HTTP status or null. */
  async checkLink(url: string): Promise<{ status: number | null; signIn: boolean }> {
    let current = url;
    const deadline = Date.now() + 5000;
    for (let hop = 0; hop <= 3; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return { status: null, signIn: false };
      }
      if (u.protocol !== 'https:') return { status: null, signIn: false };
      if (SIGN_IN_HOSTS.some((h) => `${u.hostname}${u.pathname}`.startsWith(h) || u.hostname.startsWith(h))) return { status: 401, signIn: true };
      const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
      if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return { status: null, signIn: false };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(500, deadline - Date.now()));
      try {
        const res = await fetch(u, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': '24FreelancingProofCheck/1.0' } });
        await res.body?.cancel().catch(() => undefined);
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          current = new URL(res.headers.get('location')!, u).toString();
          continue;
        }
        return { status: res.status, signIn: res.status === 401 || res.status === 403 };
      } catch {
        return { status: null, signIn: false };
      } finally {
        clearTimeout(timer);
      }
    }
    return { status: null, signIn: false };
  }

  async run(submissionId: string, attemptId: string) {
    const db = this.prisma.db;
    const sub = await db.submission.findUnique({ where: { id: submissionId }, select: { id: true, jobId: true, workerUserId: true } });
    if (!sub) return;
    const items = await db.submissionProofItem.findMany({ where: { attemptId }, include: { upload: true, proofRequirement: true } });
    const out: CheckItem[] = [];
    let duplicate = false;
    const distance = await this.settings.number('phash_duplicate_distance', 6);
    for (const it of items) {
      if (it.proofType === 'link' && it.linkUrl) {
        const r = await this.checkLink(it.linkUrl);
        await db.submissionProofItem.update({ where: { id: it.id }, data: { linkCheckStatus: r.status } });
        out.push(
          r.status === 200
            ? { key: `link:${it.proofRequirementId}`, pass: true, text: 'Link opens' }
            : r.signIn
              ? { key: `link:${it.proofRequirementId}`, pass: false, text: 'Link didn’t open without sign-in' }
              : { key: `link:${it.proofRequirementId}`, pass: null, text: 'Link could not be checked' },
        );
      }
      if ((it.proofType === 'screenshot' || it.proofType === 'file') && it.upload) {
        out.push({ key: `upload:${it.proofRequirementId}`, pass: it.upload.status === 'uploaded', text: it.proofType === 'screenshot' ? 'screenshot present' : 'file present' });
        if (it.upload.phash !== null || it.upload.sha256) {
          const hit = await db.$queryRaw<{ one: number }[]>`
            SELECT 1 AS one
            FROM submission_proof_items p
            JOIN submission_attempts a ON a.id = p.attempt_id
            JOIN submissions s ON s.id = a.submission_id
            JOIN uploads u ON u.id = p.upload_id
            WHERE s.job_id = ${sub.jobId}::uuid AND s.worker_user_id <> ${sub.workerUserId}::uuid
              AND (u.sha256 = ${it.upload.sha256}
                   OR (u.phash IS NOT NULL AND ${it.upload.phash}::bigint IS NOT NULL
                       AND bit_count((u.phash # ${it.upload.phash}::bigint)::bit(64)) <= ${distance}))
            LIMIT 1`;
          if (hit.length) duplicate = true;
        }
      }
    }
    if (items.some((i) => i.proofType === 'screenshot')) out.push({ key: 'reuse', pass: !duplicate, text: duplicate ? 'This image looks like another worker’s upload' : 'image not reused' });
    const state = out.some((i) => i.pass !== true) ? 'warn' : 'pass';
    const autoCheck = { state, items: out, checked_at: new Date().toISOString() } as unknown as Prisma.InputJsonValue;
    await db.submissionAttempt.update({ where: { id: attemptId }, data: { autoCheck } });
    await db.submission.update({ where: { id: submissionId }, data: { autoCheck, duplicateSuspected: duplicate } });
    this.log.debug(`auto-check ${submissionId}: ${state}`);
  }
}
