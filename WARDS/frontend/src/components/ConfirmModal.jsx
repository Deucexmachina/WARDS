const ConfirmModal = ({ show, title, message, onClose }) => {
  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Success</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
