'use client';
/** Shared referral pieces: reminder button (with cooldown) and the masked-friend avatar. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@24f/shared';
import { Avatar, Button, toast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';
import { ref, type Friend } from './api';

export function FriendAvatar({ f, size = 'M' }: { f: Pick<Friend, 'initials' | 'name_masked' | 'id'>; size?: 'M' | 'L' | 'XL' }) {
  return <Avatar initials={f.initials} size={size} colorSeed={f.id} name={f.name_masked} />;
}

/** "Send a reminder" (FR-REF-010): 1 per friend per 7 days, max 3 (Canonical §17). */
export function RemindButton({ f, size = 'S' }: { f: Friend; size?: 'S' | 'M' }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (f.status !== 'not_started') return null;
  const blocked = !f.can_remind || sent;
  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/referral/friends/${f.id}/remind`);
      setSent(true);
      toast.show({ tone: 'success', title: 'Reminder sent.' });
      void qc.invalidateQueries({ queryKey: ref.all });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REMINDER_COOLDOWN') toast.show({ tone: 'warning', title: 'You’ve already reminded them this week.', body: e.message });
      else if (e instanceof ApiError && e.code === 'FRIEND_ALREADY_ACTIVE') toast.show({ tone: 'info', title: 'This friend has already started.' });
      else toast.show({ tone: 'danger', title: 'That didn’t send', body: 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };
  const label = sent ? 'Reminder sent' : f.reminders_left === 0 ? 'No reminders left' : f.next_reminder_at ? `Remind again ${formatDate(f.next_reminder_at)}` : 'Send a reminder';
  return (
    <Button variant="secondary" size={size} onClick={run} loading={busy} disabled={blocked}>
      {label}
    </Button>
  );
}
