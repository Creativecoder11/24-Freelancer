import { createHash } from 'node:crypto';
import { localBdDigits, maskCrypto, type PayoutMethodType } from '@24f/shared';

/** Account normalisation, validation and masking per method (Doc 08 §6.4.2, Canonical §5). */

export const ACCOUNT_ERROR: Record<PayoutMethodType, string> = {
  bkash: 'Enter an 11-digit bKash personal number, like 01712345569.',
  nagad: 'Enter an 11-digit Nagad personal number, like 01512345105.',
  rocket: 'Enter your 11-digit Rocket number (or 12-digit Rocket account).',
  usdt_trc20: 'Enter a valid TRON (TRC20) address. It starts with T and has 34 characters.',
};

export function normaliseAccount(method: PayoutMethodType, raw: string): string {
  const v = raw.trim();
  if (method === 'usdt_trc20') return v;
  const d = v.replace(/[\s-]/g, '');
  return d.startsWith('+') || d.startsWith('880') ? localBdDigits(d) : d.replace(/\D/g, '');
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58Check decode for TRON addresses: 25 bytes, 0x41 prefix, double-SHA256 checksum. */
export function tronChecksumValid(addr: string): boolean {
  let n = 0n;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== 25 || bytes[0] !== 0x41) return false;
  const body = bytes.subarray(0, 21);
  const sum = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  return sum.equals(bytes.subarray(21));
}

export function accountValid(method: PayoutMethodType, normalised: string, regex?: string | null): boolean {
  switch (method) {
    case 'bkash':
    case 'nagad':
      return /^01[3-9]\d{8}$/.test(normalised);
    case 'rocket':
      return /^01[3-9]\d{8}\d?$/.test(normalised);
    case 'usdt_trc20':
      return (regex ? new RegExp(regex).test(normalised) : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(normalised)) && tronChecksumValid(normalised);
    default:
      return false;
  }
}

/** Stored mask: "017••• ••569" for wallets, "T9x…k2a" for crypto. */
export function maskAccount(method: PayoutMethodType, normalised: string): string {
  if (method === 'usdt_trc20') return maskCrypto(normalised);
  return `${normalised.slice(0, 3)}••• ••${normalised.slice(-3)}`;
}

export function last3(normalised: string): string {
  return normalised.slice(-3);
}

/** Wallet-card form "017••• ••569" from any stored mask. */
export function maskFull(masked: string): string {
  const m = /^(\d{3})•••\s?(?:••)?(\w{3})$/.exec(masked);
  return m ? `${m[1]}••• ••${m[2]}` : masked;
}

/** History form "017•••569". */
export function maskTight(masked: string): string {
  return masked.replace('••• ••', '•••');
}

export const METHOD_SHORT: Record<PayoutMethodType, string> = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', usdt_trc20: 'USDT TRC20' };

/** "bKash ••569" (lists) or "USDT TRC20 · T9x…k2a" (Doc 08 §4.3). */
export function destinationLabel(method: PayoutMethodType, masked: string, l3: string): string {
  if (method === 'usdt_trc20') return `USDT TRC20 · ${masked}`;
  return `${METHOD_SHORT[method]} ••${l3}`;
}

/** "bKash · Personal", "USDT · TRC20". */
export function methodLabel(method: PayoutMethodType, display: string, accountLabel: string | null): string {
  return `${display} · ${accountLabel ?? (method === 'usdt_trc20' ? 'TRC20' : 'Personal')}`;
}
