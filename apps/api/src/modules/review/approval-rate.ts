import { Prisma } from '@24f/db';

type Db = Prisma.TransactionClient;

/** `approval_rate_window_days` / `approval_rate_min_decisions` (A-20), read from platform_settings. */
async function rateSettings(db: Db) {
  const rows = await db.platformSetting.findMany({ where: { key: { in: ['approval_rate_window_days', 'approval_rate_min_decisions'] } }, select: { key: true, value: true } });
  const num = (k: string, d: number) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
  };
  return { windowDays: num('approval_rate_window_days', 30), minDecisions: num('approval_rate_min_decisions', 5) };
}

/**
 * Recomputes approval rates from final decisions inside the window (A-20): approved ÷ (approved +
 * rejected), whole percent, NULL ("—") below the minimum number of decisions. `needs_fix` is not a
 * final decision and doesn't count.
 * - Worker: decisions on their submissions → worker_profiles.approved_30d / rejected_30d / approval_rate_pct.
 * - Employer: decisions on their jobs → employer_profiles.approval_rate_pct.
 * Pass a user id to refresh one profile (after a decision, same transaction), or `null` to refresh
 * every profile that has or had decisions in the window (daily roll-off).
 */
export async function refreshApprovalRates(db: Db, who: { workerUserId?: string | null; employerUserId?: string | null }) {
  const { windowDays, minDecisions } = await rateSettings(db);
  const since = new Date(Date.now() - windowDays * 86_400_000);
  if (who.workerUserId !== undefined) {
    const one = who.workerUserId;
    await db.$executeRaw`
      WITH s AS (
        SELECT worker_user_id AS uid,
               count(*) FILTER (WHERE status = 'approved')::int AS a,
               count(*) FILTER (WHERE status = 'rejected')::int AS r
          FROM submissions
         WHERE status IN ('approved', 'rejected') AND decided_at >= ${since}
           AND (${one}::uuid IS NULL OR worker_user_id = ${one}::uuid)
         GROUP BY worker_user_id)
      UPDATE worker_profiles wp
         SET approved_30d = coalesce(s.a, 0),
             rejected_30d = coalesce(s.r, 0),
             approval_rate_pct = CASE WHEN coalesce(s.a, 0) + coalesce(s.r, 0) >= ${minDecisions}
                                      THEN round(100.0 * s.a / (s.a + s.r))::smallint END
        FROM worker_profiles w LEFT JOIN s ON s.uid = w.user_id
       WHERE wp.user_id = w.user_id
         AND (${one}::uuid IS NULL OR w.user_id = ${one}::uuid)
         AND (s.uid IS NOT NULL OR w.approved_30d + w.rejected_30d > 0 OR w.approval_rate_pct IS NOT NULL)`;
  }
  if (who.employerUserId !== undefined) {
    const one = who.employerUserId;
    await db.$executeRaw`
      WITH s AS (
        SELECT employer_user_id AS uid,
               count(*) FILTER (WHERE status = 'approved')::int AS a,
               count(*) FILTER (WHERE status = 'rejected')::int AS r
          FROM submissions
         WHERE status IN ('approved', 'rejected') AND decided_at >= ${since}
           AND (${one}::uuid IS NULL OR employer_user_id = ${one}::uuid)
         GROUP BY employer_user_id)
      UPDATE employer_profiles ep
         SET approval_rate_pct = CASE WHEN coalesce(s.a, 0) + coalesce(s.r, 0) >= ${minDecisions}
                                      THEN round(100.0 * s.a / (s.a + s.r))::smallint END
        FROM employer_profiles e LEFT JOIN s ON s.uid = e.user_id
       WHERE ep.user_id = e.user_id
         AND (${one}::uuid IS NULL OR e.user_id = ${one}::uuid)
         AND (s.uid IS NOT NULL OR e.approval_rate_pct IS NOT NULL)`;
  }
}

/** Refresh both sides of one submission's decision. */
export function refreshRatesFor(db: Db, sub: { workerUserId: string; employerUserId: string }) {
  return refreshApprovalRates(db, { workerUserId: sub.workerUserId, employerUserId: sub.employerUserId });
}
