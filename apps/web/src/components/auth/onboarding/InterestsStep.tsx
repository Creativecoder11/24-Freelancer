'use client';
import { useState } from 'react';
import NextLink from 'next/link';
import { CATEGORY_SLUG, INTEREST_DEVICE, INTEREST_TIME, PUBLIC_CATEGORY_SLUGS, type InterestDevice, type InterestTime, type Me } from '@24f/shared';
import { Button, SegmentedControl, SelectableCard, buttonClasses, toast } from '@24f/ui';
import { OnboardingCard, OnboardingShell, OnboardingTwoColumn, SAVE_FAILED, SetupChecklist, SkipLink, useOnboardingStep, workerChecklist } from './OnboardingShell';

const TIME_LABEL: Record<InterestTime, string> = { under_15: 'Under 15 min', '15_60': '15–60 min', over_60: 'More than 1 h' };
const DEVICE_LABEL: Record<InterestDevice, string> = { phone: 'Phone', desktop: 'Laptop / desktop' };

/** Figma 27:842 toggles: 48 high, radius 12, 40 px segments. */
const TALL_SEGMENTS = 'h-12 rounded-[12px] [&>button]:h-10';

/** SCR-AUTH-07 First-time onboarding, interests (Figma 27:734). */
export function InterestsStep() {
  return (
    <OnboardingShell right={<SkipLink />}>
      {(me) => (
        <OnboardingTwoColumn checklist={<SetupChecklist items={workerChecklist(2)} />}>
          <InterestsCard me={me} />
        </OnboardingTwoColumn>
      )}
    </OnboardingShell>
  );
}

function InterestsCard({ me }: { me: Me }) {
  const [cats, setCats] = useState<string[]>(me.interests.filter((s) => s !== 'other'));
  const [time, setTime] = useState<InterestTime | null>((me.interest_time as InterestTime | null) ?? null);
  const [device, setDevice] = useState<InterestDevice | null>((me.interest_device as InterestDevice | null) ?? null);
  const step = useOnboardingStep();
  const toggle = (slug: string, on: boolean) => setCats((c) => (on ? [...new Set([...c, slug])] : c.filter((s) => s !== slug)));

  return (
    <OnboardingCard
      overline="STEP 2 OF 3 · YOUR INTERESTS"
      title="What kinds of tasks do you enjoy?"
      sub="We’ll show these first in Find jobs. Pick as many as you like — you can change them later."
    >
      <fieldset className="mt-6 tablet:mt-8">
        <legend className="sr-only">Task types</legend>
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4 tablet:gap-4">
          {PUBLIC_CATEGORY_SLUGS.map((slug) => (
            <SelectableCard
              key={slug}
              type="checkbox"
              name="categories"
              value={slug}
              checked={cats.includes(slug)}
              onChange={(on) => toggle(slug, on)}
              title={CATEGORY_SLUG.labels[slug]}
              className="min-h-14 rounded-[16px] py-0"
            />
          ))}
        </div>
      </fieldset>

      <div className="mt-8 tablet:mt-[100px]">
        <p id="time-q" className="text-label-lg text-fg">
          How much time do you usually have?
        </p>
        <SegmentedControl<InterestTime>
          label="How much time do you usually have?"
          kind="radio"
          fullWidth
          className={`mt-3 tablet:w-[600px] ${TALL_SEGMENTS}`}
          value={(time ?? '') as InterestTime}
          onChange={setTime}
          options={INTEREST_TIME.values.map((v) => ({ value: v, label: TIME_LABEL[v] }))}
        />
      </div>
      <div className="mt-8">
        <p className="text-label-lg text-fg">Which device do you mostly use?</p>
        <SegmentedControl<InterestDevice>
          label="Which device do you mostly use?"
          kind="radio"
          fullWidth
          className={`mt-3 tablet:w-[404px] ${TALL_SEGMENTS}`}
          value={(device ?? '') as InterestDevice}
          onChange={setDevice}
          options={INTEREST_DEVICE.values.map((v) => ({ value: v, label: DEVICE_LABEL[v] }))}
        />
      </div>

      <div className="mt-8 flex justify-end gap-3 tablet:mt-4">
        <NextLink href="/onboarding/role" className={buttonClasses({ variant: 'secondary', size: 'L', className: 'w-[120px]' })}>
          Back
        </NextLink>
        <Button
          size="L"
          className="w-[160px]"
          loading={step.isPending}
          loadingText="Saving…"
          onClick={() =>
            step.mutate(
              { step: 'interests', categories: cats, interest_time: time, interest_device: device },
              { onError: () => toast.show(SAVE_FAILED) },
            )
          }
        >
          Continue
        </Button>
      </div>
    </OnboardingCard>
  );
}
