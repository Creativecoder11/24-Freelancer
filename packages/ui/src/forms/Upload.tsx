'use client';
import { useId, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Icon } from '../utils/icons';
import { LinkButton } from '../primitives/Link';

export type UploadPurpose = 'proof_screenshot' | 'proof_file' | 'kyc_document' | 'kyc_selfie' | 'avatar' | 'employer_logo';
export type UploadPhase = 'idle' | 'dragging' | 'uploading' | 'processing' | 'uploaded' | 'error';

export interface UploadProps {
  label: string;
  /** From UPLOAD_RULES[purpose], e.g. "image/png,image/jpeg". */
  accept: string;
  maxBytes: number;
  phase: UploadPhase;
  /** 0–100 while uploading. */
  progress?: number;
  file?: { filename: string; size_bytes: number; thumbnail_url?: string | null } | null;
  error?: { title: string; body?: string } | null;
  onSelect: (file: File) => void;
  /** Cancels while uploading. */
  onRemove?: () => void;
  title?: string;
  helper?: string;
  capture?: 'user' | 'environment';
  /** Copy overrides. */
  copy?: { browse?: string; drop?: string; replace?: string; uploaded?: string; uploading?: (pct: number) => string; processing?: string };
  labelHidden?: boolean;
  className?: string;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(Math.floor((n / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * Upload drop zone (Doc 02 §5.17): 168 high, radius 14, 1.5 px border. Presentational:
 * the parent's useUpload() owns phase/progress. Drag state is tracked locally when phase is idle.
 */
export function Upload({
  label,
  accept,
  phase,
  progress = 0,
  file,
  error,
  onSelect,
  onRemove,
  title = 'Drag your screenshot here or browse',
  helper = 'PNG or JPG · up to 5 MB · one file',
  capture,
  copy = {},
  labelHidden,
  className,
}: UploadProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const shownPhase: UploadPhase = phase === 'idle' && dragOver ? 'dragging' : phase;
  const hasFile = (shownPhase === 'uploaded' || shownPhase === 'uploading' || shownPhase === 'processing') && file;

  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onSelect(f);
    },
  };

  const input = (
    <input
      ref={inputRef}
      id={id}
      type="file"
      accept={accept}
      capture={capture}
      className="sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onSelect(f);
        e.target.value = '';
      }}
    />
  );

  const statusText =
    shownPhase === 'uploading'
      ? (copy.uploading ?? ((p: number) => `Uploading… ${p}%`))(Math.round(progress))
      : shownPhase === 'processing'
        ? copy.processing ?? 'Checking file…'
        : `${file ? formatBytes(file.size_bytes) : ''} · ${copy.uploaded ?? 'Uploaded'}`;

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <span className={cn('text-label-md text-fg', labelHidden && 'sr-only')} id={`${id}-label`}>
        {label}
      </span>
      {hasFile ? (
        <div className="rounded-[14px] border-[1.5px] border-solid border-line-strong bg-subtle p-3" {...dropHandlers}>
          {input}
          <div className="flex h-20 items-center gap-4 rounded-[12px] border border-line bg-surface px-3">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-muted text-fg-secondary">
              {file.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.thumbnail_url} alt={file.filename} className="size-full object-cover" />
              ) : (
                <Icon name="image" size={24} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label-md text-fg">{file.filename}</span>
              <span aria-live="polite" className={cn('mt-0.5 flex items-center gap-1 text-body-sm', shownPhase === 'uploaded' ? 'text-fg-success' : 'text-fg-tertiary')}>
                {shownPhase === 'uploaded' ? <Icon name="check-circle" size={16} /> : null}
                {statusText}
              </span>
              {shownPhase === 'uploading' ? (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-[2px] bg-muted" aria-hidden>
                  <span className="block h-full rounded-[2px] bg-brand transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
                </span>
              ) : null}
            </span>
            {onRemove ? (
              <button
                type="button"
                aria-label={shownPhase === 'uploading' ? 'Cancel upload' : `Remove ${file.filename}`}
                onClick={onRemove}
                className="relative inline-flex size-8 items-center justify-center rounded-[8px] text-fg-secondary hover:bg-muted focus-visible:shadow-focus before:absolute before:-inset-1.5 before:content-['']"
              >
                <Icon name="x" size={20} />
              </button>
            ) : null}
          </div>
          {shownPhase === 'uploaded' ? (
            <LinkButton className="mt-2 text-label-sm font-semibold" onClick={() => inputRef.current?.click()}>
              {copy.replace ?? 'Replace file'}
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <label
          htmlFor={id}
          {...dropHandlers}
          className={cn(
            'flex min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-[14px] border-[1.5px] border-dashed px-6 py-6 text-center transition-colors duration-[120ms]',
            'focus-within:shadow-focus',
            shownPhase === 'dragging' && 'border-line-brand bg-brand-subtle',
            shownPhase === 'error' && 'border-line-danger bg-danger-subtle',
            shownPhase === 'idle' && 'border-line-strong bg-subtle hover:border-line-brand',
          )}
        >
          {input}
          <span
            aria-hidden
            className={cn(
              'flex size-12 items-center justify-center rounded-full',
              shownPhase === 'dragging' ? 'bg-surface text-fg-brand' : shownPhase === 'error' ? 'bg-surface text-fg-danger' : 'bg-brand-subtle text-fg-brand',
            )}
          >
            <Icon name={shownPhase === 'error' ? 'alert-circle' : 'upload'} size={24} />
          </span>
          <span aria-live="polite" className="mt-3 flex flex-col items-center">
            {shownPhase === 'error' && error ? (
              <>
                <span className="text-label-md text-fg-danger">{error.title}</span>
                {error.body ? <span className="mt-1 text-body-xs text-fg-danger">{error.body}</span> : null}
              </>
            ) : shownPhase === 'dragging' ? (
              <>
                <span className="text-label-md text-fg">{copy.drop ?? 'Drop to upload'}</span>
                <span className="mt-1 text-body-xs text-fg-tertiary">{helper}</span>
              </>
            ) : (
              <>
                <span className="text-label-md text-fg">{title}</span>
                <span className="mt-1 text-body-xs text-fg-tertiary">{helper}</span>
              </>
            )}
          </span>
        </label>
      )}
    </div>
  );
}
