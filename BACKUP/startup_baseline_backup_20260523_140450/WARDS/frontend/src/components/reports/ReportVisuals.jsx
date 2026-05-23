const formatPercent = (value) => `${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`;

const buildPalette = (index) => {
  const palettes = [
    { base: '#1d4ed8', soft: '#dbeafe', accent: '#93c5fd' },
    { base: '#0f766e', soft: '#ccfbf1', accent: '#5eead4' },
    { base: '#b45309', soft: '#fef3c7', accent: '#fcd34d' },
    { base: '#7c3aed', soft: '#ede9fe', accent: '#c4b5fd' },
    { base: '#be123c', soft: '#ffe4e6', accent: '#fda4af' },
    { base: '#0369a1', soft: '#e0f2fe', accent: '#7dd3fc' },
  ];

  return palettes[index % palettes.length];
};

const EmptyChartState = ({ title }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
    No data available for {title.toLowerCase()}.
  </div>
);

const SectionCard = ({ title, subtitle, children, action }) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">{title}</h4>
          {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </div>
    <div className="px-5 py-5">{children}</div>
  </section>
);

export const ExecutiveSummaryPanel = ({ title, subtitle, highlights = [] }) => {
  const visibleHighlights = highlights.filter((item) => item && item.label);

  if (!visibleHighlights.length) {
    return <EmptyChartState title={title} />;
  }

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleHighlights.map((item, index) => {
          const palette = buildPalette(index);
          return (
            <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{item.value}</p>
                </div>
                <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: palette.base }} />
              </div>
              {item.helper ? <p className="mt-2 text-sm text-slate-500">{item.helper}</p> : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};

export const MetricListCard = ({ title, subtitle, items = [] }) => {
  const visibleItems = items.filter((item) => item && item.label);

  if (!visibleItems.length) {
    return <EmptyChartState title={title} />;
  }

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="space-y-3">
        {visibleItems.map((item, index) => {
          const palette = buildPalette(index);
          return (
            <div key={item.label} className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.base }} />
                  <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                </div>
                {item.helper ? <p className="mt-1 pl-5 text-xs text-slate-500">{item.helper}</p> : null}
              </div>
              <p className="shrink-0 text-sm font-bold text-slate-900">{item.value}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};

export const DetailedBarChart = ({
  title,
  subtitle,
  entries = [],
  metricLabel,
  formatter = (value) => value,
  detailRenderer,
}) => {
  const normalized = entries
    .map((entry, index) => {
      const value = Number(entry.value || 0);
      const secondaryValue = Number(entry.secondaryValue || 0);
      return {
        ...entry,
        value,
        secondaryValue,
        palette: buildPalette(index),
      };
    })
    .sort((left, right) => right.value - left.value);

  const maxValue = Math.max(1, ...normalized.map((entry) => entry.value));
  const total = normalized.reduce((sum, entry) => sum + entry.value, 0);

  if (!normalized.length) {
    return <EmptyChartState title={title} />;
  }

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      action={
        <div className="rounded-xl bg-slate-100 px-3 py-2 text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Total {metricLabel}</p>
          <p className="mt-1 text-lg font-bold text-primary">{formatter(total)}</p>
        </div>
      }
    >
      <div className="space-y-5">
        {normalized.map((entry) => {
          const width = Math.max((entry.value / maxValue) * 100, 6);
          const share = total > 0 ? (entry.value / total) * 100 : 0;
          return (
            <div key={entry.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">{entry.label}</p>
                  {entry.description ? <p className="mt-1 text-xs text-slate-500">{entry.description}</p> : null}
                </div>
                <div className="text-left lg:text-right">
                  <p className="text-lg font-bold text-slate-900">{formatter(entry.value)}</p>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{formatPercent(share)} of total</p>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-full bg-white">
                <div
                  className="h-4 rounded-full"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${entry.palette.base} 0%, ${entry.palette.accent} 100%)`,
                  }}
                />
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-xl bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Primary Metric</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{formatter(entry.value)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Share</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{formatPercent(share)}</p>
                </div>
                <div>
                  {detailRenderer ? detailRenderer(entry) : (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Secondary Metric</p>
                      <p className="mt-1 text-sm font-bold text-slate-800">{formatter(entry.secondaryValue)}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};

export const DonutBreakdownChart = ({
  title,
  subtitle,
  data = {},
  formatter = (value) => value,
}) => {
  const entries = Object.entries(data)
    .map(([label, value], index) => ({
      label,
      value: Number(value || 0),
      palette: buildPalette(index),
    }))
    .filter((entry) => entry.value > 0);

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);

  if (!entries.length || total <= 0) {
    return <EmptyChartState title={title} />;
  }

  let start = 0;
  const segments = entries.map((entry) => {
    const share = entry.value / total;
    const end = start + share;
    const x1 = 50 + 40 * Math.cos(2 * Math.PI * start - Math.PI / 2);
    const y1 = 50 + 40 * Math.sin(2 * Math.PI * start - Math.PI / 2);
    const x2 = 50 + 40 * Math.cos(2 * Math.PI * end - Math.PI / 2);
    const y2 = 50 + 40 * Math.sin(2 * Math.PI * end - Math.PI / 2);
    const largeArc = share > 0.5 ? 1 : 0;
    const path = `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`;
    start = end;
    return { ...entry, share, path };
  });

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px,1fr] lg:items-center">
        <div className="mx-auto flex w-full max-w-[260px] items-center justify-center">
          <div className="relative h-56 w-56">
            <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-sm">
              {segments.map((segment) => (
                <path key={segment.label} d={segment.path} fill={segment.palette.base} stroke="#fff" strokeWidth="1.5" />
              ))}
              <circle cx="50" cy="50" r="24" fill="white" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total</p>
              <p className="mt-1 text-2xl font-bold text-primary">{formatter(total)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {segments.map((segment) => (
            <div key={segment.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: segment.palette.base }} />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{segment.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatPercent(segment.share * 100)} of report total</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-slate-900">{formatter(segment.value)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
};

export const ComparisonGrid = ({ title, subtitle, rows = [], formatter = (value) => value }) => {
  if (!rows.length) {
    return <EmptyChartState title={title} />;
  }

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Metric</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Current</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Previous</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => {
              const delta = Number(row.delta || 0);
              return (
                <tr key={row.label}>
                  <td className="px-4 py-3 font-medium text-slate-700">{row.label}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatter(row.current, row)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatter(row.previous, row)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatter(delta, row)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
};

export const CompactComparisonCard = ({ title, subtitle, rows = [], formatter = (value) => value }) => {
  const visibleRows = rows.filter((row) => row && row.label);

  if (!visibleRows.length) {
    return <EmptyChartState title={title} />;
  }

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="space-y-3">
        {visibleRows.map((row) => {
          const delta = Number(row.delta || 0);
          return (
            <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                <p className={`text-sm font-bold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {formatter(delta, row)}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-slate-500">
                <div>
                  <p className="uppercase tracking-[0.14em]">Current</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{formatter(row.current, row)}</p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.14em]">Previous</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{formatter(row.previous, row)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};
