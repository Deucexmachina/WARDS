const isInlineFramePreview = (previewType) => previewType === 'pdf' || previewType === 'text';

const FileViewerModal = ({
  open,
  title,
  fileUrl,
  previewType,
  isLoading = false,
  errorMessage = '',
  onClose,
  onDownload,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/70 px-4 py-5">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.34)]">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">File Viewer</p>
            <h2 className="mt-2 truncate text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              type="button"
              onClick={onDownload}
              disabled={!fileUrl || isLoading}
              className="rounded-2xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl bg-[#0f5b83] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-[420px] flex-1 overflow-auto bg-slate-100 p-4 sm:p-6">
          {isLoading ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-[26px] border border-slate-200 bg-white text-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#0f5b83] border-t-transparent" />
              <p className="mt-4 text-sm font-medium text-slate-600">Loading file preview...</p>
            </div>
          ) : errorMessage ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-[26px] border border-rose-200 bg-rose-50 px-6 text-center">
              <p className="text-lg font-semibold text-rose-700">Preview unavailable</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-rose-600">{errorMessage}</p>
            </div>
          ) : previewType === 'image' && fileUrl ? (
            <div className="flex min-h-[360px] items-start justify-center rounded-[26px] border border-slate-200 bg-white p-4">
              <img src={fileUrl} alt={title} className="h-auto max-w-full rounded-2xl object-contain shadow-sm" />
            </div>
          ) : isInlineFramePreview(previewType) && fileUrl ? (
            <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white">
              <iframe src={fileUrl} title={title} className="h-[68vh] w-full" />
            </div>
          ) : (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-[26px] border border-slate-200 bg-white px-6 text-center">
              <p className="text-lg font-semibold text-slate-900">Preview unavailable for this file type</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                This file cannot be previewed directly in the browser. Use the download button to open it in the appropriate application.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileViewerModal;
