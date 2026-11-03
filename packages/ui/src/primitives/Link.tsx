import NextLink from 'next/link';
import { forwardRef } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';

type LinkTone = 'brand' | 'warning' | 'danger' | 'info' | 'success' | 'inverse';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: 'inline' | 'standalone' | 'arrow' | 'back';
  tone?: LinkTone;
  /** target=_blank, rel=noopener noreferrer, external-link icon + hidden "(opens in a new tab)". */
  external?: boolean;
}

const TONE: Record<LinkTone, string> = {
  brand: 'text-fg-brand',
  warning: 'text-fg-warning',
  danger: 'text-fg-danger',
  info: 'text-fg-info',
  success: 'text-fg-success',
  inverse: 'text-fg-inverse-secondary hover:text-fg-inverse focus-visible:shadow-focus-inverse',
};

export function linkClasses(variant: LinkProps['variant'] = 'standalone', tone: LinkTone = 'brand', className?: string) {
  return cn(
    'group/link rounded-[4px] focus-visible:outline-none focus-visible:shadow-focus',
    variant === 'inline' ? 'text-[length:inherit]' : tone === 'inverse' ? 'text-body-sm' : 'text-label-md',
    (variant === 'arrow' || variant === 'back') && 'inline-flex items-center gap-1.5',
    variant === 'back'
      ? 'text-fg-secondary hover:text-fg'
      : cn(TONE[tone], tone !== 'inverse' && 'hover:underline underline-offset-2'),
    className,
  );
}

/** Text link (Doc 02 §5.4). Navigation only; data-changing actions use LinkButton. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, variant = 'standalone', tone = 'brand', external, className, children, ...rest },
  ref,
) {
  const content = (
    <>
      {variant === 'back' ? <Icon name="arrow-left" size={16} /> : null}
      {children}
      {variant === 'arrow' ? (
        <span className="inline-flex transition-transform duration-[120ms] group-hover/link:translate-x-0.5">
          <Icon name="arrow-right" size={16} />
        </span>
      ) : null}
      {external ? (
        <>
          <Icon name="external-link" size={14} className="ml-1 inline align-[-2px]" />
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      ) : null}
    </>
  );
  const cls = linkClasses(variant, tone, className);
  if (external) {
    return (
      <a ref={ref} href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <NextLink ref={ref} href={href} className={cls} {...rest}>
      {content}
    </NextLink>
  );
});

export interface LinkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: LinkTone;
}

/** A <button> styled as a link: "Release slot", "Sign out others", "Copy reference". */
export const LinkButton = forwardRef<HTMLButtonElement, LinkButtonProps>(function LinkButton(
  { tone = 'brand', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cn(linkClasses('standalone', tone), 'disabled:text-fg-disabled disabled:no-underline', className)} {...rest} />;
});
