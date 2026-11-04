import type { Metadata } from 'next';
import { TaskDetail } from '@/components/worker/tasks/TaskDetail';

export const metadata: Metadata = { title: 'Task details' };

/** SCR-WRK-07 Task status details. */
export default async function Page({ params }: { params: Promise<{ submissionRef: string }> }) {
  const { submissionRef } = await params;
  return <TaskDetail submissionRef={submissionRef.toUpperCase()} />;
}
