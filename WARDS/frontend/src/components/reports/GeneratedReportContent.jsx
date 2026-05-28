import { useEffect, useMemo, useState } from 'react';
import { formatUtc8Date, formatUtc8DateTime, formatUtc8Time } from '../../utils/dateTime';

const formatNumber = (value) => Number(value || 0).toLocaleString('en-PH');
const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DETAIL_ROWS_PER_PAGE = 5;
const DETAIL_GROUP_ORDER = [
  'rpt_transactions',
  'bt_transactions',
  'misc_transactions',
  'receipt_requests',
  'payment_transactions',
  'other_service_categories',
];
const DETAIL_GROUP_META = {
  rpt_transactions: {
    title: 'RPT Queue Service',
    subtitle: 'Real Property Tax related operational and payment records.',
  },
  bt_transactions: {
    title: 'BT Queue Service',
    subtitle: 'Business Tax related operational and payment records.',
  },
  misc_transactions: {
    title: 'MISC Queue Service',
    subtitle: 'Miscellaneous tax transactions and supporting operational records.',
  },
  receipt_requests: {
    title: 'Receipt Requests',
    subtitle: 'Receipt request records, release statuses, and fee-related entries.',
  },
  payment_transactions: {
    title: 'Payment Transactions',
    subtitle: 'Verified, pending, and failed payment activity not covered by tax-specific sections.',
  },
  other_service_categories: {
    title: 'Other Service Categories',
    subtitle: 'Remaining operational records that do not fall into the core grouped categories.',
  },
};

const getReportReference = (report) => `WARDS-RPT-${String(report?.id || 0).padStart(5, '0')}`;

const ReportSection = ({ title, subtitle, children, action }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm print:shadow-none">
    <div className="border-b border-slate-100 px-6 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-bold text-primary">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </div>
    <div className="px-6 py-5">{children}</div>
  </section>
);

const HeaderField = ({ label, value }) => (
  <div className="rounded-xl border border-white/40 bg-white/10 px-4 py-3 backdrop-blur-sm">
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100">{label}</p>
    <p className="mt-1 text-sm font-semibold text-white">{value || 'N/A'}</p>
  </div>
);

