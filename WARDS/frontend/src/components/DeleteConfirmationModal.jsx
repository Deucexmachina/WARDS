const DeleteConfirmationModal = ({
  open,
  title = 'Delete this item?',
  message = 'This action cannot be undone.',
  details = [],
  confirmLabel = 'Confirm Delete',
  cancelLabel = 'Cancel',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Confirm Deletion</p>
            <h3 className="mt-2 text-2xl font-bold text-primary">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        {details.length > 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="space-y-3">
              {details.map((detail) => (
                <div key={`${detail.label}-${detail.value || 'empty'}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{detail.label}</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{detail.value || 'N/A'}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition duration-300 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;
