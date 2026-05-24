import { useEffect, useMemo, useState } from 'react';
import { branchAPI, reportAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8DateTime } from '../../utils/dateTime';
import GeneratedReportContent from '../../components/reports/GeneratedReportContent';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';

const PAGE_SIZE = 5;
const SERVICE_TYPE_OPTIONS = ['All Services', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Document Request'];
const TRANSACTION_CATEGORY_OPTIONS = ['All Categories', 'Real Property Tax', 'Business Tax', 'Miscellaneous Tax', 'Receipt Request Fee'];

const initialFilters = {
  search: '',
  branch: '',
  service_type: '',
  transaction_category: '',
  date_from: '',
  date_to: '',
};

const formatNumber = (value) => Number(value || 0).toLocaleString('en-PH');

const SummaryCard = ({ label, value, helper }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className="mt-3 text-2xl font-bold text-primary">{value}</p>
    {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
  </div>
);

const buildExportFilename = (response, fallback) => {
  const disposition = response.headers?.['content-disposition'] || response.headers?.['Content-Disposition'];
  const match = disposition?.match(/filename="?(?<filename>[^"]+)"?/i);
  return match?.groups?.filename || fallback;
};

const downloadBlobResponse = (response, fallbackName) => {
  const blobUrl = window.URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = buildExportFilename(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
};

const sanitizeFilters = (filters) => ({
  search: filters.search.trim(),
  branch: filters.branch,
  service_type: filters.service_type,
  transaction_category: filters.transaction_category,
  date_from: filters.date_from,
  date_to: filters.date_to,
});

const getInvalidDateRangeMessage = (dateFrom, dateTo) => {
  if (!dateFrom || !dateTo) {
    return '';
  }

  return dateFrom <= dateTo
    ? ''
    : 'Invalid date range. "Date To" must be the same as or later than "Date From".';
};

const ReportDetailModal = ({ report, metrics, onClose, onExport, exportingFormat }) => {
  if (!report || !metrics) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-3xl bg-slate-50 shadow-2xl">
        <div className="sticky top-0 z-10 flex flex-wrap justify-end gap-3 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur md:px-8">
          <button
            onClick={() => onExport(report.id, 'pdf')}
            disabled={exportingFormat === 'pdf'}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
          >
            {exportingFormat === 'pdf' ? 'Exporting PDF...' : 'Export PDF'}
          </button>
          <button
            onClick={() => onExport(report.id, 'excel')}
            disabled={exportingFormat === 'excel'}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {exportingFormat === 'excel' ? 'Exporting Excel...' : 'Export Excel'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-6 md:px-8">
          <GeneratedReportContent report={report} metrics={metrics} contextLabel="Main Admin Review" />
        </div>
      </div>
    </div>
  );
};

const Reports = () => {
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [reportsState, setReportsState] = useState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [branches, setBranches] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [exportingKey, setExportingKey] = useState('');
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedMetrics, setSelectedMetrics] = useState(null);
  const [reportToDelete, setReportToDelete] = useState(null);

  const fetchBranches = async () => {
    try {
      const response = await branchAPI.getAll();
      setBranches(response.data || []);
    } catch (fetchError) {
      console.error('Failed to fetch branches:', fetchError);
    }
  };

  const fetchReports = async (page, nextFilters) => {
    try {
      setLoading(true);
      setError('');
      const response = await reportAPI.getAll({
        ...sanitizeFilters(nextFilters),
        page,
        page_size: PAGE_SIZE,
      });
      setReportsState(response.data);
    } catch (fetchError) {
      console.error('Failed to fetch reports:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load submitted branch reports.');
      setReportsState({ items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchReports(currentPage, appliedFilters);
  }, [currentPage, appliedFilters]);

  const summary = useMemo(() => ({
    total: reportsState.total || 0,
    currentPageCount: reportsState.items.length,
    visibleBranches: new Set(reportsState.items.map((report) => report.branch).filter(Boolean)).size,
    latestSubmission: reportsState.items[0]?.submitted_at || null,
  }), [reportsState]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleApplyFilters = () => {
    const dateRangeError = getInvalidDateRangeMessage(filters.date_from, filters.date_to);
    if (dateRangeError) {
      setError(dateRangeError);
      return;
    }

    setError('');
    setCurrentPage(1);
    setAppliedFilters(sanitizeFilters(filters));
  };

  const handleResetFilters = () => {
    setError('');
    setFilters(initialFilters);
    setCurrentPage(1);
    setAppliedFilters(initialFilters);
  };

  const handleView = async (reportId) => {
    try {
      setDetailsLoading(true);
      setError('');
      const response = await reportAPI.getDetails(reportId);
      setSelectedReport(response.data.report);
      setSelectedMetrics(response.data.metrics);
    } catch (viewError) {
      console.error('Failed to load report details:', viewError);
      setError(viewError.response?.data?.detail || 'Failed to load report details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleExport = async (reportId, format) => {
    const key = `${reportId}-${format}`;
    try {
      setExportingKey(key);
      const response = await reportAPI.export(reportId, format);
      downloadBlobResponse(response, `branch-report-${reportId}.${format === 'pdf' ? 'pdf' : 'xls'}`);
    } catch (exportError) {
      console.error(`Failed to export report as ${format}:`, exportError);
      setError(exportError.response?.data?.detail || `Failed to export the report as ${format.toUpperCase()}.`);
    } finally {
      setExportingKey('');
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
      await reportAPI.delete(reportToDelete.id);
      if (selectedReport?.id === reportToDelete.id) {
        setSelectedReport(null);
        setSelectedMetrics(null);
      }
      const nextPage = reportsState.items.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      setCurrentPage(nextPage);
      if (nextPage === currentPage) {
        fetchReports(nextPage, appliedFilters);
      }
      setReportToDelete(null);
    } catch (deleteError) {
      console.error('Failed to delete report:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete the report.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Branch Reports"
        subtitle="Receive branch-submitted reports, review operational performance, filter historical records, and export clean documents for monitoring and analysis."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Stored Reports" value={formatNumber(summary.total)} helper="Historical reports across branches" />
        <SummaryCard label="Reports On Page" value={formatNumber(summary.currentPageCount)} helper="Maximum 5 reports per page" />
        <SummaryCard label="Branches Visible" value={formatNumber(summary.visibleBranches)} helper="Current filtered result set" />
        <SummaryCard label="Latest Submission" value={summary.latestSubmission ? formatUtc8Date(summary.latestSubmission) : 'N/A'} helper="Most recent visible report" />
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{error}</p>
        </div>
      ) : null}

      <section className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-primary">Search And Filter Reports</h2>
          <p className="mt-2 text-sm text-slate-500">
            Narrow the report history by branch office, service type, transaction category, reporting date, or keyword.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="xl:col-span-3">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Search</label>
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilterChange}
              placeholder="Search by title, branch office, or generated by"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Branch Office</label>
            <select name="branch" value={filters.branch} onChange={handleFilterChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="">All Branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.name}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Service Type</label>
            <select name="service_type" value={filters.service_type} onChange={handleFilterChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="">All Services</option>
              {SERVICE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Transaction Category</label>
            <select
              name="transaction_category"
              value={filters.transaction_category}
              onChange={handleFilterChange}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="">All Categories</option>
              {TRANSACTION_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Date From</label>
            <input type="date" name="date_from" max={filters.date_to || undefined} value={filters.date_from} onChange={handleFilterChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Date To</label>
            <input type="date" name="date_to" min={filters.date_from || undefined} value={filters.date_to} onChange={handleFilterChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          </div>
        </div>

        {getInvalidDateRangeMessage(filters.date_from, filters.date_to) ? (
          <p className="mt-4 text-sm font-medium text-red-600">
            {getInvalidDateRangeMessage(filters.date_from, filters.date_to)}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button onClick={handleApplyFilters} className="rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-secondary">
            Apply Filters
          </button>
          <button onClick={handleResetFilters} className="rounded-xl bg-slate-200 px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-300">
            Reset Filters
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-primary">Submitted Report Inbox</h2>
              <p className="mt-2 text-sm text-slate-500">Main Admin can view, export, and delete reports submitted by branches.</p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              {reportsState.total} matching reports
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-slate-500">Loading submitted branch reports...</div>
        ) : reportsState.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Branch Office</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Report</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Service Type</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Transaction Category</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Date Range</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Submitted</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {reportsState.items.map((report) => {
                    const pdfKey = `${report.id}-pdf`;
                    const excelKey = `${report.id}-excel`;
                    return (
                      <tr key={report.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <p className="font-semibold text-primary">{report.branch}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{report.generated_by || 'Branch Submission'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-800">{report.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{report.report_type}</p>
                        </td>
                        <td className="px-6 py-4 text-slate-700">{report.service_type}</td>
                        <td className="px-6 py-4 text-slate-700">{report.transaction_category || 'All Categories'}</td>
                        <td className="px-6 py-4 text-slate-700">{report.date_from || 'N/A'} to {report.date_to || 'N/A'}</td>
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
                              disabled={exportingKey === pdfKey}
                              className="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
                            >
                              {exportingKey === pdfKey ? 'PDF...' : 'PDF'}
                            </button>
                            <button
                              onClick={() => handleExport(report.id, 'excel')}
                              disabled={exportingKey === excelKey}
                              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {exportingKey === excelKey ? 'Excel...' : 'Excel'}
                            </button>
                            <button
                              onClick={() => handleDelete(report.id)}
                              disabled={deletingId === report.id}
                              className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                            >
                              {deletingId === report.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">Page {reportsState.page} of {reportsState.total_pages}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={reportsState.page <= 1}
                  className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage((page) => Math.min(reportsState.total_pages, page + 1))}
                  disabled={reportsState.page >= reportsState.total_pages}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-12 text-center text-slate-500">No submitted reports match the current filters.</div>
        )}
      </section>

      {selectedReport && selectedMetrics ? (
        <ReportDetailModal
          report={selectedReport}
          metrics={selectedMetrics}
          onClose={() => {
            setSelectedReport(null);
            setSelectedMetrics(null);
          }}
          onExport={handleExport}
          exportingFormat={exportingKey === `${selectedReport.id}-pdf` ? 'pdf' : exportingKey === `${selectedReport.id}-excel` ? 'excel' : ''}
        />
      ) : null}

      <DeleteConfirmationModal
        open={Boolean(reportToDelete)}
        title="Delete this submitted report?"
        message={`This will permanently remove "${reportToDelete?.title || 'this branch report'}" from the main admin records.`}
        details={[
          { label: 'Branch', value: reportToDelete?.branch || 'N/A' },
          { label: 'Submitted', value: reportToDelete?.submitted_at ? formatUtc8DateTime(reportToDelete.submitted_at) : 'N/A' },
        ]}
        onCancel={() => setReportToDelete(null)}
        onConfirm={() => handleDelete()}
        isLoading={Boolean(deletingId)}
      />
    </div>
  );
};

export default Reports;
