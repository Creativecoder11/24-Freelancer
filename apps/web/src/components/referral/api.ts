'use client';
/** Referral data layer (Doc 06 §5.14). */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReferralStatus } from '@24f/shared';
import { api, apiFetch, ApiError } from '@/lib/api/client';

export interface Friend {
  id: string;
  name_masked: string;
  initials: string;
  joined_at: string;
  tasks: number;
  deposits_usd: string | null;
  earned_usd: string | null;
  status: ReferralStatus;
  can_remind: boolean;
  next_reminder_at: string | null;
  reminders_left: number;
  last_activity_at: string | null;
}

export interface ReferralSummary {
  code: string;
  link: string;
  public_link: string;
  task_rate: string;
  deposit_rate: string;
  share_message: string;
  rate_label: string;
  stats: { friends_joined: number; active_friends: number; from_tasks_usd: string; from_deposits_usd: string; total_earned_usd: string };
  commission_status: { added_to_balance_usd: string; pending_usd: string; not_eligible_usd: string };
  top_friends: Friend[];
}

export interface FriendDetail extends Friend {
  earned_usd: string;
  monthly_earnings: { month: string; label: string; amount_usd: string; is_current: boolean }[];
  recent_commission: { date: string; source_type: 'task' | 'deposit'; label: string; tasks: number; amount_usd: string }[];
}

export interface FriendsMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  counts: { all: number; active: number; not_started: number };
}

export const ref = {
  all: ['referral'] as const,
  summary: ['referral', 'summary'] as const,
  friends: (qs: string) => ['referral', 'friends', qs] as const,
  friend: (id: string) => ['referral', 'friend', id] as const,
};

export function useReferralSummary() {
  return useQuery<ReferralSummary, ApiError>({ queryKey: ref.summary, queryFn: () => api.get<ReferralSummary>('/referral/summary') });
}

export function useFriends(qs: URLSearchParams) {
  const key = qs.toString();
  return useQuery<{ data: Friend[]; meta: FriendsMeta }, ApiError>({
    queryKey: ref.friends(key),
    queryFn: async () => {
      const r = await apiFetch<Friend[], FriendsMeta>(`/referral/friends?${key}`);
      return { data: r.data, meta: r.meta as FriendsMeta };
    },
    placeholderData: keepPreviousData,
  });
}

export function useFriend(id: string | null) {
  return useQuery<FriendDetail, ApiError>({ queryKey: ref.friend(id ?? ''), queryFn: () => api.get<FriendDetail>(`/referral/friends/${id}`), enabled: !!id, retry: false });
}
