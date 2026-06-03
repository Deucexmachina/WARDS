const toneStyles = {
  danger: {
    eyebrow: 'Confirm Action',
    iconClass: 'bg-rose-100 text-rose-600',
    confirmClass: 'bg-rose-600 hover:bg-rose-700 text-white',
  },
  primary: {
    eyebrow: 'Please Confirm',
    iconClass: 'bg-[#dbeafe] text-[#0f5b83]',
    confirmClass: 'bg-[#0f5b83] hover:bg-[#0c4d6f] text-white',
  },
};

const ActionConfirmationModal = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isLoading = false,
  loadingLabel = 'Processing...',
  tone = 'danger',
  onConfirm,
  onCancel,
}) => {
  if (!open) {
    return null;
  }

  const styles = toneStyles[tone] || toneStyles.danger;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${styles.iconClass}`}>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{styles.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-2xl px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${styles.confirmClass}`}
          >
            {isLoading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionConfirmationModal;
