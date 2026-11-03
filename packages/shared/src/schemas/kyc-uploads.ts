import { z } from 'zod';
import { USER_UPLOAD_PURPOSES } from '../uploads';
import { lengthBetween, uuid } from './common';

/** POST /uploads/presign (Doc 06 §5.4). Type and size are checked against the purpose by the API. */
export const presignSchema = z.object({
  purpose: z.enum(USER_UPLOAD_PURPOSES as unknown as [string, ...string[]], {
    errorMap: () => ({ message: 'Choose what this file is for.' }),
  }),
  filename: z
    .string({ required_error: 'Choose a file.' })
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1 && s.length <= 255, { message: 'The file name must be 255 characters or fewer.' }),
  content_type: z.string({ required_error: 'Choose a file.' }).min(3).max(100),
  size_bytes: z
    .number({ required_error: 'Choose a file.', invalid_type_error: 'Choose a file.' })
    .int()
    .positive('That file is empty.'),
});
export type PresignInput = z.input<typeof presignSchema>;

function ageAtLeast(dateIso: string, years: number, now = new Date()): boolean {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return d.getTime() <= cutoff.getTime();
}

/** Document number formats (VR-065). */
export function documentNumberValid(type: string, raw: string): boolean {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  switch (type) {
    case 'national_id':
      return /^(\d{10}|\d{13}|\d{17})$/.test(v);
    case 'passport':
      return /^[A-Z]{1,2}\d{7}$/.test(v);
    case 'driving_licence':
      return /^[A-Z0-9]{8,16}$/.test(v);
    default:
      return false;
  }
}

/** POST /me/kyc (VR-063…VR-069). */
export const kycSubmitSchema = z
  .object({
    document_type: z.enum(['national_id', 'passport', 'driving_licence'], {
      errorMap: () => ({ message: 'Choose a document type.' }),
    }),
    name_on_document: lengthBetween(2, 80, 'Enter your name exactly as it appears on the document.'),
    document_number: z.string({ required_error: 'Check the document number.' }).transform((s) => s.replace(/[\s-]/g, '').toUpperCase()),
    date_of_birth: z
      .string({ required_error: 'You must be 18 or older to verify.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth.')
      .refine((d) => ageAtLeast(d, 18), { message: 'You must be 18 or older to verify.' }),
    front_upload_id: uuid('Upload a clear photo of the front, under 10 MB.'),
    back_upload_id: uuid('Upload a clear photo of the back, under 10 MB.').nullable().optional(),
    selfie_upload_id: uuid('Upload a selfie holding your document.'),
  })
  .superRefine((v, ctx) => {
    if (!documentNumberValid(v.document_type, v.document_number))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['document_number'], message: 'Check the document number.' });
    if (v.document_type !== 'passport' && !v.back_upload_id)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['back_upload_id'], message: 'Upload a clear photo of the back, under 10 MB.' });
  });
export type KycSubmitInput = z.input<typeof kycSubmitSchema>;
