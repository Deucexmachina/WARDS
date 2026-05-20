const WardsPageHero = ({ eyebrow, title, subtitle, actions, className = '' }) => (
  <section className={`overflow-hidden rounded-[2rem] border border-slate-300 bg-white px-6 py-7 text-slate-900 shadow-2xl shadow-slate-200/60 md:px-8 ${className}`.trim()}>
    <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{title}</h1>
        {subtitle ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  </section>
);

export default WardsPageHero;
