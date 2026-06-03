import { createPortal } from 'react-dom';

const ProcessingModal = ({ show, title, message, status = 'loading' }) => {
  if (!show || typeof document === 'undefined') return null;

  const isSuccess = status === 'success';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-busy={isSuccess ? 'false' : 'true'}
      aria-live="polite"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${isSuccess ? 'bg-emerald-100' : 'bg-slate-100'}`}>
          {isSuccess ? (
            <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path>
            </svg>
          ) : (
            <div className="spinner" aria-hidden="true"></div>
          )}
        </div>
        <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${isSuccess ? 'text-emerald-500' : 'text-slate-400'}`}>
          {isSuccess ? 'Success' : 'Please Wait'}
        </p>
        <h3 className="mt-2 text-2xl font-bold text-primary">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      </div>
    </div>,
    document.body
  );
};

export default ProcessingModal;
