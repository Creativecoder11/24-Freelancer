import type { UploadPurpose } from './enums';

/**
 * Allowed upload types and limits per purpose (Doc 06 §5.4, Doc 04 §6.5; binding A-37, A-38).
 */
export interface UploadRule {
  readonly mimeTypes: readonly string[];
  readonly maxBytes: number;
  /** For `<input accept>`. */
  readonly accept: string;
  /** Human list for messages: "PNG or JPG". */
  readonly typesLabel: string;
  /** Images get re-encoded, thumbnailed and pHashed. */
  readonly image: boolean;
}

const MB = 1024 * 1024;

const PNG = 'image/png';
const JPG = 'image/jpeg';
const WEBP = 'image/webp';
const PDF = 'application/pdf';
const TXT = 'text/plain';
const CSV = 'text/csv';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const IMAGE_MIME_TYPES = [PNG, JPG, WEBP] as const;

function rule(mimeTypes: string[], maxBytes: number, typesLabel: string, image: boolean): UploadRule {
  return Object.freeze({ mimeTypes, maxBytes, accept: mimeTypes.join(','), typesLabel, image });
}

export const UPLOAD_RULES: Readonly<Record<UploadPurpose, UploadRule>> = Object.freeze({
  proof_screenshot: rule([PNG, JPG], 5 * MB, 'PNG or JPG', true),
  proof_file: rule([PDF, PNG, JPG, TXT, CSV, XLSX, DOCX], 10 * MB, 'PDF, PNG, JPG, TXT, CSV, XLSX or DOCX', false),
  kyc_document: rule([JPG, PNG, PDF], 10 * MB, 'JPG, PNG or PDF', false),
  kyc_selfie: rule([JPG, PNG], 10 * MB, 'JPG or PNG', true),
  avatar: rule([PNG, JPG, WEBP], 2 * MB, 'PNG, JPG or WebP', true),
  employer_logo: rule([PNG, JPG, WEBP], 2 * MB, 'PNG, JPG or WebP', true),
  cms_image: rule([PNG, JPG, WEBP], 5 * MB, 'PNG, JPG or WebP', true),
});

/** User-facing purposes (cms_image is admin only). */
export const USER_UPLOAD_PURPOSES = [
  'proof_screenshot',
  'proof_file',
  'kyc_document',
  'kyc_selfie',
  'avatar',
  'employer_logo',
] as const satisfies readonly UploadPurpose[];

export function formatBytesLimit(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** "Use a PNG or JPG image." style message for UPLOAD_TYPE_NOT_ALLOWED. */
export function uploadTypeMessage(purpose: UploadPurpose): string {
  const r = UPLOAD_RULES[purpose];
  return r.image ? `Use a ${r.typesLabel} image.` : `Use a ${r.typesLabel} file.`;
}

/** "That file is larger than 5 MB" (Figma copy) for UPLOAD_TOO_LARGE. */
export function uploadTooLargeMessage(purpose: UploadPurpose): string {
  return `That file is larger than ${formatBytesLimit(UPLOAD_RULES[purpose].maxBytes)}`;
}
