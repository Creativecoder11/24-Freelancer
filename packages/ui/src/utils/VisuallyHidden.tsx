export function VisuallyHidden({ children, id, as: As = 'span' }: { children: React.ReactNode; id?: string; as?: 'span' | 'div' | 'h2' }) {
  return (
    <As id={id} className="sr-only">
      {children}
    </As>
  );
}
