import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * Upload content checks (Doc 04 §6.5 UP-3): magic bytes, re-encode without metadata,
 * 400 px WebP thumbnail, SHA-256 and a 64-bit DCT perceptual hash (A-26).
 */

export type Sniffed = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'zip' | 'text' | null;

export function sniff(buf: Buffer): Sniffed {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (!buf.subarray(0, 8192).includes(0)) return 'text';
  return null;
}

/** Whether the sniffed type is acceptable for the declared MIME type. */
export function sniffMatches(declared: string, sniffed: Sniffed): boolean {
  switch (declared) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'application/pdf':
      return sniffed === declared;
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return sniffed === 'zip';
    case 'text/plain':
    case 'text/csv':
      return sniffed === 'text';
    default:
      return false;
  }
}

export interface ProcessedImage {
  data: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: Buffer;
  phash: bigint;
}

const N = 32;
const COS: number[][] = Array.from({ length: N }, (_, k) => Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))));

/** 64-bit pHash: 32×32 greyscale → 2D DCT-II → top-left 8×8 → bit = value > median (DC excluded). Signed for bigint columns. */
export async function perceptualHash(input: Buffer): Promise<bigint> {
  const px = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer();
  const rows: number[][] = [];
  for (let y = 0; y < N; y++) {
    const row: number[] = [];
    for (let k = 0; k < 8; k++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += px[y * N + x]! * COS[k]![x]!;
      row.push(s);
    }
    rows.push(row);
  }
  const coeffs: number[] = [];
  for (let k = 0; k < 8; k++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y]![u]! * COS[k]![y]!;
      coeffs.push(s);
    }
  }
  const sorted = coeffs.slice(1).sort((a, b) => a - b);
  const median = (sorted[31]! + sorted[32]!) / 2;
  let v = 0n;
  for (const c of coeffs) v = (v << 1n) | (c > median ? 1n : 0n);
  return BigInt.asIntN(64, v);
}

export async function processImage(input: Buffer, mime: 'image/png' | 'image/jpeg' | 'image/webp'): Promise<ProcessedImage> {
  const base = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
  const encoded =
    mime === 'image/png'
      ? base.png({ compressionLevel: 9, adaptiveFiltering: true })
      : mime === 'image/jpeg'
        ? base.jpeg({ quality: 90, mozjpeg: true })
        : base.webp({ quality: 90 });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  const thumb = await sharp(data).resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return {
    data,
    thumb,
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest(),
    phash: await perceptualHash(data),
  };
}
