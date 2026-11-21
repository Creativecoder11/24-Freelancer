/**
 * Manual deposit rails (CR-2026-11b): the employer sends money to our account, then submits their
 * sending account and the transaction reference. The deposit waits as `pending` until an admin
 * checks the reference and approves it (Admin → Deposits). No gateway API is involved.
 *
 * A rail shows on Add funds only when its group is in `deposit_methods_enabled`, its
 * `*_manual_enabled` setting is on and its receiving account is filled in.
 */
export const MANUAL_CHANNELS = ['bkash', 'nagad', 'rocket', 'binance_pay', 'usdt_trc20'] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

export interface ManualChannelDef {
  label: string;
  /** deposits.method stored for this rail. */
  group: 'mobile_wallet' | 'crypto';
  /** What the employer pays in: BDT at the deposit rate, or USD 1:1 (USDT). */
  currency: 'BDT' | 'USD';
  enabledKey: string;
  accountKey: string;
  accountTypeKey?: string;
  /** Fallback receiving account when the setting is missing (bKash kept its launch default). */
  accountDefault: string;
  accountLabel: string;
  senderLabel: string;
  senderPlaceholder: string;
  senderPattern: RegExp;
  senderError: string;
  refLabel: string;
  refPlaceholder: string;
  /** Checked after trim + upper case. */
  refPattern: RegExp;
  refError: string;
  instructions: string;
}

const BD_MOBILE = /^01[3-9]\d{8}$/;

export const CHANNELS: Record<ManualChannel, ManualChannelDef> = {
  bkash: {
    label: 'bKash',
    group: 'mobile_wallet',
    currency: 'BDT',
    enabledKey: 'bkash_manual_enabled',
    accountKey: 'bkash_manual_number',
    accountTypeKey: 'bkash_manual_account_type',
    accountDefault: '01700000000',
    accountLabel: 'bKash number',
    senderLabel: 'Your bKash number (sender)',
    senderPlaceholder: '01XXXXXXXXX',
    senderPattern: BD_MOBILE,
    senderError: 'Enter the bKash number you sent from, like 01712345678.',
    refLabel: 'bKash TrxID',
    refPlaceholder: 'e.g. BL48X9K2AB',
    refPattern: /^[A-Z0-9]{8,12}$/,
    refError: 'Enter a valid bKash TrxID (8 to 12 letters and numbers).',
    instructions: 'Send money to our bKash number with your User ID as reference, then enter your bKash number and the TrxID below.',
  },
  nagad: {
    label: 'Nagad',
    group: 'mobile_wallet',
    currency: 'BDT',
    enabledKey: 'nagad_manual_enabled',
    accountKey: 'nagad_manual_number',
    accountTypeKey: 'nagad_manual_account_type',
    accountDefault: '',
    accountLabel: 'Nagad number',
    senderLabel: 'Your Nagad number (sender)',
    senderPlaceholder: '01XXXXXXXXX',
    senderPattern: BD_MOBILE,
    senderError: 'Enter the Nagad number you sent from, like 01712345678.',
    refLabel: 'Nagad TxnID',
    refPlaceholder: 'e.g. 7AB3C9D1',
    refPattern: /^[A-Z0-9]{6,20}$/,
    refError: 'Enter a valid Nagad TxnID (6 to 20 letters and numbers).',
    instructions: 'Send money to our Nagad number with your User ID as reference, then enter your Nagad number and the TxnID below.',
  },
  rocket: {
    label: 'Rocket',
    group: 'mobile_wallet',
    currency: 'BDT',
    enabledKey: 'rocket_manual_enabled',
    accountKey: 'rocket_manual_number',
    accountTypeKey: 'rocket_manual_account_type',
    accountDefault: '',
    accountLabel: 'Rocket number',
    senderLabel: 'Your Rocket number (sender)',
    senderPlaceholder: '01XXXXXXXXX(X)',
    senderPattern: /^01[3-9]\d{8,9}$/,
    senderError: 'Enter the Rocket number you sent from (11 or 12 digits).',
    refLabel: 'Rocket TxnID',
    refPlaceholder: 'e.g. 1234567890',
    refPattern: /^[A-Z0-9]{6,20}$/,
    refError: 'Enter a valid Rocket TxnID (6 to 20 letters and numbers).',
    instructions: 'Send money to our Rocket number with your User ID as reference, then enter your Rocket number and the TxnID below.',
  },
  binance_pay: {
    label: 'Binance Pay',
    group: 'crypto',
    currency: 'USD',
    enabledKey: 'binance_pay_manual_enabled',
    accountKey: 'binance_pay_manual_id',
    accountDefault: '',
    accountLabel: 'Binance Pay ID',
    senderLabel: 'Your Binance Pay ID',
    senderPlaceholder: 'e.g. 123456789',
    senderPattern: /^\d{6,12}$/,
    senderError: 'Enter your Binance Pay ID (6 to 12 digits).',
    refLabel: 'Binance Pay Order ID',
    refPlaceholder: 'e.g. 285930194857261056',
    refPattern: /^[A-Z0-9]{8,40}$/,
    refError: 'Enter the Order ID from your Binance Pay history.',
    instructions: 'Send the exact amount in USDT to our Binance Pay ID, then enter your Pay ID and the Order ID from Binance Pay history below.',
  },
  usdt_trc20: {
    label: 'USDT (TRC20)',
    group: 'crypto',
    currency: 'USD',
    enabledKey: 'usdt_trc20_manual_enabled',
    accountKey: 'usdt_trc20_manual_address',
    accountDefault: '',
    accountLabel: 'USDT (TRC20) address',
    senderLabel: 'Your sending wallet address',
    senderPlaceholder: 'T…',
    senderPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    senderError: 'Enter the TRC20 address you sent from (starts with T, 34 characters).',
    refLabel: 'Transaction hash (TxID)',
    refPlaceholder: '64 characters',
    refPattern: /^[A-F0-9]{64}$/,
    refError: 'Enter the 64-character transaction hash (TxID).',
    instructions: 'Send the exact amount in USDT on the TRON (TRC20) network only. Other networks are lost. Then enter your address and the TxID below.',
  },
};

export const isManualChannel = (v: unknown): v is ManualChannel => typeof v === 'string' && (MANUAL_CHANNELS as readonly string[]).includes(v);

/** "bKash", "Binance Pay"…, for deposits stored with providerAsset = channel. */
export function channelLabel(asset: string | null | undefined): string | null {
  if (!asset) return null;
  if (isManualChannel(asset)) return CHANNELS[asset].label;
  return { usdt: 'USDT' }[asset] ?? asset;
}
