/**
 * Manual deposit rails (CR-2026-11b): the employer sends money to our account, then submits their
 * sending account and the transaction reference. The deposit waits as `pending` until an admin
 * checks the reference and approves it (Admin → Deposits). No gateway API is involved.
 *
 * A rail shows on Add funds only when its group is in `deposit_methods_enabled`, its
 * `*_manual_enabled` setting is on and its receiving account is filled in. Admins set all three
 * per rail in Admin → Settings → Deposit methods.
 */
export const MANUAL_CHANNELS = ['bkash', 'nagad', 'rocket', 'binance_pay', 'usdt_trc20', 'usdt_bep20', 'usdt_erc20'] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

/** Receiving account types an admin can pick for bKash / Nagad / Rocket. Shown to employers as is. */
export const ACCOUNT_TYPES = ['Personal number', 'Merchant number'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Stored account type → one of ACCOUNT_TYPES (older free-text values like "Personal (Send Money)" map by keyword). */
export function accountTypeOf(raw: unknown): AccountType {
  return /merchant/i.test(String(raw ?? '')) ? 'Merchant number' : 'Personal number';
}

export interface ManualChannelDef {
  label: string;
  /** deposits.method stored for this rail. */
  group: 'mobile_wallet' | 'crypto';
  /** What the employer pays in: BDT at the deposit rate, or USD 1:1 (USDT). */
  currency: 'BDT' | 'USD';
  enabledKey: string;
  accountKey: string;
  accountTypeKey?: string;
  /** Admin-editable text shown above the form; empty falls back to `instructions`. */
  instructionsKey: string;
  /** Fallback receiving account when the setting is missing (bKash kept its launch default). */
  accountDefault: string;
  accountLabel: string;
  /** Format the receiving account must match when an admin saves it. */
  accountPattern: RegExp;
  accountError: string;
  /** Second line on the Add funds tile and the admin card. */
  subtitle: string;
  senderLabel: string;
  senderPlaceholder: string;
  senderPattern: RegExp;
  senderError: string;
  refLabel: string;
  refPlaceholder: string;
  /** Checked after trim + upper case (and dropping a leading 0X when `refStrip0x`). */
  refPattern: RegExp;
  /** EVM hashes are stored without their 0x so the same hash can't be submitted twice. */
  refStrip0x?: boolean;
  refError: string;
  instructions: string;
}

const BD_MOBILE = /^01[3-9]\d{8}$/;
const BD_MOBILE_ROCKET = /^01[3-9]\d{8,9}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** EVM tx hash after upper-casing and dropping its 0x. */
const EVM_TX = /^[A-F0-9]{64}$/;

export const CHANNELS: Record<ManualChannel, ManualChannelDef> = {
  bkash: {
    instructionsKey: 'bkash_manual_instructions',
    accountPattern: BD_MOBILE,
    accountError: 'Enter an 11-digit bKash number, like 01712345678.',
    subtitle: 'Mobile wallet',
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
    instructionsKey: 'nagad_manual_instructions',
    accountPattern: BD_MOBILE,
    accountError: 'Enter an 11-digit Nagad number, like 01712345678.',
    subtitle: 'Mobile wallet',
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
    instructionsKey: 'rocket_manual_instructions',
    accountPattern: BD_MOBILE_ROCKET,
    accountError: 'Enter a Rocket number (11 or 12 digits).',
    subtitle: 'Mobile wallet',
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
    senderPattern: BD_MOBILE_ROCKET,
    senderError: 'Enter the Rocket number you sent from (11 or 12 digits).',
    refLabel: 'Rocket TxnID',
    refPlaceholder: 'e.g. 1234567890',
    refPattern: /^[A-Z0-9]{6,20}$/,
    refError: 'Enter a valid Rocket TxnID (6 to 20 letters and numbers).',
    instructions: 'Send money to our Rocket number with your User ID as reference, then enter your Rocket number and the TxnID below.',
  },
  binance_pay: {
    instructionsKey: 'binance_pay_manual_instructions',
    accountPattern: /^\d{6,12}$/,
    accountError: 'Enter a Binance Pay ID (6 to 12 digits).',
    subtitle: 'Pay in USDT',
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
    instructionsKey: 'usdt_trc20_manual_instructions',
    accountPattern: TRON_ADDRESS,
    accountError: 'Enter a TRC20 address (starts with T, 34 characters).',
    subtitle: 'TRON network',
    label: 'USDT (TRC20)',
    group: 'crypto',
    currency: 'USD',
    enabledKey: 'usdt_trc20_manual_enabled',
    accountKey: 'usdt_trc20_manual_address',
    accountDefault: '',
    accountLabel: 'USDT (TRC20) address',
    senderLabel: 'Your sending wallet address',
    senderPlaceholder: 'T…',
    senderPattern: TRON_ADDRESS,
    senderError: 'Enter the TRC20 address you sent from (starts with T, 34 characters).',
    refLabel: 'Transaction hash (TxID)',
    refPlaceholder: '64 characters',
    refPattern: /^[A-F0-9]{64}$/,
    refError: 'Enter the 64-character transaction hash (TxID).',
    instructions: 'Send the exact amount in USDT on the TRON (TRC20) network only. Other networks are lost. Then enter your address and the TxID below.',
  },
  usdt_bep20: {
    label: 'USDT (BEP20)',
    group: 'crypto',
    currency: 'USD',
    enabledKey: 'usdt_bep20_manual_enabled',
    accountKey: 'usdt_bep20_manual_address',
    instructionsKey: 'usdt_bep20_manual_instructions',
    accountDefault: '',
    accountLabel: 'USDT (BEP20) address',
    accountPattern: EVM_ADDRESS,
    accountError: 'Enter a BEP20 address (0x followed by 40 letters and numbers).',
    subtitle: 'BNB Smart Chain',
    senderLabel: 'Your sending wallet address',
    senderPlaceholder: '0x…',
    senderPattern: EVM_ADDRESS,
    senderError: 'Enter the BEP20 address you sent from (starts with 0x, 42 characters).',
    refLabel: 'Transaction hash (TxID)',
    refPlaceholder: '0x… (66 characters)',
    refPattern: EVM_TX,
    refStrip0x: true,
    refError: 'Enter the transaction hash (0x followed by 64 characters).',
    instructions: 'Send the exact amount in USDT on BNB Smart Chain (BEP20) only. Other networks are lost. Then enter your address and the TxID below.',
  },
  usdt_erc20: {
    label: 'USDT (ERC20)',
    group: 'crypto',
    currency: 'USD',
    enabledKey: 'usdt_erc20_manual_enabled',
    accountKey: 'usdt_erc20_manual_address',
    instructionsKey: 'usdt_erc20_manual_instructions',
    accountDefault: '',
    accountLabel: 'USDT (ERC20) address',
    accountPattern: EVM_ADDRESS,
    accountError: 'Enter an ERC20 address (0x followed by 40 letters and numbers).',
    subtitle: 'Ethereum network',
    senderLabel: 'Your sending wallet address',
    senderPlaceholder: '0x…',
    senderPattern: EVM_ADDRESS,
    senderError: 'Enter the ERC20 address you sent from (starts with 0x, 42 characters).',
    refLabel: 'Transaction hash (TxID)',
    refPlaceholder: '0x… (66 characters)',
    refPattern: EVM_TX,
    refStrip0x: true,
    refError: 'Enter the transaction hash (0x followed by 64 characters).',
    instructions: 'Send the exact amount in USDT on the Ethereum (ERC20) network only. Other networks are lost. Network fees are yours. Then enter your address and the TxID below.',
  },
};

/** The reference as stored and checked: trimmed, upper case, EVM hashes without 0x. */
export function normalizeRef(def: ManualChannelDef, raw: unknown): string {
  const v = String(raw ?? '').trim().toUpperCase();
  return def.refStrip0x ? v.replace(/^0X/, '') : v;
}

export const isManualChannel = (v: unknown): v is ManualChannel => typeof v === 'string' && (MANUAL_CHANNELS as readonly string[]).includes(v);

/** "bKash", "Binance Pay"…, for deposits stored with providerAsset = channel. */
export function channelLabel(asset: string | null | undefined): string | null {
  if (!asset) return null;
  if (isManualChannel(asset)) return CHANNELS[asset].label;
  return { usdt: 'USDT' }[asset] ?? asset;
}
