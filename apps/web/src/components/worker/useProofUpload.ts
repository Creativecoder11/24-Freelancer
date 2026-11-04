'use client';
/**
 * Proof upload through the uploads API (Doc 06 §5.4): presign → PUT (XHR for progress) →
 * complete → poll until the background processing marks it `uploaded` (or `quarantined`).
 */
import { useCallback, useRef, useState } from 'react';
import type { UploadPurpose, UploadRecord } from '@24f/shared';
import { UPLOAD_RULES, formatBytesLimit } from '@24f/shared';
import type { UploadPhase } from '@24f/ui';
import { toast } from '@24f/ui';
import { api, ApiError } from '@/lib/api/client';

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  file: { filename: string; size_bytes: number; thumbnail_url?: string | null; url?: string | null } | null;
  uploadId: string | null;
  error: { title: string; body?: string } | null;
}

const EMPTY: UploadState = { phase: 'idle', progress: 0, file: null, uploadId: null, error: null };

function typeError(purpose: UploadPurpose) {
  const r = UPLOAD_RULES[purpose];
  return { title: `That file isn’t a ${r.typesLabel.replace(/, /g, ', ')}`, body: `Save it as ${r.typesLabel}, then try again.` };
}
function sizeError(purpose: UploadPurpose) {
  return { title: `That file is larger than ${formatBytesLimit(UPLOAD_RULES[purpose].maxBytes)}`, body: 'Compress it or crop to the part that shows the proof, then try again.' };
}
const QUARANTINE: Record<string, { title: string; body: string }> = {
  type_mismatch: { title: 'We couldn’t read that file', body: 'It doesn’t look like the file type it claims to be. Save it again and retry.' },
  decode_failed: { title: 'We couldn’t read that image', body: 'Save it again as PNG or JPG, then try again.' },
  too_large: { title: 'That file is too large', body: 'Compress it or crop to the part that shows the proof, then try again.' },
  malware: { title: 'We couldn’t accept that file', body: 'Try a different file.' },
};

function put(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'content-length') xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', 'Upload failed')));
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload failed'));
    signal.addEventListener('abort', () => {
      xhr.abort();
      reject(new DOMException('aborted', 'AbortError'));
    });
    xhr.send(file);
  });
}

export function useProofUpload(purpose: UploadPurpose, initial?: UploadRecord | null, onChange?: (uploadId: string | null) => void) {
  const [state, setState] = useState<UploadState>(() =>
    initial && initial.status === 'uploaded'
      ? { phase: 'uploaded', progress: 100, uploadId: initial.upload_id, error: null, file: { filename: initial.filename, size_bytes: initial.size_bytes, thumbnail_url: initial.thumbnail_url, url: initial.url } }
      : EMPTY,
  );
  const ctrl = useRef<AbortController | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  const reset = useCallback(() => {
    ctrl.current?.abort();
    setState(EMPTY);
    cb.current?.(null);
  }, []);

  const select = useCallback(
    async (file: File) => {
      const rule = UPLOAD_RULES[purpose];
      if (!rule.mimeTypes.includes(file.type)) return setState({ ...EMPTY, phase: 'error', error: typeError(purpose) });
      if (file.size > rule.maxBytes) return setState({ ...EMPTY, phase: 'error', error: sizeError(purpose) });
      ctrl.current?.abort();
      const ac = new AbortController();
      ctrl.current = ac;
      cb.current?.(null);
      setState({ phase: 'uploading', progress: 0, uploadId: null, error: null, file: { filename: file.name, size_bytes: file.size } });
      try {
        const p = await api.post<{ upload_id: string; url: string; headers: Record<string, string> }>('/uploads/presign', {
          purpose,
          filename: file.name,
          content_type: file.type,
          size_bytes: file.size,
        });
        await put(p.url, file, p.headers, (pct) => setState((s) => ({ ...s, progress: pct })), ac.signal);
        setState((s) => ({ ...s, phase: 'processing', progress: 100 }));
        let rec = await api.post<UploadRecord>(`/uploads/${p.upload_id}/complete`);
        for (let i = 0; i < 30 && rec.status === 'pending'; i++) {
          await new Promise((r) => setTimeout(r, i < 5 ? 400 : 1000));
          if (ac.signal.aborted) return;
          rec = await api.get<UploadRecord>(`/uploads/${p.upload_id}`);
        }
        if (ac.signal.aborted) return;
        if (rec.status !== 'uploaded') {
          setState({ ...EMPTY, phase: 'error', error: QUARANTINE[rec.rejection_reason ?? 'type_mismatch'] ?? QUARANTINE.type_mismatch! });
          return;
        }
        setState({ phase: 'uploaded', progress: 100, uploadId: rec.upload_id, error: null, file: { filename: rec.filename, size_bytes: rec.size_bytes, thumbnail_url: rec.thumbnail_url, url: rec.url } });
        cb.current?.(rec.upload_id);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (e instanceof ApiError && e.code === 'UPLOAD_TYPE_NOT_ALLOWED') return setState({ ...EMPTY, phase: 'error', error: typeError(purpose) });
        if (e instanceof ApiError && e.code === 'UPLOAD_TOO_LARGE') return setState({ ...EMPTY, phase: 'error', error: sizeError(purpose) });
        setState({ ...EMPTY, phase: 'error', error: { title: 'Upload failed', body: 'Your connection dropped. Try again — nothing was submitted.' } });
        toast.show({ tone: 'danger', title: 'Upload failed', body: 'Your connection dropped. Try again — nothing was submitted.' });
      }
    },
    [purpose],
  );

  return { state, select, reset };
}
