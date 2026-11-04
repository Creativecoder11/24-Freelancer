'use client';
/**
 * Worker wallet data layer (Doc 06 §5.11, §5.12): response types, query keys and hooks.
 * Money stays as decimal strings end to end; formatting goes through @24f/shared.
 */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KycDocumentType, KycStatus, PayoutMethodType, WithdrawalStatus } from '@24f/shared';
import { api, apiFetch, ApiError } from '@/lib/api/client';

export interface PayoutMethod {
  id: string;
  method_type: PayoutMethodType;
  label: string;
  display_name: string;
  account_masked: string;
  account_last3: string;
  destination_label: string;
  is_default: boolean;
  status: 'active' | 'pending_review' | 'disabled';
  usable_from: string;
  in_cooldown: boolean;
  method_enabled: boolean;
  created_at: string;
}

export interface MethodConfig {
  method_type: PayoutMethodType;
  display_name: string;
  subtitle: string;
  account_label: string;
  account_regex: string;
  payout_currency: string;
  min_usd: string;
  max_per_request_usd: string;
  fee_fixed_usd: string;
  fee_percent: string;
  quick_amounts_usd: string[];
  eta_text: string;
  enabled: boolean;
}

export interface PayoutMethodsMeta {
  total: number;
  limit: number;
  method_configs: MethodConfig[];
  disabled_methods: { method_type: PayoutMethodType; display_name: string; subtitle: string }[];
}

export interface WalletTx {
  ref: string;
  occurred_at: string;
  type: 'task_reward' | 'referral_commission' | 'withdrawal' | 'withdrawal_reversal' | 'adjustment';
  type_label: string;
  detail: string;
  amount_usd: string;
  amount_exact: string;
  amount_label: string;
  amount_style: 'credit' | 'debit';
  balance_after_usd: string | null;
  display_status: 'Added' | 'Processing' | 'Paid' | 'Refunded' | 'Cancelled' | 'Deducted';
  status_tone: 'success' | 'info' | 'danger' | 'neutral';
  withdrawal_ref: string | null;
  link_path: string | null;
}

export interface WalletSummary {
  available_usd: string;
  available_bdt_estimate: string | null;
  available_bdt_label: string | null;
  fx_rate_label: string | null;
  pending_review_usd: string;
  pending_review_tasks: number;
  in_flight_usd: string;
  in_flight_count: number;
  in_flight_latest: { requested_at: string; status: WithdrawalStatus; oldest_requested_at: string } | null;
  min_withdrawal_usd: string | null;
  can_withdraw: boolean;
  kyc_status: KycStatus;
  payout_methods: PayoutMethod[];
  recent_transactions: WalletTx[];
}

export interface EarningsChart {
  total_usd: string;
  total_tasks: number;
  bars: { date: string; amount_usd: string; tasks: number; is_today: boolean }[];
}

export interface Quote {
  quote_id: string | null;
  method: PayoutMethodType;
  method_label: string;
  amount_usd: string | null;
  fee_usd: string;
  net_usd: string | null;
  payout_currency: string;
  fx_rate: string;
  fx_rate_label: string;
  receive_amount: string | null;
  receive_label: string | null;
  available_usd: string;
  balance_after_usd: string;
  all_amount_usd: string;
  min_usd: string;
  max_per_request_usd: string;
  remaining_daily_usd: string;
  daily_requests_left: number;
  eta_text: string;
  needs_otp: boolean;
  gates: { kyc_status: KycStatus; account_status: string; method_usable_from: string | null };
  expires_at: string;
}

export interface WithdrawalCreated {
  ref: string;
  status: WithdrawalStatus;
  method: PayoutMethodType;
  destination_masked: string;
  amount_usd: string;
  fee_usd: string;
  payout_currency: string;
  fx_rate_label: string;
  payout_amount: string;
  receive_label: string;
  balance_after_usd: string;
  hold_until: string | null;
  warning_code: 'WITHDRAWAL_UNDER_REVIEW' | null;
  eta_text: string;
}

export interface WithdrawalRow {
  ref: string;
  requested_at: string;
  method: PayoutMethodType;
  method_label: string;
  destination_masked: string;
  amount_usd: string;
  received_label: string;
  status: WithdrawalStatus;
}

export interface WithdrawalsMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  counts: { all: number; processing: number; paid: number; rejected: number };
}

