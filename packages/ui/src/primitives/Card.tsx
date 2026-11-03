import { cn } from '../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 0 | 16 | 20 | 24;
  as?: 'div' | 'section' | 'article';
}

const PAD = { 0: '', 16: 'p-4', 20: 'p-5', 24: 'p-6' } as const;

/** Surface + 1px border + radius 16 + Shadow/XS. Shared base for panels. */
export function Card({ padding = 24, as: As = 'div', className, ...rest }: CardProps) {
  return <As className={cn('rounded-card border border-line bg-surface shadow-xs', PAD[padding], className)} {...rest} />;
}
