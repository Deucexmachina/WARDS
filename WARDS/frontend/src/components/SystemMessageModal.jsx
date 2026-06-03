const toneStyles = {
  error: {
    eyebrow: 'Action Needed',
    iconClass: 'bg-rose-100 text-rose-600',
    buttonClass: 'bg-rose-600 hover:bg-rose-700 text-white',
    path: 'M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z',
  },
  warning: {
    eyebrow: 'Please Review',
    iconClass: 'bg-amber-100 text-amber-600',
    buttonClass: 'bg-amber-500 hover:bg-amber-600 text-white',
    path: 'M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  },
  success: {
    eyebrow: 'Success',
    iconClass: 'bg-emerald-100 text-emerald-600',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    path: 'm4.5 12.75 6 6 9-13.5',
  },
  info: {
    eyebrow: 'Notice',
    iconClass: 'bg-sky-100 text-sky-700',
    buttonClass: 'bg-[#0f5b83] hover:bg-[#0c4d6f] text-white',
    path: 'M11.25 11.25h.75v5.25m-.75-9h.008v.008h-.008z M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  },
};

const SystemMessageModal = ({
  open,
  tone = 'info',
  title,
  message,
  buttonLabel = 'OK',
  onClose,
}) => {
  if (!open) {
    return null;
  }

  const styles = toneStyles[tone] || toneStyles.info;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-message-title"
    >
      <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${styles.iconClass}`}>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={styles.path} />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{styles.eyebrow}</p>
            <h2 id="system-message-title" className="mt-2 text-2xl font-bold text-slate-900">{title}</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-2xl px-6 py-3 text-sm font-semibold transition ${styles.buttonClass}`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemMessageModal;
