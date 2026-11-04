import { Button, EmptyState } from '@24f/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="rounded-card border border-line bg-surface">
        <EmptyState icon="search" title="We can't find that page" body="Check the address, or go back to the dashboard." action={<Button href="/">Go to dashboard</Button>} />
      </div>
    </div>
  );
}
