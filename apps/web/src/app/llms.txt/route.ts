import type { HelpArticleRow, PublicCategory, PublicConfig } from '@24f/shared';
import { apiTry } from '@/lib/api/server';
import { SITE_DESCRIPTION, SITE_NAME, abs } from '@/lib/site';

// Refreshed hourly so categories, rates and help articles stay current.
export const revalidate = 3600;

/**
 * /llms.txt (llmstxt.org): a plain-language brief that AI assistants and answer engines (ChatGPT,
 * Claude, Perplexity, Gemini) read to describe 24 Freelancing accurately and link to the right pages.
 */
export async function GET() {
  const [config, cats, articles] = await Promise.all([
    apiTry<PublicConfig>('/public/config', 3600),
    apiTry<PublicCategory[]>('/public/categories', 3600),
    apiTry<HelpArticleRow[]>('/public/help/articles', 3600),
  ]);
  const pct = +(Number(config?.data.referral.task_rate ?? '0.05') * 100).toFixed(2);
  const categories = (cats?.data ?? []).map((c) => c.name).join(', ') || 'Data entry, Surveys, Website testing, App testing, Writing, Image tagging, Social media, Research';
  const help = (articles?.data ?? []).map((a) => `- [${a.title}](${abs(`/help/${a.topic_slug}/${a.slug}`)})${a.summary ? `: ${a.summary}` : ''}`).join('\n');

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} (${abs('/')}) is an online microtask marketplace. One account can both earn (as a worker) and hire (as an employer). Payouts are popular in Bangladesh (bKash, Nagad, Rocket) and also available in USDT.

## For workers — how to earn
1. Create a free account (email or phone).
2. Pick a job. Every job shows the reward per task, the estimated time and the exact proof required (screenshot, link, text answer or file) before you start.
3. Follow the numbered steps and submit your proof.
4. The employer reviews within the review window shown on the job; unreviewed work is approved automatically when the window ends. Every rejection includes a reason, and a task sent back for a fix can be resubmitted.
5. Approved rewards are added to your balance. Withdraw once you reach the minimum.

Job categories: ${categories}.

## For employers — how to hire
1. Describe the job: title, category, numbered steps and the proof you need.
2. Set the reward per task and the number of workers (slots). The full budget (reward × slots) is reserved from your balance when you publish.
3. Review submissions and approve good work (in bulk if you like). You pay only for approved tasks.
4. When a job closes or ends, the budget for unused slots returns to your balance automatically.
Optional promotions (Top, Pin) give a job more visibility.

## Key facts
- Withdrawals: bKash, Nagad, Rocket and USDT (TRC20). The minimum is $5.00 on every method; payouts usually arrive within 24 hours. Fees and timing are shown before you confirm.
- Identity verification is required once, before a worker's first withdrawal.
- Referral program: when a friend you invite gets their first task approved, you earn ${pct}% of that task's reward — a one-time bonus per friend. Later tasks and deposits don't earn commission. Self-referrals and duplicate accounts don't earn.
- Deposits fund jobs and are not withdrawable (see the refund policy for exceptions).

## Main pages
- [Home](${abs('/')}): what ${SITE_NAME} is, how it works, FAQ
- [Browse jobs](${abs('/jobs')}): open microtasks with reward, time and proof
- [Job categories](${abs('/jobs/categories')})
- [How it works](${abs('/how-it-works')}): step by step for workers and employers
- [Referral program](${abs('/referral-program')})
- [Recent payouts](${abs('/payout-history')}): latest paid withdrawals (names partly hidden)
- [Help center & FAQ](${abs('/help')})
- [About & contact](${abs('/about')})

## Help articles
${help || `- [Help center](${abs('/help')})`}

## Policies
- [Terms of service](${abs('/legal/terms')})
- [Privacy policy](${abs('/legal/privacy')})
- [Refund policy](${abs('/legal/refund')})
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
