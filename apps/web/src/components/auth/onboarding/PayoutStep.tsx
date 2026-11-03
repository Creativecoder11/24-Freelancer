'use client';
import NextLink from 'next/link';
import { Alert, Button, buttonClasses, toast } from '@24f/ui';
import { OnboardingCard, OnboardingShell, OnboardingTwoColumn, SAVE_FAILED, SetupChecklist, SkipLink, useOnboardingStep, workerChecklist } from './OnboardingShell';

/**
 * SCR-AUTH-ND1 Onboarding step 3, payout method (G-03, Doc 02 §6.9.5). Placeholder until the
 * wallet module ships payout methods: the step is skippable and finishes onboarding.
 */
export function PayoutStep() {
  return (
    <OnboardingShell right={<SkipLink />}>
      {() => (
        <OnboardingTwoColumn checklist={<SetupChecklist items={workerChecklist(3)} />}>
          <PayoutCard />
        </OnboardingTwoColumn>
      )}
    </OnboardingShell>
  );
}

function PayoutCard() {
  const step = useOnboardingStep();
  const finish = () => step.mutate({ step: 'skip' }, { onError: () => toast.show(SAVE_FAILED) });
  return (
    <OnboardingCard
      overline="STEP 3 OF 3 · PAYOUT METHOD"
      title="Where should we send your earnings?"
      sub="You can add this later, but you’ll need it before your first withdrawal."
    >
      <Alert tone="info" className="mt-8">
        Add a payout method later in Settings.
      </Alert>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <NextLink href="/onboarding/interests" className={buttonClasses({ variant: 'secondary', size: 'L', className: 'w-[120px]' })}>
          Back
        </NextLink>
        <Button variant="tertiary" size="L" onClick={finish} disabled={step.isPending}>
          Skip for now
        </Button>
        <Button size="L" className="w-[160px]" onClick={finish} loading={step.isPending} loadingText="Finishing…">
          Finish setup
        </Button>
      </div>
    </OnboardingCard>
  );
}
