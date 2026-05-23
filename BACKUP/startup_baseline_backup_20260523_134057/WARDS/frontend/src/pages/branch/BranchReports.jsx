import { useEffect, useMemo, useState } from 'react';
import { branchReportAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8DateTime } from '../../utils/dateTime';
import GeneratedReportContent from '../../components/reports/GeneratedReportContent';
import WardsPageHero from '../../components/WardsPageHero';

const REPORT_TYPES = ['Operational', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual'];
const SERVICE_TYPES = ['All Services', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Document Request'];
const TRANSACTION_CATEGORIES = ['All Categories', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Receipt Request Fee'];
const PAGE_SIZE = 5;

const initialFilters = {
  reportType: 'Operational',
  service_type: 'All Services',
  transaction_category: 'All Categories',
  dateFrom: '',
  dateTo: '',
};

const formatNumber = (value) => Number(value || 0).toLocaleString('en-PH');

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
  if (!report || !metrics) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-3xl bg-slate-50 shadow-2xl">
        <div className="sticky top-0 z-10 flex justify-end border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur md:px-8">
          <button onClick={onClose} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300">
            Close
          </button>
        </div>
        <div className="px-6 py-6 md:px-8">
          <GeneratedReportContent report={report} metrics={metrics} contextLabel="Submitted To Main Admin" />
        </div>
      </div>
    </div>
  );
};

const BranchReports = () => {
  const [filters, setFilters] = useState(initialFilters);
  const [reportsState, setReportsState] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedMetrics, setSelectedMetrics] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const branchStaff = JSON.parse(localStorage.getItem('branchUser') || '{}');

  const fetchReports = async (page = 1) => {
    try {
      setLoading(true);
      const response = await branchReportAPI.getAll({ page, page_size: PAGE_SIZE });
      setReportsState(response.data);
    } catch (fetchError) {
      console.error('Failed to fetch branch reports:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load submitted branch reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

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
      setSelectedReport(response.data.report);
      setSelectedMetrics(response.data.metrics);
      await fetchReports(1);
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
      setSelectedReport(response.data.report);
      setSelectedMetrics(response.data.metrics);
    } catch (viewError) {
      console.error('Failed to load branch report details:', viewError);
      setError(viewError.response?.data?.detail || 'Failed to load report details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm('Delete this submitted branch report?')) {
      return;
    }

    try {
      setDeletingId(reportId);
      setError('');
      await branchReportAPI.delete(reportId);
      const nextPage = reportsState.items.length === 1 && reportsState.page > 1 ? reportsState.page - 1 : reportsState.page;
      await fetchReports(nextPage);
      if (selectedReport?.id === reportId) {
        setSelectedReport(null);
        setSelectedMetrics(null);
      }
    } catch (deleteError) {
      console.error('Failed to delete branch report:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete the report.');
    } finally {
      setDeletingId(null);
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
            <h2 className="text-xl font-bold text-primary">Generate And Submit Report</h2>
            <p className="mt-2 text-sm text-slate-500">
              This branch module generates the report, previews the professional operational layout, and stores it for Main Admin review.
            </p>
          </div>
          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
            Branch ID: {branchStaff.branch_id || 'N/A'}
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

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-primary">Submitted Report History</h2>
              <p className="mt-2 text-sm text-slate-500">View, review, and delete branch reports already submitted to Main Admin.</p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              {reportsState.total} total reports
            </div>
          </div>
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
                    <tr key={report.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-primary">{report.title}</p>
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
    </div>
  );
};

export default BranchReports;
