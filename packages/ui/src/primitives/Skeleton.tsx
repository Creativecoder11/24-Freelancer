import { cn } from '../utils/cn';
import type { WithClassName } from '../types';

interface BoneProps extends WithClassName {
  width?: number | string;
  height?: number;
  radius?: number;
}

/** One bone: bg/muted + left→right shimmer 1.2 s (off under reduced motion). */
function Bone({ width, height = 16, radius = 6, className }: BoneProps) {
  return (
    <span
      aria-hidden
      className={cn('relative block overflow-hidden bg-muted', className)}
      style={{ width, height, borderRadius: radius }}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-[linear-gradient(90deg,transparent,var(--fl-skeleton-shine),transparent)] motion-reduce:hidden" />
    </span>
  );
}

function SkJobCard() {
  return (
    <div aria-hidden className="relative h-64 w-full rounded-card border border-line bg-surface p-[19px]">
      <Bone width={84} height={24} />
      <Bone width="88%" height={16} className="mt-4" />
      <Bone width="62%" height={16} className="mt-2" />
      <Bone width={180} height={12} className="mt-4" />
      <Bone width="100%" height={6} radius={3} className="mt-6" />
      <div className="absolute inset-x-[19px] bottom-[19px] flex items-end justify-between">
        <Bone width={90} height={24} className="mb-0.5" />
        <Bone width={104} height={36} radius={8} />
      </div>
    </div>
  );
}
function SkJobRow() {
  return (
    <div aria-hidden className="flex h-[76px] items-center gap-6 border-b border-line-subtle bg-surface px-6">
      <div className="flex-1 space-y-2">
        <Bone width="45%" height={16} />
        <Bone width="30%" height={12} />
      </div>
      <Bone width={180} height={6} radius={3} />
      <Bone width={56} height={20} />
      <Bone width={80} height={36} radius={8} />
    </div>
  );
}
function SkTaskRow() {
  return (
    <div aria-hidden className="flex h-[84px] items-center gap-6 border-b border-line-subtle bg-surface px-6">
      <div className="flex-1 space-y-2">
        <Bone width="50%" height={16} />
        <Bone width="30%" height={12} />
      </div>
      <Bone width={56} height={20} />
      <Bone width={80} height={24} radius={12} />
      <Bone width={120} height={14} />
    </div>
  );
}
function SkStatCard() {
  return (
    <div aria-hidden className="h-[136px] rounded-card border border-line bg-surface p-6">
      <Bone width={120} height={14} />
      <Bone width={96} height={32} className="mt-3" />
      <Bone width={160} height={12} className="mt-4" />
    </div>
  );
}
function SkTableRow({ columns }: { columns: number }) {
  return (
    <div aria-hidden className="flex h-[52px] items-center gap-4 border-b border-line-subtle px-4">
      {Array.from({ length: columns }, (_, i) => (
        <Bone key={i} width={`${100 / columns}%`} height={14} />
      ))}
    </div>
  );
}
function SkNotificationItem() {
  return (
    <div aria-hidden className="flex h-[88px] items-start justify-between border-b border-line-subtle bg-surface px-6 pt-4">
      <div className="flex-1 space-y-2">
        <Bone width="35%" height={14} />
        <Bone width="70%" height={14} />
      </div>
      <Bone width={56} height={12} />
    </div>
  );
}
function SkForm({ fields = 3 }: { fields?: number }) {
  return (
    <div aria-hidden className="space-y-6">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Bone width={120} height={14} />
          <Bone width="100%" height={48} radius={10} className="mt-2" />
        </div>
      ))}
    </div>
  );
}

type SkeletonComponent = React.FC<BoneProps> & {
  JobCard: React.FC;
  JobRow: React.FC;
  TaskRow: React.FC;
  StatCard: React.FC;
  TableRow: React.FC<{ columns: number }>;
  NotificationItem: React.FC;
  Form: React.FC<{ fields?: number }>;
};

export const Skeleton: SkeletonComponent = Object.assign(Bone, {
  JobCard: SkJobCard,
  JobRow: SkJobRow,
  TaskRow: SkTaskRow,
  StatCard: SkStatCard,
  TableRow: SkTableRow,
  NotificationItem: SkNotificationItem,
  Form: SkForm,
});

/** Sets aria-busy and a visually hidden "Loading…" status around skeletons. */
export function LoadingRegion({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        {label}…
      </span>
      {children}
    </div>
  );
}
