'use client';
import NextLink from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { lengthBetween, websiteUrl, type Me, type PublicConfig } from '@24f/shared';
import { Alert, Button, Field, Select, buttonClasses } from '@24f/ui';
import { api } from '@/lib/api/client';
import { applyServerError } from '@/lib/form-errors';
import { OnboardingCard, OnboardingShell, SkipLink, useOnboardingStep } from './OnboardingShell';

const schema = z.object({
  business_name: lengthBetween(2, 80, 'Enter your business name (2–80 characters).'),
  website_url: z.union([z.literal(''), websiteUrl()]),
  industry: z.string().nullable(),
});
type Values = z.input<typeof schema>;

/** Employer onboarding, business profile basics (G-20, "Step 2 of 2"). */
export function BusinessStep() {
  return (
    <OnboardingShell right={<SkipLink />}>
      {(me) => (
        <div className="mx-auto mt-6 w-full max-w-[848px] tablet:mt-10 desktop:mt-[52px]">
          <BusinessCard me={me} />
        </div>
      )}
    </OnboardingShell>
  );
}

function BusinessCard({ me }: { me: Me }) {
  const config = useQuery({ queryKey: ['public', 'config'], queryFn: () => api.get<PublicConfig>('/public/config', { auth: false }), staleTime: 300_000 });
  const industries = (config.data?.industries ?? []).map((i) => ({ value: i, label: i }));
  const step = useOnboardingStep();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { business_name: me.employer?.business_name ?? me.full_name ?? '', website_url: '', industry: null },
  });
  const { register, handleSubmit, formState, control } = form;
  const onSubmit = handleSubmit(async (v) => {
    try {
      await step.mutateAsync({ step: 'business', business_name: v.business_name, website_url: v.website_url || null, industry: v.industry });
    } catch (err) {
      applyServerError(err, form);
    }
  });
  const rootErr = formState.errors.root?.server;
  return (
    <OnboardingCard
      overline="STEP 2 OF 2 · BUSINESS PROFILE"
      title="Tell us about your business"
      sub="Workers see this name on your jobs. You can change it any time in Settings."
    >
      <form noValidate onSubmit={onSubmit} className="mt-8 flex flex-col gap-6">
        {rootErr ? <Alert tone="danger">{rootErr.message}</Alert> : null}
        <Field
          label="Business name"
          autoComplete="organization"
          placeholder="e.g. Shelfwise Ltd."
          error={formState.errors.business_name?.message}
          readOnly={formState.isSubmitting}
          wrapperClassName="tablet:max-w-[480px]"
          {...register('business_name')}
        />
        <Field
          label="Website"
          optional
          inputMode="url"
          autoComplete="url"
          placeholder="e.g. shelfwise.com"
          error={formState.errors.website_url?.message}
          readOnly={formState.isSubmitting}
          wrapperClassName="tablet:max-w-[480px]"
          {...register('website_url')}
        />
        <Controller
          control={control}
          name="industry"
          render={({ field }) => (
            <Select
              label="Industry"
              optional
              placeholder="Choose an industry"
              options={industries}
              value={field.value ?? null}
              onChange={(v) => field.onChange(v)}
              error={formState.errors.industry?.message}
              disabled={formState.isSubmitting}
              className="tablet:max-w-[480px]"
            />
          )}
        />
        <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
          <NextLink href="/onboarding/role" className={buttonClasses({ variant: 'secondary', size: 'L', className: 'w-[120px]' })}>
            Back
          </NextLink>
          <Button type="submit" size="L" className="w-[160px]" loading={formState.isSubmitting} loadingText="Saving…">
            Continue
          </Button>
        </div>
      </form>
    </OnboardingCard>
  );
}
