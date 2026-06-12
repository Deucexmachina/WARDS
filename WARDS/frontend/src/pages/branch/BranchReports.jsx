import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { branchReportAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8DateTime } from '../../utils/dateTime';
import GeneratedReportContent from '../../components/reports/GeneratedReportContent';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import {
  applyBranchReportViewedState,
  BRANCH_REPORT_VIEWED_EVENT,
  BRANCH_REPORTS_UPDATED_EVENT,
  markBranchReportViewed,
} from '../../utils/branchReportViews';

const buildExportFilename = (response, fallback) => {
  const disposition = response.headers?.['content-disposition'] || response.headers?.['Content-Disposition'];
  const match = disposition?.match(/filename="?(?<filename>[^"]+)"?/i);
  return match?.groups?.filename || fallback;
};

const downloadBlobResponse = (response, fallbackName) => {
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = buildExportFilename(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
};

const REPORT_TYPES = ['Operational', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual'];
const SERVICE_TYPES = ['All Services', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Document Request'];
const TRANSACTION_CATEGORIES = ['All Categories', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Receipt Request Fee'];
const PAGE_SIZE = 5;
const AUTO_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const initialFilters = {
  reportType: 'Operational',
  service_type: 'All Services',
  transaction_category: 'All Categories',
  dateFrom: '',
  dateTo: '',
};

const formatNumber = (value) => Number(value || 0).toLocaleString('en-PH');

const showSystemSuccessMessage = ({ title, message }) => {
  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: {
      tone: 'success',
      title,
      message,
      buttonLabel: 'OK',
    },
  }));
};

const SummaryCard = ({ label, value, helper }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className="mt-3 text-2xl font-bold text-primary">{value}</p>
    {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
  </div>
);

const getInvalidDateRangeMessage = (dateFrom, dateTo) => {
  if (!dateFrom || !dateTo) {
    return '';
  }

  return dateFrom <= dateTo
    ? ''
    : 'Invalid date range. "Date To" must be the same as or later than "Date From".';
};

const ReportMetricsModal = ({ report, metrics, onClose }) => {
  const isOpen = Boolean(report && metrics);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm px-4 py-6">
      <div className="flex h-full max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl">
        <div className="flex shrink-0 justify-end border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur md:px-8">
          <button onClick={onClose} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
          <GeneratedReportContent report={report} metrics={metrics} contextLabel="Submitted To Main Admin" />
        </div>
      </div>
    </div>,
    document.body
  );
};

const BranchReports = () => {
  const [activeTab, setActiveTab] = useState('active');
  const [filters, setFilters] = useState(initialFilters);
  const [generationMode, setGenerationMode] = useState('manual');
  const [reportsState, setReportsState] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [historyState, setHistoryState] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [exportingKey, setExportingKey] = useState('');
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedMetrics, setSelectedMetrics] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [reportToDelete, setReportToDelete] = useState(null);
  const [pendingGeneratedReport, setPendingGeneratedReport] = useState(null);
  const [historyReportToView, setHistoryReportToView] = useState(null);
  const [automation, setAutomation] = useState({
    enabled: false,
    frequency: 'daily',
    dispatch_time: '17:00',
    weekday: 0,
    month_day: 1,
    reportType: 'Daily',
    service_type: 'All Services',
    transaction_category: 'All Categories',
  });
  const [savingAutomation, setSavingAutomation] = useState(false);
  const branchStaff = JSON.parse(localStorage.getItem('branchUser') || '{}');

  const fetchReports = async (page = 1) => {
    try {
      setLoading(true);
      const response = await branchReportAPI.getAll({ page, page_size: PAGE_SIZE });
      setReportsState({
        ...response.data,
        items: applyBranchReportViewedState(response.data?.items || [], branchStaff),
      });
    } catch (fetchError) {
      console.error('Failed to fetch branch reports:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load submitted branch reports.');
    } finally {
      setLoading(false);
    }
  };

  const fetchReportHistory = async (page = 1) => {
    try {
      setHistoryLoading(true);
      const response = await branchReportAPI.getHistory({ page, page_size: PAGE_SIZE });
      setHistoryState(response.data);
    } catch (fetchError) {
      console.error('Failed to fetch report history:', fetchError);
      window.dispatchEvent(new CustomEvent('wards:system-message', {
        detail: {
          tone: 'error',
          title: 'Unable to Load Report History',
          message: 'An error occurred while loading report history. Please try again.',
          buttonLabel: 'OK',
        },
      }));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    branchReportAPI.getAutomation()
      .then((response) => setAutomation((current) => ({ ...current, ...response.data })))
      .catch((fetchError) => {
        console.error('Failed to fetch report automation settings:', fetchError);
      });
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchReportHistory(reportsState.page);
    }
  }, [activeTab]);

  const summary = useMemo(() => ({
    total: reportsState.total || 0,
    monthly: reportsState.items.filter((report) => report.report_type === 'Monthly').length,
    operational: reportsState.items.filter((report) => report.report_type === 'Operational').length,
    latestDate: reportsState.items[0]?.submitted_at || null,
  }), [reportsState]);

  const handleGenerate = async () => {
    if (!filters.dateFrom || !filters.dateTo) {
      setError('Select both Date From and Date To before generating a report.');
      return;
    }

    const dateRangeError = getInvalidDateRangeMessage(filters.dateFrom, filters.dateTo);
    if (dateRangeError) {
      setError(dateRangeError);
      return;
    }

    try {
      setGenerating(true);
      setError('');
      const payload = {
        ...filters,
        branch_id: String(branchStaff.branch_id),
        transaction_category: filters.service_type === 'Document Request' ? '' : filters.transaction_category,
      };
      const response = await branchReportAPI.generate(payload);
      const viewedIds = markBranchReportViewed(branchStaff, response.data?.report?.id);
      const nextReport = {
        ...response.data.report,
        is_viewed: viewedIds.includes(Number(response.data?.report?.id)),
      };
      setPendingGeneratedReport({ report: nextReport, metrics: response.data.metrics });
      window.dispatchEvent(new CustomEvent(BRANCH_REPORT_VIEWED_EVENT, { detail: { reportId: response.data?.report?.id } }));
      window.dispatchEvent(new CustomEvent(BRANCH_REPORTS_UPDATED_EVENT));
      await fetchReports(1);
      window.dispatchEvent(new CustomEvent('wards:system-message', {
        detail: {
          tone: 'success',
          title: 'Report Submitted Successfully',
          message: 'The report has been successfully generated and submitted to the Main Admin.',
          buttonLabel: 'OK',
          onClose: () => {
            setPendingGeneratedReport((pending) => {
              if (pending) {
                setSelectedReport(pending.report);
                setSelectedMetrics(pending.metrics);
              }
              return null;
            });
          },
        },
      }));
    } catch (generateError) {
      console.error('Failed to generate branch report:', generateError);
      setError(generateError.response?.data?.detail || 'Failed to generate and submit the report.');
    } finally {
      setGenerating(false);
    }
  };

  const handleView = async (reportId) => {
    try {
      setDetailsLoading(true);
      setError('');
      const response = await branchReportAPI.getDetails(reportId);
      const viewedIds = markBranchReportViewed(branchStaff, reportId);
      const nextReport = {
        ...response.data.report,
        is_viewed: viewedIds.includes(Number(reportId)),
      };
      setSelectedReport(nextReport);
      setSelectedMetrics(response.data.metrics);
      setReportsState((current) => ({
        ...current,
        items: (current.items || []).map((report) =>
          report.id === reportId ? { ...report, is_viewed: true } : report
        ),
      }));
      window.dispatchEvent(new CustomEvent(BRANCH_REPORT_VIEWED_EVENT, { detail: { reportId } }));
    } catch (viewError) {
      console.error('Failed to load branch report details:', viewError);
      setError(viewError.response?.data?.detail || 'Failed to load report details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDelete = async (reportId) => {
    if (!reportToDelete) {
      const targetReport = reportsState.items.find((report) => report.id === reportId);
      if (targetReport) {
        setReportToDelete(targetReport);
      }
      return;
    }

    try {
      setDeletingId(reportToDelete.id);
      setError('');
      await branchReportAPI.delete(reportToDelete.id);
      const nextPage = reportsState.items.length === 1 && reportsState.page > 1 ? reportsState.page - 1 : reportsState.page;
      await fetchReports(nextPage);
      if (selectedReport?.id === reportToDelete.id) {
        setSelectedReport(null);
        setSelectedMetrics(null);
      }
      setReportToDelete(null);
      window.dispatchEvent(new CustomEvent('wards:system-message', {
        detail: {
          tone: 'success',
          title: 'Report Archived Successfully',
          message: 'The report has been removed from active records and stored in Report History.',
          buttonLabel: 'OK',
        },
      }));
      window.dispatchEvent(new CustomEvent(BRANCH_REPORTS_UPDATED_EVENT, { detail: { deletedReportId: reportToDelete.id } }));
    } catch (deleteError) {
      console.error('Failed to delete branch report:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete the report.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = async (reportId, format) => {
    const key = `${reportId}-${format}`;
    try {
      setExportingKey(key);
      const response = await branchReportAPI.export(reportId, format);
      downloadBlobResponse(response, `branch-report-${reportId}.${format === 'pdf' ? 'pdf' : 'xls'}`);
    } catch (exportError) {
      console.error(`Failed to export report as ${format}:`, exportError);
      setError(exportError.response?.data?.detail || `Failed to export the report as ${format.toUpperCase()}.`);
    } finally {
      setExportingKey('');
    }
  };

  const handleViewHistoryReport = (historyReport) => {
    setHistoryReportToView(historyReport);
  };

  const handleSaveAutomation = async () => {
    try {
      setSavingAutomation(true);
      setError('');
      const response = await branchReportAPI.updateAutomation(automation);
      setAutomation((current) => ({ ...current, ...response.data }));
    } catch (saveError) {
      console.error('Failed to save report automation settings:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to save automatic report sending settings.');
    } finally {
      setSavingAutomation(false);
    }
  };

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Branch Reports"
        subtitle="Generate clean operational reports from recorded branch activity, review the report presentation, and submit them directly to Main Admin for monitoring and long-term analysis."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Submitted Reports" value={formatNumber(summary.total)} helper="Branch report history" />
        <SummaryCard label="Operational Reports" value={formatNumber(summary.operational)} helper="In current page view" />
        <SummaryCard label="Monthly Reports" value={formatNumber(summary.monthly)} helper="In current page view" />
        <SummaryCard label="Latest Submission" value={summary.latestDate ? formatUtc8Date(summary.latestDate) : 'N/A'} helper="Most recent report date" />
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      <section className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-primary">Report Submission Mode</h2>
            <p className="mt-2 text-sm text-slate-500">
              Choose the report generation workflow you want to use before sending branch reports to Main Admin.
            </p>
          </div>
          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
            Branch ID: {branchStaff.branch_id || 'N/A'}
          </div>
        </div>

        <div className="max-w-md">
          <label className="mb-2 block text-sm font-semibold text-slate-700">Submission Mode</label>
          <select
            value={generationMode}
            onChange={(event) => setGenerationMode(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="manual">Manual Report Generation</option>
            <option value="automatic">Automatic Report Generation</option>
          </select>
        </div>
      </section>

      {generationMode === 'manual' ? (
        <section className="rounded-2xl bg-white p-6 shadow">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-primary">Generate And Submit Report</h2>
              <p className="mt-2 text-sm text-slate-500">
                Generate a report from recorded branch activity, review the output, and submit it directly to Main Admin.
              </p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              Manual Sending
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Report Type</label>
              <select
                value={filters.reportType}
                onChange={(event) => setFilters((current) => ({ ...current, reportType: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {REPORT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Service Type</label>
              <select
                value={filters.service_type}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  service_type: event.target.value,
                  transaction_category: event.target.value === 'Document Request' ? 'All Categories' : current.transaction_category,
                }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Transaction Category</label>
              <select
                value={filters.transaction_category}
                disabled={filters.service_type === 'Document Request'}
                onChange={(event) => setFilters((current) => ({ ...current, transaction_category: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
              >
                {TRANSACTION_CATEGORIES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Date From</label>
              <input
                type="date"
                max={filters.dateTo || undefined}
                value={filters.dateFrom}
                onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Date To</label>
              <input
                type="date"
                min={filters.dateFrom || undefined}
                value={filters.dateTo}
                onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />
            </div>
          </div>

          {getInvalidDateRangeMessage(filters.dateFrom, filters.dateTo) ? (
            <p className="mt-4 text-sm font-medium text-red-600">
              {getInvalidDateRangeMessage(filters.dateFrom, filters.dateTo)}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
            >
              {generating ? 'Generating And Submitting...' : 'Generate And Submit To Main Admin'}
            </button>
            <button
              onClick={() => setFilters(initialFilters)}
              className="rounded-xl bg-slate-200 px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-300"
            >
              Reset Filters
            </button>
          </div>
        </section>
      ) : null}

      {generationMode === 'automatic' ? (
        <section className="rounded-2xl bg-white p-6 shadow">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-primary">Automatic Scheduled Sending</h2>
              <p className="mt-2 text-sm text-slate-500">
                Save a branch-level schedule so WARDS can generate and send due reports to Main Admin automatically.
              </p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              Automatic Sending
            </div>
          </div>

          <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-900">
            Automatic mode uses the saved schedule below and generates reports from live branch data when the scheduled dispatch time is due.
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <input
                type="checkbox"
                checked={automation.enabled}
                onChange={(event) => setAutomation((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span className="text-sm font-semibold text-slate-700">Enable automatic sending</span>
            </label>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Frequency</label>
              <select
                value={automation.frequency}
                onChange={(event) => setAutomation((current) => ({ ...current, frequency: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {AUTO_FREQUENCIES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Dispatch Time</label>
              <input
                type="time"
                value={automation.dispatch_time}
                onChange={(event) => setAutomation((current) => ({ ...current, dispatch_time: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Scheduled Report Type</label>
              <select
                value={automation.reportType}
                onChange={(event) => setAutomation((current) => ({ ...current, reportType: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {REPORT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Service Type</label>
              <select
                value={automation.service_type}
                onChange={(event) => setAutomation((current) => ({ ...current, service_type: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Transaction Category</label>
              <select
                value={automation.transaction_category}
                onChange={(event) => setAutomation((current) => ({ ...current, transaction_category: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                {TRANSACTION_CATEGORIES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Weekly Day</label>
              <select
                value={automation.weekday}
                onChange={(event) => setAutomation((current) => ({ ...current, weekday: Number(event.target.value) }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value={0}>Monday</option>
                <option value={1}>Tuesday</option>
                <option value={2}>Wednesday</option>
                <option value={3}>Thursday</option>
                <option value={4}>Friday</option>
                <option value={5}>Saturday</option>
                <option value={6}>Sunday</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Monthly Day</label>
              <input
                type="number"
                min="1"
                max="28"
                value={automation.month_day}
                onChange={(event) => setAutomation((current) => ({ ...current, month_day: Number(event.target.value) }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={handleSaveAutomation}
              disabled={savingAutomation}
              className="rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
            >
              {savingAutomation ? 'Saving Schedule...' : 'Save Automatic Sending'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-primary">Submitted Report History</h2>
              <p className="mt-2 text-sm text-slate-500">View, review, and delete branch reports already submitted to Main Admin.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveTab('active')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === 'active'
                    ? 'bg-primary text-white'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Active Reports ({reportsState.total})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === 'history'
                    ? 'bg-primary text-white'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                Report History ({historyState.total})
              </button>
            </div>
          </div>
        </div>

        {activeTab === 'active' ? (
          <>
            <div className="border-b border-slate-100 px-6 py-3 bg-slate-50">
              <p className="text-sm text-slate-600">
                {reportsState.total} total reports
              </p>
            </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-slate-500">Loading branch reports...</div>
        ) : reportsState.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Title</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Service Type</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Period</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Submitted</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {reportsState.items.map((report) => (
                    <tr key={report.id} className={`${report.is_viewed ? 'hover:bg-slate-50' : 'bg-blue-50/40 ring-1 ring-inset ring-blue-100 hover:bg-blue-50/60'}`}>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-primary">{report.title}</p>
                          {!report.is_viewed ? (
                            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                              New
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{report.report_type}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{report.service_type}</td>
                      <td className="px-6 py-4 text-slate-700">{report.date_from} to {report.date_to}</td>
                      <td className="px-6 py-4 text-slate-500">{report.submitted_at ? formatUtc8DateTime(report.submitted_at) : 'N/A'}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleView(report.id)}
                            disabled={detailsLoading}
                            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleExport(report.id, 'pdf')}
                            disabled={exportingKey === `${report.id}-pdf`}
                            className="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
                          >
                            {exportingKey === `${report.id}-pdf` ? 'PDF...' : 'PDF'}
                          </button>
                          <button
                            onClick={() => handleExport(report.id, 'excel')}
                            disabled={exportingKey === `${report.id}-excel`}
                            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {exportingKey === `${report.id}-excel` ? 'Excel...' : 'Excel'}
                          </button>
                          <button
                            onClick={() => handleDelete(report.id)}
                            disabled={deletingId === report.id}
                            className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingId === report.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">Page {reportsState.page} of {reportsState.total_pages}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => fetchReports(reportsState.page - 1)}
                  disabled={reportsState.page <= 1}
                  className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => fetchReports(reportsState.page + 1)}
                  disabled={reportsState.page >= reportsState.total_pages}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-12 text-center text-slate-500">No submitted branch reports yet.</div>
        )}
          </>
        ) : (
          <>
            <div className="border-b border-slate-100 px-6 py-3 bg-slate-50">
              <p className="text-sm text-slate-600">
                {historyState.total} archived reports
              </p>
            </div>

            {historyLoading ? (
              <div className="px-6 py-12 text-center text-slate-500">Loading report history...</div>
            ) : historyState.items.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Title</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Service Type</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Period</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Submitted</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Deleted</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Deleted By</th>
                        <th className="px-6 py-3 text-left font-semibold text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {historyState.items.map((report) => (
                        <tr key={report.id} className="hover:bg-slate-50">
                          <td className="px-6 py-4">
                            <p className="font-semibold text-primary">{report.title}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{report.report_type}</p>
                          </td>
                          <td className="px-6 py-4 text-slate-700">{report.service_type}</td>
                          <td className="px-6 py-4 text-slate-700">{report.date_from} to {report.date_to}</td>
                          <td className="px-6 py-4 text-slate-500">{report.submitted_at ? formatUtc8DateTime(report.submitted_at) : 'N/A'}</td>
                          <td className="px-6 py-4 text-slate-500">{report.deleted_at ? formatUtc8DateTime(report.deleted_at) : 'N/A'}</td>
                          <td className="px-6 py-4 text-slate-700">{report.deleted_by || 'N/A'}</td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleViewHistoryReport(report)}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-secondary"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">Page {historyState.page} of {historyState.total_pages}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setHistoryState((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                      disabled={historyState.page <= 1}
                      className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setHistoryState((current) => ({ ...current, page: Math.min(historyState.total_pages, current.page + 1) }))}
                      disabled={historyState.page >= historyState.total_pages}
                      className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-6 py-12 text-center text-slate-500">No archived reports yet.</div>
            )}
          </>
        )}
      </section>

      {selectedReport && selectedMetrics ? (
        <ReportMetricsModal
          report={selectedReport}
          metrics={selectedMetrics}
          onClose={() => {
            setSelectedReport(null);
            setSelectedMetrics(null);
          }}
        />
      ) : null}

      <DeleteConfirmationModal
        open={Boolean(reportToDelete)}
        title="Delete this branch report?"
        message={`This will permanently remove "${reportToDelete?.title || 'this submitted report'}" from the branch records.`}
        details={[
          { label: 'Report Type', value: reportToDelete?.report_type || 'N/A' },
          { label: 'Submitted', value: reportToDelete?.submitted_at ? formatUtc8DateTime(reportToDelete.submitted_at) : 'N/A' },
        ]}
        onCancel={() => setReportToDelete(null)}
        onConfirm={() => handleDelete()}
        isLoading={Boolean(deletingId)}
      />

      {historyReportToView && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between px-6 py-6">
              <h3 className="text-xl font-bold text-primary">Report History - {historyReportToView.title}</h3>
              <button
                onClick={() => setHistoryReportToView(null)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-600">Report Type</p>
                  <p className="text-slate-800">{historyReportToView.report_type}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Service Type</p>
                  <p className="text-slate-800">{historyReportToView.service_type}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Transaction Category</p>
                  <p className="text-slate-800">{historyReportToView.transaction_category}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Date Range</p>
                  <p className="text-slate-800">{historyReportToView.date_from} to {historyReportToView.date_to}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Generated By</p>
                  <p className="text-slate-800">{historyReportToView.generated_by}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Submitted By</p>
                  <p className="text-slate-800">{historyReportToView.submitted_by}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Submitted At</p>
                  <p className="text-slate-800">{historyReportToView.submitted_at ? formatUtc8DateTime(historyReportToView.submitted_at) : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Deleted At</p>
                  <p className="text-slate-800">{historyReportToView.deleted_at ? formatUtc8DateTime(historyReportToView.deleted_at) : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Deleted By</p>
                  <p className="text-slate-800">{historyReportToView.deleted_by}</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default BranchReports;
