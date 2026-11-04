import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksPage } from '@/components/worker/tasks/TasksPage';

export const metadata: Metadata = { title: 'My tasks' };

/** SCR-WRK-06 My tasks. */
export default function Page() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
