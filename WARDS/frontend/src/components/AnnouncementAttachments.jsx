import { useCallback, useMemo, useRef, useState } from 'react';

import { API_HOST } from '../services/api';

const FILE_HOST = (() => {
  try {
    const baseURL = (typeof window !== 'undefined' && window.__WARDS_API_HOST__) || API_HOST;
    return baseURL.replace(/\/$/, '');
  } catch (_) {
    return API_HOST;
  }
})();

const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'pdf',
];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const ANNOUNCEMENT_MAX_ATTACHMENTS = 10;

const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const buildAttachmentUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${FILE_HOST}${path.startsWith('/') ? '' : '/'}${path}`;
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const getExtension = (filename) => {
  const dot = (filename || '').lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

const getKindIcon = (filename, mime) => {
  const ext = getExtension(filename);
  if (mime?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['mp4', 'mov', 'webm'].includes(ext) || mime?.startsWith('video/')) return '🎬';
  if (ext === 'zip') return '🗜️';
  return '📎';
};

const isImageFile = (filename, mime) => {
  const ext = getExtension(filename);
  return (mime || '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
};

const validatePendingFile = (file) => {
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Unsupported file type: ${file.name}`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${file.name} exceeds the 25 MB size limit`;
  }
  return null;
};

/**
 * Editor used inside the create/edit modal.
 * Pending files (not yet uploaded) are kept in component state of the parent.
 * Existing attachments are attachments already saved on the announcement.
 */
export const AnnouncementAttachmentsField = ({
  existingAttachments = [],
  pendingFiles = [],
  onAddPending,
  onRemovePending,
  onDeleteExisting,
  disabled = false,
  uploadProgress = 0,
  isUploading = false,
}) => {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');

  const totalCount = existingAttachments.length + pendingFiles.length;

  const handleFiles = useCallback((fileList) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const errors = [];
    const valid = [];
    for (const file of incoming) {
      const validationError = validatePendingFile(file);
      if (validationError) {
        errors.push(validationError);
      } else {
        valid.push(file);
      }
    }

    const allowed = ANNOUNCEMENT_MAX_ATTACHMENTS - totalCount;
    if (allowed <= 0) {
      errors.push(`Maximum of ${ANNOUNCEMENT_MAX_ATTACHMENTS} attachments per announcement.`);
    } else if (valid.length > allowed) {
      errors.push(`Only the first ${allowed} additional file(s) can be added (limit is ${ANNOUNCEMENT_MAX_ATTACHMENTS}).`);
      valid.length = allowed;
    }

    if (valid.length > 0 && onAddPending) {
      onAddPending(valid);
    }
    setError(errors.join(' '));
  }, [onAddPending, totalCount]);

  const onInputChange = (event) => {
    handleFiles(event.target.files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setDragActive(true);
  };
  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };
  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    if (event.dataTransfer?.files) handleFiles(event.dataTransfer.files);
  };

  return (
    <div>
      <label className="block text-gray-700 font-semibold mb-2">
        Attachments
        <span className="ml-2 text-xs font-normal text-gray-500">
          ({totalCount}/{ANNOUNCEMENT_MAX_ATTACHMENTS})
        </span>
      </label>

      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`cursor-pointer rounded-xl border border-dashed px-4 py-4 text-center transition focus-within:ring-2 focus-within:ring-accent/40 ${
          dragActive ? 'border-accent bg-blue-50' : 'border-slate-300 bg-slate-50/60 hover:bg-slate-100'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
        <div className="flex items-center justify-center gap-2 text-sm text-slate-700">
          <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
          </svg>
          <span className="font-semibold">
            <span className="text-accent">Click to upload</span> <span className="text-slate-500 font-normal">or drag &amp; drop</span>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          PDF, PNG, JPEG &middot; up to 25 MB each
        </p>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>
      )}

      {isUploading && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Uploading attachments...</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
            />
          </div>
        </div>
      )}

      {(existingAttachments.length > 0 || pendingFiles.length > 0) && (
        <ul className="mt-3 space-y-1.5">
          {existingAttachments.map((att) => (
            <li
              key={`existing-${att.id}`}
              className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
            >
              <span className="text-base flex-shrink-0" aria-hidden>{getKindIcon(att.filename, att.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium text-slate-800" title={att.filename}>
                  {att.filename}
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatBytes(att.size)}
                  {att.uploaded_by ? ` · ${att.uploaded_by}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {att.preview_url && (
                  <a
                    href={buildAttachmentUrl(att.preview_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-accent transition"
                    title="Preview"
                    aria-label={`Preview ${att.filename}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                    </svg>
                  </a>
                )}
                <a
                  href={buildAttachmentUrl(att.download_url)}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary transition"
                  title="Download"
                  aria-label={`Download ${att.filename}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"></path>
                  </svg>
                </a>
                {onDeleteExisting && (
                  <button
                    type="button"
                    onClick={() => onDeleteExisting(att)}
                    disabled={disabled}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition"
                    title="Remove"
                    aria-label={`Remove ${att.filename}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
          {pendingFiles.map((file, index) => (
            <li
              key={`pending-${index}-${file.name}`}
              className="flex items-center gap-2.5 rounded-lg border border-dashed border-blue-200 bg-blue-50/70 px-2.5 py-1.5"
            >
              <span className="text-base flex-shrink-0" aria-hidden>{getKindIcon(file.name, file.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium text-slate-800" title={file.name}>
                  {file.name}
                </p>
                <p className="text-[11px] text-blue-700">{formatBytes(file.size)} &middot; pending upload</p>
              </div>
              {onRemovePending && (
                <button
                  type="button"
                  onClick={() => onRemovePending(index)}
                  disabled={disabled}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition flex-shrink-0"
                  title="Remove"
                  aria-label={`Remove ${file.name}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * Read-only list of attachments rendered on the announcement card.
 * Shows inline image thumbnails when applicable.
 */
export const AnnouncementAttachmentsList = ({ attachments = [] }) => {
  const items = useMemo(() => attachments || [], [attachments]);
  if (items.length === 0) return null;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="mb-2 text-sm font-semibold text-gray-700 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
        </svg>
        Attachments ({items.length})
      </p>
      <ul className="space-y-2">
        {items.map((att) => {
          const isImage = isImageFile(att.filename, att.mime_type);
          return (
            <li
              key={att.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
            >
              {isImage && att.preview_url ? (
                <a
                  href={buildAttachmentUrl(att.preview_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0"
                >
                  <img
                    src={buildAttachmentUrl(att.preview_url)}
                    alt={att.filename}
                    className="h-12 w-12 rounded object-cover border border-gray-200"
                    loading="lazy"
                  />
                </a>
              ) : (
                <span className="text-2xl" aria-hidden>{getKindIcon(att.filename, att.mime_type)}</span>
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-800" title={att.filename}>
                  {att.filename}
                </p>
                <p className="text-xs text-gray-500">{formatBytes(att.size)}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {att.preview_url && (
                  <a
                    href={buildAttachmentUrl(att.preview_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-accent hover:text-blue-700"
                  >
                    View
                  </a>
                )}
                <a
                  href={buildAttachmentUrl(att.download_url)}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-900"
                >
                  Download
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AnnouncementAttachmentsField;
