import { Button, Logo } from '@24f/ui';

/** SCR-PUB-ND7 error layout (G-17): centred, Logo Badge 96, H1 + body + actions. */
export function ErrorScreen({
  code,
  title,
  body,
  actions,
}: {
  code?: string;
  title: string;
  body: string;
  actions?: { label: string; href?: string; onClick?: () => void; variant?: 'primary' | 'secondary' }[];
}) {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-[560px] flex-col items-center justify-center px-5 py-20 text-center">
      <div data-reveal className="flex flex-col items-center">
        <Logo type="badge" height={96} decorative />
        {code ? <p className="mt-8 font-display text-num-xl text-fg-brand">{code}</p> : null}
        <h1 className={`${code ? 'mt-2' : 'mt-8'} font-display text-[32px] font-bold leading-10 tracking-[-0.8px] text-fg tablet:text-h1`}>{title}</h1>
        <p className="mt-3 text-body-lg text-fg-secondary">{body}</p>
        {actions?.length ? (
          <div className="mt-8 flex w-full flex-col justify-center gap-3 tablet:w-auto tablet:flex-row">
            {actions.map((a) => (
              <Button key={a.label} href={a.href} onClick={a.onClick} variant={a.variant ?? 'primary'} size="L" className="min-w-[160px]">
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
