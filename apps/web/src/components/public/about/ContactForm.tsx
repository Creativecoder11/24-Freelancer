'use client';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Checkbox, Field, FormErrorSummary, Select, Textarea, gsap, prefersReducedMotion } from '@24f/ui';
import { CONTACT_TOPIC, contactSchema, type ContactInput } from '@24f/shared';
import { sendContactAction } from '@/lib/api/public-actions';

const TOPIC_OPTIONS = CONTACT_TOPIC.values.map((v) => ({ value: v, label: CONTACT_TOPIC.labels[v] }));
const FIELD_ORDER = ['full_name', 'email', 'topic', 'account_public_id', 'message', 'consent'] as const;
type FieldName = (typeof FIELD_ORDER)[number];

const EMPTY: ContactInput = { full_name: '', email: '', topic: '', account_public_id: '', message: '', consent: false as unknown as true, website: '' };

/** Contact form (Figma 24:1651; states per SCR-PUB-08 / G-01). */
export function ContactForm() {
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<'save_failed' | 'rate_limited' | null>(null);
  const [summary, setSummary] = useState<{ field: string; message: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput>({ resolver: zodResolver(contactSchema), defaultValues: EMPTY, mode: 'onTouched' });

  const swapIn = () =>
    requestAnimationFrame(() => {
      if (!box.current || prefersReducedMotion()) return;
      gsap.fromTo(box.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
    });

  const focusField = (f: string) => {
    const el = document.querySelector<HTMLElement>(`[name="${f}"], #contact-${f}`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const onInvalid = (errs: typeof errors) =>
    setSummary(FIELD_ORDER.filter((f) => errs[f]?.message).map((f) => ({ field: f, message: String(errs[f]!.message) })));

  const onSubmit = handleSubmit(async (values) => {
    setSummary([]);
    setFailure(null);
    const res = await sendContactAction(values);
    if (res.ok) {
      setSent(true);
      swapIn();
      return;
    }
    if (res.status === 429) return setFailure('rate_limited');
    if (res.code === 'VALIDATION_FAILED' && res.fields) {
      const list: { field: string; message: string }[] = [];
      for (const [f, msgs] of Object.entries(res.fields)) {
        const message = msgs[0] ?? 'Check this field.';
        if ((FIELD_ORDER as readonly string[]).includes(f)) setError(f as FieldName, { message });
        list.push({ field: f, message });
      }
      return setSummary(list);
    }
    setFailure('save_failed');
  }, onInvalid);

  if (sent) {
    return (
      <div ref={box} className="space-y-5">
        <Alert tone="success" title="Message sent">
          We usually reply by email. Replies go out in the order requests arrive.
        </Alert>
        <Button
          variant="secondary"
          onClick={() => {
            reset(EMPTY);
            setSent(false);
            swapIn();
          }}
        >
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <div ref={box}>
      <form noValidate onSubmit={onSubmit} aria-labelledby="contact-h" className="space-y-6">
        <FormErrorSummary errors={summary} onFocusField={focusField} />
        <div className="grid gap-6 tablet:grid-cols-2">
          <Field id="contact-full_name" label="Full name" autoComplete="name" error={errors.full_name?.message} {...register('full_name')} />
          <Field id="contact-email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" error={errors.email?.message} {...register('email')} />
        </div>
        <Controller
          control={control}
          name="topic"
          render={({ field }) => (
            <Select
              id="contact-topic"
              name="topic"
              label="Topic"
              placeholder="Choose a topic"
              options={TOPIC_OPTIONS}
              value={(field.value as string) || null}
              onChange={(v) => field.onChange(v)}
              error={errors.topic?.message}
            />
          )}
        />
        <Field
          id="contact-account_public_id"
          label="Account ID"
          optional
          inputMode="numeric"
          maxLength={6}
          placeholder="e.g. 482910"
          helper="Helps us find your account faster. Never share your password."
          error={errors.account_public_id?.message}
          {...register('account_public_id')}
        />
        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <Textarea
              id="contact-message"
              label="Message"
              placeholder="Tell us what happened, including dates and amounts if it’s about a payment."
              helper="We usually reply by email. Don’t include passwords or full card numbers."
              softMax={300}
              error={errors.message?.message}
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        {/* Honeypot (VR-124): hidden from people, filled by bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" {...register('website')} />
          </label>
        </div>
        {failure ? (
          <Alert tone="danger" title={failure === 'rate_limited' ? undefined : 'That didn’t save'}>
            {failure === 'rate_limited'
              ? 'You’ve sent a few messages already. Try again later, or use live support.'
              : 'Your changes are still here. Try again.'}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-5 tablet:flex-row tablet:items-center tablet:justify-between">
          <Checkbox id="contact-consent" label="I agree to be contacted by email about this request" error={errors.consent?.message} {...register('consent')} />
          <Button type="submit" size="L" loading={isSubmitting} loadingText="Sending…" className="w-full shrink-0 tablet:w-[180px]">
            Send message
          </Button>
        </div>
      </form>
    </div>
  );
}