const KpiCard = ({ label, value, helper }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
    {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
  </div>
);

const EmptyChartState = ({ message }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
    {message}
  </div>
);

const HorizontalBarChart = ({ items }) => {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-semibold text-slate-800">{item.label}</p>
              {item.helper ? <p className="text-xs text-slate-500">{item.helper}</p> : null}
            </div>
            <p className="font-bold text-primary">{formatNumber(item.value)}</p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${Math.max((item.value / max) * 100, 6)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const DonutChart = ({ items, totalFormatter = formatNumber }) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let start = 0;

  const segments = items.map((item, index) => {
    const colors = ['#0f2f5f', '#1d4ed8', '#0f766e', '#b45309', '#7c3aed', '#be123c'];
    const share = total > 0 ? item.value / total : 0;
    const end = start + share;
    const x1 = 50 + 40 * Math.cos(2 * Math.PI * start - Math.PI / 2);
    const y1 = 50 + 40 * Math.sin(2 * Math.PI * start - Math.PI / 2);
    const x2 = 50 + 40 * Math.cos(2 * Math.PI * end - Math.PI / 2);
    const y2 = 50 + 40 * Math.sin(2 * Math.PI * end - Math.PI / 2);
    const largeArc = share > 0.5 ? 1 : 0;
    const path = `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`;
    start = end;
    return { ...item, path, color: colors[index % colors.length], share };
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px,1fr] lg:items-center">
      <div className="mx-auto h-52 w-52">
        <div className="relative h-full w-full">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            {segments.map((segment) => (
              <path key={segment.label} d={segment.path} fill={segment.color} stroke="#fff" strokeWidth="1.5" />
            ))}
            <circle cx="50" cy="50" r="23" fill="white" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Total</p>
            <p className="mt-1 text-xl font-bold text-primary">{totalFormatter(total)}</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
              <div>
                <p className="text-sm font-semibold text-slate-800">{segment.label}</p>
                <p className="text-xs text-slate-500">{(segment.share * 100).toFixed(1)}% of service activity</p>
              </div>
            </div>
            <p className="text-sm font-bold text-slate-900">{formatNumber(segment.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const TrendLineChart = ({ points }) => {
  const width = 640;
  const height = 220;
  const padding = 28;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.clients_served, point.transactions]));

  const makePath = (key) =>
    points
      .map((point, index) => {
        const x = padding + (chartWidth * index) / Math.max(points.length - 1, 1);
        const y = height - padding - (Number(point[key] || 0) / maxValue) * chartHeight;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-primary" />Clients Served</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Transactions</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + ratio * chartHeight;
          return <line key={ratio} x1={padding} x2={width - padding} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
        })}
        <path d={makePath('clients_served')} fill="none" stroke="#0f2f5f" strokeWidth="3" strokeLinecap="round" />
        <path d={makePath('transactions')} fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
        {points.map((point, index) => {
          const x = padding + (chartWidth * index) / Math.max(points.length - 1, 1);
          const clientsY = height - padding - (Number(point.clients_served || 0) / maxValue) * chartHeight;
          const transactionsY = height - padding - (Number(point.transactions || 0) / maxValue) * chartHeight;
          return (
            <g key={point.date}>
              <circle cx={x} cy={clientsY} r="4" fill="#0f2f5f" />
              <circle cx={x} cy={transactionsY} r="4" fill="#059669" />
            </g>
          );
        })}
      </svg>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {points.slice(-4).map((point) => (
          <div key={point.date} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">{formatUtc8Date(point.date, 'en-PH', { month: 'short', day: 'numeric' })}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{formatNumber(point.clients_served)} clients</p>
            <p className="text-xs text-slate-500">{formatNumber(point.transactions)} transactions</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ComparisonBars = ({ rows }) => (
  <div className="space-y-4">
    {rows.map((row) => {
      const max = Math.max(1, Number(row.current || 0), Number(row.previous || 0));
      const currentWidth = (Number(row.current || 0) / max) * 100;
      const previousWidth = (Number(row.previous || 0) / max) * 100;
      return (
        <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-slate-800">{row.label}</p>
            <p className={`text-sm font-bold ${Number(row.delta || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {row.currency ? formatCurrency(row.delta) : formatNumber(row.delta)}
            </p>
          </div>
          <div className="space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Current</span><span>{row.currency ? formatCurrency(row.current) : formatNumber(row.current)}</span></div>
              <div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(currentWidth, 6)}%` }} /></div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Previous</span><span>{row.currency ? formatCurrency(row.previous) : formatNumber(row.previous)}</span></div>
              <div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-slate-500" style={{ width: `${Math.max(previousWidth, 6)}%` }} /></div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

const StatusBadge = ({ status }) => {
  const normalized = String(status || '').toLowerCase();
  const tones = {
    completed: 'bg-emerald-100 text-emerald-700',
    verified: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    waiting: 'bg-amber-100 text-amber-700',
    serving: 'bg-blue-100 text-blue-700',
    called: 'bg-blue-100 text-blue-700',
    failed: 'bg-rose-100 text-rose-700',
    cancelled: 'bg-rose-100 text-rose-700',
    canceled: 'bg-rose-100 text-rose-700',
    skipped: 'bg-slate-200 text-slate-700',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[normalized] || 'bg-slate-100 text-slate-700'}`}>{status || 'N/A'}</span>;
};

const isCompletedStatus = (status) => ['completed', 'verified', 'released'].includes(String(status || '').toLowerCase());
const isPendingStatus = (status) => ['pending', 'waiting', 'serving', 'called', 'payment required', 'ready for release'].includes(String(status || '').toLowerCase());

const classifyDetailGroup = (row) => {
  const serviceType = String(row?.service_type || '').toLowerCase();
  const category = String(row?.category || '').toLowerCase();
  const sourceType = String(row?.source_type || '').toLowerCase();
  const combined = `${serviceType} ${category}`.trim();

  if (sourceType === 'receipt' || combined.includes('receipt request') || combined.includes('document request')) {
    return 'receipt_requests';
  }
  if (combined.includes('real property') || combined.includes('rpt')) {
    return 'rpt_transactions';
  }
  if (combined.includes('business tax') || combined.includes(' bt') || serviceType === 'bt' || category === 'bt') {
    return 'bt_transactions';
  }
  if (combined.includes('misc')) {
    return 'misc_transactions';
  }
  if (sourceType === 'payment') {
    return 'payment_transactions';
  }
  return 'other_service_categories';
};

const buildSectionSummary = (rows) => ({
  totalRecords: rows.length,
  completedCount: rows.filter((row) => isCompletedStatus(row.status)).length,
  pendingCount: rows.filter((row) => isPendingStatus(row.status)).length,
  totalAmount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
});

const isQueueServiceSection = (sectionKey) => ['rpt_transactions', 'bt_transactions', 'misc_transactions'].includes(sectionKey);

const buildGroupedDetailSections = (rows) => {
  const grouped = DETAIL_GROUP_ORDER.reduce((accumulator, key) => {
    accumulator[key] = [];
    return accumulator;
  }, {});

  rows.forEach((row) => {
    grouped[classifyDetailGroup(row)].push(row);
  });

  return DETAIL_GROUP_ORDER
    .filter((key) => grouped[key].length > 0)
    .map((key) => ({
      key,
      ...DETAIL_GROUP_META[key],
      rows: grouped[key],
      summary: buildSectionSummary(grouped[key]),
    }));
};

const buildPaginatedDetailSections = (sections, pageSize = DETAIL_ROWS_PER_PAGE) => {
  if (!sections.length) {
    return [];
  }

  const pages = [];
  let currentSections = [];
  let remainingSlots = pageSize;

  sections.forEach((section) => {
    let startIndex = 0;
    while (startIndex < section.rows.length) {
      if (remainingSlots === 0) {
        pages.push(currentSections);
        currentSections = [];
        remainingSlots = pageSize;
      }

      const endIndex = Math.min(startIndex + remainingSlots, section.rows.length);
      const pageRows = section.rows.slice(startIndex, endIndex);

      currentSections.push({
        ...section,
        rows: pageRows,
        isContinued: startIndex > 0,
        remainingCount: section.rows.length - endIndex,
      });

      remainingSlots -= pageRows.length;
      startIndex = endIndex;
    }
  });

  if (currentSections.length) {
    pages.push(currentSections);
  }

  return pages;
};

const DetailSectionCard = ({ section }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 shadow-sm">
    <div className="border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-bold text-slate-900">{section.title}</h4>
            {section.isContinued ? (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                Continued
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">{section.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Records</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{formatNumber(section.summary.totalRecords)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-500">Completed</p>
            <p className="mt-1 text-sm font-bold text-emerald-700">{formatNumber(section.summary.completedCount)}</p>
          </div>
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">Pending</p>
            <p className="mt-1 text-sm font-bold text-amber-700">{formatNumber(section.summary.pendingCount)}</p>
          </div>
          {!isQueueServiceSection(section.key) ? (
            <div className="rounded-xl bg-sky-50 px-3 py-2 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-500">Amount</p>
              <p className="mt-1 text-sm font-bold text-sky-700">{formatCurrency(section.summary.totalAmount)}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>

    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-100/80">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Reference No.</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Time</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Service Type</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Category</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
            {!isQueueServiceSection(section.key) ? (
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Amount / Fee</th>
            ) : null}
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Notes / Remarks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {section.rows.map((row) => (
            <tr key={`${section.key}-${row.source_type}-${row.reference}-${row.timestamp || row.date || ''}`} className="align-top">
              <td className="px-4 py-3 font-semibold text-primary">{row.reference}</td>
              <td className="px-4 py-3 text-slate-700">{row.timestamp ? formatUtc8Date(row.timestamp) : row.date || 'N/A'}</td>
              <td className="px-4 py-3 text-slate-700">{row.timestamp ? formatUtc8Time(row.timestamp) : row.time || 'N/A'}</td>
              <td className="px-4 py-3 text-slate-700">{row.service_type || 'N/A'}</td>
              <td className="px-4 py-3 text-slate-700">{row.category || 'N/A'}</td>
              <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
              {!isQueueServiceSection(section.key) ? (
                <td className="px-4 py-3 text-right text-slate-700">{row.amount !== null && row.amount !== undefined ? formatCurrency(row.amount) : 'N/A'}</td>
              ) : null}
              <td className="px-4 py-3 text-slate-500">{row.notes || 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {section.remainingCount > 0 ? (
      <div className="border-t border-slate-200 bg-white px-5 py-3 text-xs font-medium text-slate-500">
        {formatNumber(section.remainingCount)} more record(s) continue on the next page.
      </div>
    ) : null}
  </div>
);

const buildTopKpis = (report, metrics) => {
  const isDocumentRequestReport = report?.service_type === 'Document Request';
  const isReceiptFeeReport = report?.transaction_category === 'Receipt Request Fee';
  const isAllServicesOperational = !isDocumentRequestReport && !isReceiptFeeReport && (!report?.service_type || report.service_type === 'All Services');
  const leadingServiceLabel = metrics.summary?.most_used_service || metrics.insights?.top_transaction_category || 'N/A';

  return [
  {
    label: 'Total Clients Served',
    value: formatNumber(metrics.summary?.total_clients_served),
    helper: isDocumentRequestReport ? 'All recorded document request activities' : 'All recorded queue-based service activities',
  },
  {
    label: 'Total Transactions',
    value: formatNumber(metrics.transactions?.total_transactions),
    helper: (isDocumentRequestReport || isReceiptFeeReport)
      ? 'Captured receipt request fee transactions in the report period'
      : isAllServicesOperational
      ? 'Captured payment and receipt-related transactions in the report period'
      : 'Captured payment transactions in the report period',
  },
  { label: 'Most Used Service', value: leadingServiceLabel, helper: 'Highest service utilization for this report' },
  { label: 'Pending Transactions', value: formatNumber(metrics.transactions?.pending_transactions), helper: 'Transactions still awaiting completion' },
  { label: 'Completed Transactions', value: formatNumber(metrics.transactions?.completed_transactions), helper: 'Verified and completed transactions' },
  { label: 'Cancelled / Failed', value: formatNumber(metrics.transactions?.cancelled_failed_transactions), helper: 'Expired, cancelled, or failed transactions' },
  { label: 'Revenue / Collections', value: formatCurrency(metrics.transactions?.total_amount), helper: 'Completed transaction collections' },
];
};

export default function GeneratedReportContent({ report, metrics, contextLabel = 'Generated Report' }) {
  const [detailPage, setDetailPage] = useState(1);
  const historical = metrics?.historical_comparison || {};
  const operationalStats = metrics?.operational_statistics || {};
  const serviceItems = Object.entries(metrics?.service_utilization || {})
    .map(([label, value]) => ({ label, value: Number(value?.count || 0), helper: `${formatNumber(value?.completed || 0)} completed` }))
    .filter((item) => item.value > 0);
  const categoryItems = Object.entries(metrics?.transaction_categories || {})
    .map(([label, value]) => ({
      label,
      value: Number(value?.count || 0),
      helper: `${formatCurrency(value?.amount || 0)} collected`,
      amount: Number(value?.amount || 0),
    }))
    .filter((item) => item.value > 0);
  const trendPoints = metrics?.daily_trend || [];
  const comparisonRows = [
    { label: 'Clients Served', current: historical.clients_served?.current, previous: historical.clients_served?.previous, delta: historical.clients_served?.delta },
    { label: 'Completed Transactions', current: historical.completed_transactions?.current, previous: historical.completed_transactions?.previous, delta: historical.completed_transactions?.delta },
    { label: 'Collections', current: historical.total_amount?.current, previous: historical.total_amount?.previous, delta: historical.total_amount?.delta, currency: true },
  ];
  const detailRows = metrics?.detailed_rows || [];
  const receiptTransactionRows = metrics?.receipt_transaction_summary || [];
  const insights = metrics?.insights || {};
  const groupedDetailSections = useMemo(() => buildGroupedDetailSections(detailRows), [detailRows]);
  const paginatedDetailSections = useMemo(() => buildPaginatedDetailSections(groupedDetailSections), [groupedDetailSections]);
  const currentDetailSections = paginatedDetailSections[detailPage - 1] || [];

  useEffect(() => {
    setDetailPage(1);
  }, [report?.id, detailRows.length]);

  useEffect(() => {
    if (!paginatedDetailSections.length) {
      if (detailPage !== 1) {
        setDetailPage(1);
      }
      return;
    }
    if (detailPage > paginatedDetailSections.length) {
      setDetailPage(paginatedDetailSections.length);
    }
  }, [detailPage, paginatedDetailSections.length]);

  return (
    <div className="space-y-6 print:space-y-4">
      <section className="overflow-hidden rounded-3xl bg-[#0b2447] text-white shadow-xl print:shadow-none">
        <div className="px-6 py-6 md:px-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">{contextLabel}</p>
              <h2 className="mt-2 text-3xl font-bold">{report.title}</h2>
              <p className="mt-3 text-sm leading-6 text-blue-50">
                Operational report for {report.branch}, covering service activity, transaction performance, and decision-making insights for the selected reporting period.
              </p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Report Reference</p>
              <p className="mt-1 text-xl font-bold">{getReportReference(report)}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HeaderField label="Branch Office" value={report.branch} />
            <HeaderField label="Generated By" value={report.generated_by || report.submitted_by || 'N/A'} />
            <HeaderField label="Date Generated" value={report.created_at ? formatUtc8Date(report.created_at) : 'N/A'} />
            <HeaderField label="Time Generated" value={report.created_at ? formatUtc8Time(report.created_at) : 'N/A'} />
            <HeaderField label="Reporting Period" value={`${report.date_from || 'N/A'} to ${report.date_to || 'N/A'}`} />
            <HeaderField label="Service Type" value={report.service_type || 'All Services'} />
            <HeaderField label="Transaction Category" value={report.transaction_category || 'All Categories'} />
            <HeaderField label="Submitted At" value={report.submitted_at ? formatUtc8DateTime(report.submitted_at) : 'N/A'} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {buildTopKpis(report, metrics).map((card) => (
          <KpiCard key={card.label} label={card.label} value={card.value} helper={card.helper} />
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportSection title="Transaction Volume By Service" subtitle="Bar chart showing how service demand is distributed across the report period.">
          {serviceItems.length ? (
            <HorizontalBarChart items={serviceItems} />
          ) : (
            <EmptyChartState message="No service activity records were captured for this report scope." />
          )}
        </ReportSection>

        <ReportSection title="Service Utilization Breakdown" subtitle="Donut chart summary of the same service activity for quick proportional review.">
          {serviceItems.length ? (
            <DonutChart items={serviceItems} />
          ) : (
            <EmptyChartState message="No service utilization breakdown is available for the selected report filters." />
          )}
        </ReportSection>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportSection title="Transaction Category Volume" subtitle="Bar chart showing all payment and category activity captured in the report period.">
          {categoryItems.length ? (
            <HorizontalBarChart items={categoryItems} />
          ) : (
            <EmptyChartState message="No transaction category records were captured for this report scope." />
          )}
        </ReportSection>

        <ReportSection title="Transaction Category Breakdown" subtitle="Donut chart summary of payment categories for quick proportional review.">
          {categoryItems.length ? (
            <DonutChart items={categoryItems} totalFormatter={formatNumber} />
          ) : (
            <EmptyChartState message="No payment category breakdown is available for the selected report filters." />
          )}
        </ReportSection>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportSection title="Receipt And Transaction Summary" subtitle="Condensed totals for payment verification and receipt-release activity.">
          <div className="space-y-3">
            {receiptTransactionRows.length ? receiptTransactionRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                  <p className="text-xs text-slate-500">{row.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{formatNumber(row.count)}</p>
                  <p className="text-xs text-slate-500">{Number(row.amount || 0) > 0 ? formatCurrency(row.amount) : 'No amount'}</p>
                </div>
              </div>
            )) : (
              <EmptyChartState message="No summarized receipt or transaction records are available for this report scope." />
            )}
          </div>
        </ReportSection>

        <ReportSection title="Activity Trend Over Time" subtitle="Line graph of daily service volume and transaction activity across the selected date range.">
          <TrendLineChart points={trendPoints} />
        </ReportSection>

        <ReportSection title="Performance Comparison" subtitle="Comparison with the previous reporting period where applicable.">
          <ComparisonBars rows={comparisonRows} />
        </ReportSection>
      </div>

      <ReportSection title="Operational Statistics" subtitle="Queue activity snapshots and branch workload trends captured during the reporting period.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Activity Snapshots" value={formatNumber(operationalStats.total_snapshots)} helper="Recorded queue activity checkpoints" />
          <KpiCard label="Avg Waiting" value={formatNumber(operationalStats.average_waiting)} helper="Average waiting clients per snapshot" />
          <KpiCard label="Avg Serving" value={formatNumber(operationalStats.average_serving)} helper="Average active serving load per snapshot" />
          <KpiCard label="Avg Completed" value={formatNumber(operationalStats.average_completed)} helper="Average completed clients per snapshot" />
          <KpiCard label="Peak Waiting" value={formatNumber(operationalStats.peak_waiting)} helper="Highest waiting count recorded" />
          <KpiCard label="Peak Serving" value={formatNumber(operationalStats.peak_serving)} helper="Highest active serving count recorded" />
          <KpiCard label="Peak Completed" value={formatNumber(operationalStats.peak_completed)} helper="Highest completed count recorded" />
          <KpiCard label="Latest Snapshot" value={operationalStats.latest_snapshot_at ? formatUtc8DateTime(operationalStats.latest_snapshot_at) : 'N/A'} helper="Most recent queue activity sample" />
        </div>
      </ReportSection>

      <ReportSection
        title="Detailed Report Table"
        subtitle="Detailed operational records grouped by service type for cleaner review and easier navigation."
        action={(
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-500">
            <span>{detailRows.length} records</span>
            <span>Page {Math.min(detailPage, Math.max(paginatedDetailSections.length, 1))} of {Math.max(paginatedDetailSections.length, 1)}</span>
          </div>
        )}
      >
        <div className="space-y-5">
          {currentDetailSections.length ? currentDetailSections.map((section) => (
            <DetailSectionCard key={`${section.key}-${section.isContinued ? 'continued' : 'start'}-${section.rows[0]?.reference || 'empty'}`} section={section} />
          )) : (
            <EmptyChartState message="No detailed operational records are available for the selected report scope." />
          )}
        </div>

        {paginatedDetailSections.length > 1 ? (
          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing grouped report page {detailPage} of {paginatedDetailSections.length}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDetailPage((current) => Math.max(current - 1, 1))}
                disabled={detailPage <= 1}
                className="rounded-xl bg-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setDetailPage((current) => Math.min(current + 1, paginatedDetailSections.length))}
                disabled={detailPage >= paginatedDetailSections.length}
                className="rounded-xl bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </ReportSection>

      <ReportSection title="Insights And Summary" subtitle="Concise operational interpretation for easier decision-making.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Highest Service Utilization</p>
            <p className="mt-2 text-lg font-bold text-slate-900">{insights.most_used_service || 'N/A'}</p>
            <p className="mt-3 text-xs text-slate-500">Top transaction category: {insights.top_transaction_category || 'N/A'}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Busiest Day / Time</p>
            <p className="mt-2 text-lg font-bold text-slate-900">{insights.busiest_day || 'N/A'}</p>
            <p className="mt-3 text-xs text-slate-500">{insights.busiest_time || 'N/A'} was the busiest operating time window.</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Transaction Trend</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{insights.transaction_trend || 'No trend summary available.'}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Operational Remarks</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{insights.operational_remark || 'No operational remarks available.'}</p>
            <p className="mt-3 text-sm leading-6 text-slate-700">{insights.historical_change || 'No notable changes were detected.'}</p>
          </div>
        </div>
      </ReportSection>
    </div>
  );
}
