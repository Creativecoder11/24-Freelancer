/**
 * Sign-in identifiers (Doc 04 §3.1, VR-003, VR-004, A-52).
 * Email is lower-cased and trimmed. BD mobile is normalised to E.164 "+8801XXXXXXXXX".
 */

export const BD_MOBILE_LOCAL_RE = /^01[3-9][0-9]{8}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NormalisedIdentifier =
  | { kind: 'email'; value: string; email: string; phone: null }
  | { kind: 'phone'; value: string; email: null; phone: string };

/** Strips spaces and dashes and converts +880 / 880 prefixes to the local 01… form. */
export function toLocalBdMobile(raw: string): string {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+880')) d = `0${d.slice(4)}`;
  else if (d.startsWith('880')) d = `0${d.slice(3)}`;
  return d;
}

export function isBdMobile(raw: string): boolean {
  return BD_MOBILE_LOCAL_RE.test(toLocalBdMobile(raw));
}

export function toE164Bd(raw: string): string {
  return `+88${toLocalBdMobile(raw)}`;
}

/** Returns null when the value is neither a valid email nor a BD mobile number. */
export function normaliseIdentifier(raw: string): NormalisedIdentifier | null {
  const v = raw.trim();
  if (v.includes('@')) {
    const email = v.toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return null;
    return { kind: 'email', value: email, email, phone: null };
  }
  if (!isBdMobile(v)) return null;
  const phone = toE164Bd(v);
  return { kind: 'phone', value: phone, email: null, phone };
}

/** VR-003 field message: the Figma copy when the domain has no dot. */
export function emailErrorMessage(raw: string): string {
  const at = raw.lastIndexOf('@');
  if (at > 0 && !raw.slice(at + 1).includes('.')) return 'Check the email — it’s missing a “.” before the domain.';
  return 'Enter a valid email address.';
}
