'use client';
import type { AlertTone } from '../types';

export interface ToastInput {
  tone: AlertTone;
  title: string;
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  /** Default 5 s; danger or with action 8 s (Doc 02 §7.6). */
  durationMs?: number;
}
export interface ToastItem extends ToastInput {
  id: string;
  createdAt: number;
  durationMs: number;
  leaving: boolean;
}

const MAX = 3;
const DEDUPE_MS = 2000;
const EMPTY: ToastItem[] = [];
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let seq = 0;

export const toastStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get: () => items,
  getServer: (): ToastItem[] => EMPTY,
  push(input: ToastInput): string {
    const now = Date.now();
    const dup = items.find((t) => !t.leaving && t.title === input.title && t.body === input.body && now - t.createdAt < DEDUPE_MS);
    if (dup) return dup.id;
    const id = `t${++seq}-${now}`;
    const durationMs = input.durationMs ?? (input.tone === 'danger' || input.action ? 8000 : 5000);
    let next = [...items, { ...input, id, durationMs, createdAt: now, leaving: false }];
    // Max 3 visible: older ones are dismissed first.
    const active = next.filter((t) => !t.leaving);
    if (active.length > MAX) {
      const drop = new Set(active.slice(0, active.length - MAX).map((t) => t.id));
      next = next.map((t) => (drop.has(t.id) ? { ...t, leaving: true } : t));
    }
    items = next;
    emit();
    return id;
  },
  /** Starts the exit animation. */
  dismiss(id: string) {
    items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    emit();
  },
  /** Removes after exit. */
  remove(id: string) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};

/** Imperative API usable outside React (mutations, API client). */
export const toast = {
  show: (i: ToastInput) => toastStore.push(i),
  dismiss: (id: string) => toastStore.dismiss(id),
  success: (title: string, body?: string) => toastStore.push({ tone: 'success', title, body }),
  error: (title: string, body?: string) => toastStore.push({ tone: 'danger', title, body }),
  warning: (title: string, body?: string) => toastStore.push({ tone: 'warning', title, body }),
  info: (title: string, body?: string) => toastStore.push({ tone: 'info', title, body }),
};
