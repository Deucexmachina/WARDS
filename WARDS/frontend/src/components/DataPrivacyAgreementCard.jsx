const DataPrivacyAgreementCard = ({
  agreement,
  scrollable = false,
  onScroll,
  containerRef,
  footer,
  className = '',
}) => {
  if (!agreement) {
    return null;
  }

  return (
    <section className={`rounded-[28px] border border-emerald-100 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)] ${className}`}>
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Privacy Notice</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">{agreement.title}</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">
          <span>Version: {agreement.version}</span>
          <span>Effective: {agreement.effective_date}</span>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={onScroll}
        className={`px-5 py-5 text-sm leading-7 text-slate-600 sm:px-6 ${scrollable ? 'max-h-80 overflow-y-auto' : ''}`}
      >
        <div className="whitespace-pre-line">{agreement.content}</div>
      </div>

      {footer ? (
        <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
};

export default DataPrivacyAgreementCard;
