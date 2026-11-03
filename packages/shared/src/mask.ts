/**
 * Masking (Canonical §5, Doc 04 §4.5). The API masks everything it sends to another
 * party; the web uses these only for values the user has just typed.
 */

/** Worker name shown to employers and referrers: "Rakibun Hasan" → "Ra***n" (first name only). */
export function maskName(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  const chars = [...first];
  if (chars.length === 0) return 'Wo***r';
  if (chars.length <= 2) return `${chars[0]}***`;
  if (chars.length === 3) return `${chars[0]}***${chars[2]}`;
  return `${chars[0]}${chars[1]}***${chars[chars.length - 1]}`;
}

/** Initials for avatars: "Nusrat Jahan" → "NJ", "Shelfwise Ltd." → "SL". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : ([...words[0]!][1] ?? '');
  return (first + last).toUpperCase();
}

/** Converts "+8801712345569", "8801712345569" or "01712345569" to the 11-digit local form. */
export function localBdDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('880') ? `0${d.slice(3)}` : d;
}

/** Auth screens: "+880 17•• ••• 569". */
export function maskPhoneAuth(phone: string): string {
  const d = localBdDigits(phone);
  return `+880 ${d.slice(1, 3)}•• ••• ${d.slice(-3)}`;
}

/** Wallet: "017••• ••569" (full) or "017•••569" (tight, history rows). */
export function maskPhoneWallet(phone: string, style: 'full' | 'tight' = 'full'): string {
  const d = localBdDigits(phone);
  return style === 'tight' ? `${d.slice(0, 3)}•••${d.slice(-3)}` : `${d.slice(0, 3)}••• ••${d.slice(-3)}`;
}

/** "bKash ••569". */
export function maskMethodShort(methodLabel: string, last3: string): string {
  return `${methodLabel} ••${last3}`;
}

/** Crypto address: "T9x…k2a". */
export function maskCrypto(address: string): string {
  return `${address.slice(0, 3)}…${address.slice(-3)}`;
}

/** Email: "nusrat.j@example.com" → "nu•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  return `${[...local].slice(0, 2).join('')}•••${email.slice(at)}`;
}

/** Masks an identifier for display after sign-up or forgot-password. */
export function maskIdentifier(identifier: string): string {
  return identifier.includes('@') ? maskEmail(identifier) : maskPhoneAuth(identifier);
}
