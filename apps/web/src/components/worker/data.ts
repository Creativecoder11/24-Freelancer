'use client';
/**
 * Worker data layer (Doc 03 §8, Doc 06 §5.6, §5.7, §5.15): query keys and hooks over the browser
 * client. Server time offsets come from the envelope `serverTime` so countdowns stay honest.
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  ListMeta,
  NotificationPreferences,
  NotificationRow,
  NotificationsMeta,
  UnreadCount,
  WorkerJobCard,
  WorkerJobDetail,
  WorkerOverview,
  WorkerSubmissionDetail,
  WorkerTaskRow,
  WorkerTaskSummary,
} from '@24f/shared';
import { api, apiFetch, ApiError } from '@/lib/api/client';

export const wk = {
  all: ['worker'] as const,
  overview: ['worker', 'overview'] as const,
  jobs: (qs: string) => ['worker', 'jobs', qs] as const,
  jobCount: (qs: string) => ['worker', 'jobs', 'count', qs] as const,
  job: (id: string) => ['worker', 'job', id.toUpperCase()] as const,
  tasks: (qs: string) => ['worker', 'tasks', qs] as const,
  task: (ref: string) => ['worker', 'task', ref.toUpperCase()] as const,
  notifications: (tab: string) => ['notifications', 'worker', tab] as const,
  unread: ['notifications', 'unread'] as const,
  prefs: ['notifications', 'preferences'] as const,
};

/** True while the document is visible (polling only runs then). */
export function useVisible() {
  const [v, setV] = useState(true);
  useEffect(() => {
    const on = () => setV(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

export function useOverview() {
  return useQuery<WorkerOverview, ApiError>({ queryKey: wk.overview, queryFn: () => api.get<WorkerOverview>('/worker/overview'), staleTime: 20_000 });
}

/** Unread count polls every 60 s while visible (SCR-WRK-09). */
export function useUnreadCount() {
  const visible = useVisible();
  return useQuery<UnreadCount, ApiError>({
    queryKey: wk.unread,
    queryFn: () => api.get<UnreadCount>('/notifications/unread-count', { query: { audience: 'worker' } }),
    refetchInterval: visible ? 60_000 : false,
    staleTime: 15_000,
  });
}

export type JobsMeta = ListMeta & {
  counts: Record<string, number>;
  facets: { category: Record<string, number>; time: Record<string, number>; proof: Record<string, number> };
};

export function useWorkerJobs(qs: string) {
  const visible = useVisible();
  return useQuery<{ data: WorkerJobCard[]; meta: JobsMeta; at: number }, ApiError>({
    queryKey: wk.jobs(qs),
    queryFn: async () => {
      const r = await apiFetch<WorkerJobCard[], JobsMeta>(`/worker/jobs${qs ? `?${qs}` : ''}`);
      return { data: r.data, meta: r.meta as JobsMeta, at: Date.now() };
    },
    placeholderData: keepPreviousData,
    refetchInterval: visible ? 60_000 : false,
  });
}

/** Server clock offset (serverTime − local now) for countdowns. */
export function offsetFrom(serverTime: string | undefined): number {
  if (!serverTime) return 0;
  const t = new Date(serverTime).getTime();
  return Number.isFinite(t) ? t - Date.now() : 0;
}

export function useWorkerJob(publicId: string) {
  return useQuery<{ job: WorkerJobDetail; offset: number }, ApiError>({
    queryKey: wk.job(publicId),
    queryFn: async () => {
      const r = await apiFetch<WorkerJobDetail>(`/worker/jobs/${encodeURIComponent(publicId)}`);
      return { job: r.data, offset: offsetFrom(r.serverTime) };
    },
    staleTime: 10_000,
  });
}

export type TasksMeta = ListMeta & { counts: Record<'all' | 'in_review' | 'approved' | 'needs_fix' | 'rejected', number>; summary: WorkerTaskSummary };

export function useWorkerTasks(qs: string) {
  return useQuery<{ data: WorkerTaskRow[]; meta: TasksMeta }, ApiError>({
    queryKey: wk.tasks(qs),
    queryFn: async () => {
      const r = await apiFetch<WorkerTaskRow[], TasksMeta>(`/worker/submissions${qs ? `?${qs}` : ''}`);
      return { data: r.data, meta: r.meta as TasksMeta };
    },
    placeholderData: keepPreviousData,
  });
}

export function useWorkerTask(ref: string) {
  return useQuery<{ task: WorkerSubmissionDetail; offset: number }, ApiError>({
    queryKey: wk.task(ref),
    queryFn: async () => {
      const r = await apiFetch<WorkerSubmissionDetail>(`/worker/submissions/${encodeURIComponent(ref)}`);
      return { task: r.data, offset: offsetFrom(r.serverTime) };
    },
  });
}

export function useNotificationPrefs() {
  return useQuery<NotificationPreferences, ApiError>({ queryKey: wk.prefs, queryFn: () => api.get<NotificationPreferences>('/notifications/preferences') });
}

export type { NotificationRow, NotificationsMeta };
