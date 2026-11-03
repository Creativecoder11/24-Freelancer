'use client';
import { useState } from 'react';
import { Button } from '@24f/ui';

/** "Was this helpful?" (SCR-PUB-ND1): optional, analytics only — no API call. */
export function WasThisHelpful({ slug }: { slug: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const pick = (v: 'yes' | 'no') => {
    setAnswer(v);
    (window as Window & { dataLayer?: unknown[] }).dataLayer?.push({ event: 'help_article_feedback', slug, helpful: v === 'yes' });
  };
  return (
    <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-6" aria-live="polite">
      {answer ? (
        <p className="text-body-sm text-fg-secondary">Thanks for letting us know.</p>
      ) : (
        <>
          <p className="mr-2 text-label-md text-fg">Was this helpful?</p>
          <Button variant="secondary" size="S" onClick={() => pick('yes')}>
            Yes
          </Button>
          <Button variant="secondary" size="S" onClick={() => pick('no')}>
            No
          </Button>
        </>
      )}
    </div>
  );
}
