import { cn } from '../utils/cn';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  tone?: 'subtle' | 'default' | 'inverse';
  className?: string;
}

export function Divider({ orientation = 'horizontal', tone = 'subtle', className }: DividerProps) {
  const color = tone === 'subtle' ? 'bg-line-subtle' : tone === 'inverse' ? 'bg-line-inverse' : 'bg-line';
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(color, orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch', className)}
    />
  );
}