export interface WithdrawalDetail {
  ref: string;
  status: WithdrawalStatus;
  amount_usd: string;
  fee_usd: string;
  net_usd: string;
  method: PayoutMethodType;
  method_label: string;
  destination_masked: string;
  payout_currency: string;
  fx_rate: string;
  fx_rate_label: string;
  payout_amount: string;
  receive_label: string;
  timeline: { status: string; label: string; at: string | null; note: string | null; state: 'done' | 'current' | 'todo' | 'failed' }[];
  provider_trx_id: string | null;
  reason_text: string | null;
  refunded_at: string | null;
  hold_until: string | null;
  requested_at: string;
  cancellable: boolean;
}

export interface TxMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  has_more: boolean;
  summary: { credited_usd: string; withdrawn_usd: string };
}

export interface KycInfo {
  status: KycStatus;
  document_type: KycDocumentType | null;
  document_last4: string | null;
  submitted_at: string | null;
  review_due_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  can_submit: boolean;
  attempts_used: number;
  max_attempts: number;
}

export const wal = {
  all: ['wallet'] as const,
  summary: ['wallet', 'summary'] as const,
  chart: ['wallet', 'chart'] as const,
  methods: ['wallet', 'methods'] as const,
  quote: (k: string) => ['wallet', 'quote', k] as const,
  withdrawals: (qs: string) => ['wallet', 'withdrawals', qs] as const,
  withdrawal: (ref: string) => ['wallet', 'withdrawal', ref.toUpperCase()] as const,
  tx: (qs: string) => ['wallet', 'tx', qs] as const,
  kyc: ['me', 'kyc'] as const,
};

export function useWallet() {
  return useQuery<WalletSummary, ApiError>({ queryKey: wal.summary, queryFn: () => api.get<WalletSummary>('/worker/wallet') });
}

export function useEarningsChart() {
  return useQuery<EarningsChart, ApiError>({ queryKey: wal.chart, queryFn: () => api.get<EarningsChart>('/worker/wallet/earnings-chart') });
}

export function usePayoutMethods() {
  return useQuery<{ data: PayoutMethod[]; meta: PayoutMethodsMeta }, ApiError>({
    queryKey: wal.methods,
    queryFn: async () => {
      const r = await apiFetch<PayoutMethod[], PayoutMethodsMeta>('/payout-methods');
      return { data: r.data, meta: r.meta as PayoutMethodsMeta };
    },
  });
}

export function useWithdrawals(qs: URLSearchParams) {
  const key = qs.toString();
  return useQuery<{ data: WithdrawalRow[]; meta: WithdrawalsMeta }, ApiError>({
    queryKey: wal.withdrawals(key),
    queryFn: async () => {
      const r = await apiFetch<WithdrawalRow[], WithdrawalsMeta>(`/withdrawals${key ? `?${key}` : ''}`);
      return { data: r.data, meta: r.meta as WithdrawalsMeta };
    },
    placeholderData: keepPreviousData,
  });
}

export function useWithdrawal(ref: string | null) {
  return useQuery<WithdrawalDetail, ApiError>({
    queryKey: wal.withdrawal(ref ?? ''),
    queryFn: () => api.get<WithdrawalDetail>(`/withdrawals/${encodeURIComponent(ref!)}`),
    enabled: !!ref,
    retry: false,
  });
}

export function useTransactions(qs: URLSearchParams) {
  const key = qs.toString();
  return useQuery<{ data: WalletTx[]; meta: TxMeta }, ApiError>({
    queryKey: wal.tx(key),
    queryFn: async () => {
      const r = await apiFetch<WalletTx[], TxMeta>(`/worker/wallet/transactions${key ? `?${key}` : ''}`);
      return { data: r.data, meta: r.meta as TxMeta };
    },
    placeholderData: keepPreviousData,
  });
}

export function useKyc() {
  return useQuery<KycInfo, ApiError>({ queryKey: wal.kyc, queryFn: () => api.get<KycInfo>('/me/kyc') });
}

/** After any money or method change: wallet, history, shell balance pill and /me. */
export function useInvalidateWallet() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: wal.all });
    void qc.invalidateQueries({ queryKey: ['worker', 'overview'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
}

/** New Idempotency-Key per form open (Doc 06 §1.10). */
export function newIdemKey(prefix: string) {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${r}`.slice(0, 80);
}

export const METHOD_SHORT: Record<PayoutMethodType, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', usdt_trc20: 'USDT TRC20' };
