import { useEffect, useState } from 'react';
import api from '../../services/api';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { getFriendlyErrorMessage } from '../../utils/errorMessages';
import {
  DISCREPANCY_TITLE_MAX_LENGTH,
  getDiscrepancySubmitErrorMessage,
  getDiscrepancyValidationErrors,
  getInitialDiscrepancyForm,
} from '../../utils/discrepancyValidation';
import {
  DiscrepancyInfoCard,
  DiscrepancySection,
  DiscrepancyStatusBadge,
  DiscrepancyTimelineEntry,
  discrepancyModalHeaderClass,
  discrepancyModalShellClass,
} from '../../components/discrepancies/DiscrepancyUI';

const MetricCard = ({ label, value, color }) => (
  <div className="bg-white rounded-xl shadow p-6">
    <p className="text-sm text-gray-500 mb-2">{label}</p>
    <p className={`text-3xl font-bold ${color}`}>{value}</p>
  </div>
);

const BranchDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [discrepancyLoading, setDiscrepancyLoading] = useState(true);
  const [discrepancyError, setDiscrepancyError] = useState('');
  const [showDiscrepancyForm, setShowDiscrepancyForm] = useState(false);
  const [submittingDiscrepancy, setSubmittingDiscrepancy] = useState(false);
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState(null);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [formData, setFormData] = useState(getInitialDiscrepancyForm());
  const [validationErrors, setValidationErrors] = useState({});

  const fetchDashboard = async () => {
    try {
      const [response, discrepancyResponse] = await Promise.all([
        api.get('/branch/dashboard'),
        discrepancyAPI.getBranchReports(),
      ]);
      setData(response.data);
      setDiscrepancies(discrepancyResponse.data || []);
      setDiscrepancyError('');
    } catch (error) {
      console.error('Failed to load branch dashboard:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to load discrepancy records.');
    } finally {
      setLoading(false);
      setDiscrepancyLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000);
    return () => clearInterval(interval);
  }, []);

  const syncTrustedReportDate = async () => {
    try {
      const response = await discrepancyAPI.getBranchReportDate();
      const trustedReportDate = response.data?.report_date || '';
      if (trustedReportDate) {
        setFormData((previous) => ({
          ...previous,
          report_date: trustedReportDate,
        }));
      }
      return trustedReportDate;
    } catch (dateError) {
      console.error('Failed to load trusted discrepancy report date:', dateError);
      setDiscrepancyError(getFriendlyErrorMessage(dateError, 'Failed to load the current Report Date.'));
      return '';
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-purple-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading branch dashboard...</p>
        </div>
      </div>
    );
  }

  const maxTrend = Math.max(
    1,
    ...(data?.activity_trend || []).map((item) => item.waiting + item.serving + item.completed)
  );

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setValidationErrors((current) => {
      if (!current[name]) {
        return current;
      }
      const next = { ...current };
      delete next[name];
      return next;
    });
    setDiscrepancyError('');
  };

  const resetForm = () => {
    setFormData(getInitialDiscrepancyForm());
    setValidationErrors({});
    setAttachmentFile(null);
  };

  const closeDiscrepancyDetails = () => {
    setSelectedDiscrepancy(null);
  };

  const handleSubmitDiscrepancy = async (event) => {
    event.preventDefault();
    const nextValidationErrors = getDiscrepancyValidationErrors(formData);
    if (Object.keys(nextValidationErrors).length) {
      setValidationErrors(nextValidationErrors);
      setDiscrepancyError('Please correct the highlighted discrepancy fields before submitting.');
      return;
    }
    try {
      setSubmittingDiscrepancy(true);
      setDiscrepancyError('');
      setValidationErrors({});
      const trustedReportDate = await syncTrustedReportDate();
      const payload = new FormData();
      payload.append('title', formData.title.trim());
      payload.append('report_date', trustedReportDate || formData.report_date);
      payload.append('discrepancy_type', formData.discrepancy_type.trim());
      payload.append('description', formData.description.trim());
      payload.append('other_specification', formData.other_specification.trim());
      payload.append('supporting_documents', formData.supporting_documents.trim());
      payload.append('submitted_offline', String(formData.submitted_offline));
      if (attachmentFile) {
        payload.append('attachment', attachmentFile);
      }
      await discrepancyAPI.createBranchReport(payload);
      resetForm();
      setShowDiscrepancyForm(false);
      await fetchDashboard();
      window.dispatchEvent(new CustomEvent('branch-discrepancy-viewed'));
    } catch (error) {
      console.error('Failed to submit discrepancy report:', error);
      setDiscrepancyError(getDiscrepancySubmitErrorMessage(error));
    } finally {
      setSubmittingDiscrepancy(false);
    }
  };

  const recentDiscrepancies = discrepancies.slice(0, 5);
  const pendingDiscrepancies = discrepancies.filter((report) => report.status === 'Pending Review').length;
  const verifiedDiscrepancies = discrepancies.filter((report) => report.status === 'Verified').length;
  const offlineDiscrepancies = discrepancies.filter((report) => report.submitted_offline).length;
  const formatCurrency = (value) => value === null || value === undefined ? 'N/A' : `PHP ${Number(value).toLocaleString()}`;
  const formatDateTime = (value) => formatUtc8DateTime(value);
  const formatDiscrepancyCurrency = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Not provided';
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(Number(value));
  };

  return (
    <div>
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title={data?.branch?.name || 'Branch Dashboard'}
        subtitle={data?.branch?.location || 'Monitor branch queue activity, transactions, and service operations from one dashboard.'}
        actions={(
          <div className="text-right">
            <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800">
              {data?.branch?.status || 'Active'}
            </span>
            <p className="text-xs text-gray-500 mt-2">
              Auto-refreshing every 15 seconds
            </p>
          </div>
        )}
        className="mb-8"
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <MetricCard label="Waiting Clients" value={data?.queue?.waiting || 0} color="text-orange-600" />
        <MetricCard label="Currently Serving" value={data?.queue?.serving || 0} color="text-blue-600" />
        <MetricCard label="Completed Queue" value={data?.queue?.completed || 0} color="text-green-600" />
        <MetricCard label="Completed Today" value={data?.transactions?.today_completed || 0} color="text-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Service Activity Trend</h2>
          <div className="h-64 flex items-end gap-4">
            {(data?.activity_trend || []).map((item) => {
              const total = item.waiting + item.serving + item.completed;
              return (
                <div key={item.label} className="flex-1 flex flex-col items-center gap-2">
                  <div className="h-48 w-full flex items-end bg-gray-50 rounded overflow-hidden">
                    <div
                      className="w-full bg-purple-500 rounded-t"
                      style={{ height: `${Math.max(4, (total / maxTrend) * 100)}%` }}
                      title={`${total} queue events`}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-500">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Payments</h2>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-600">Pending</span>
              <strong className="text-yellow-600">{data?.transactions?.payments_pending || 0}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Confirmed</span>
              <strong className="text-green-600">{data?.transactions?.payments_confirmed || 0}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Failed</span>
              <strong className="text-red-600">{data?.transactions?.payments_failed || 0}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Queue Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">Queue No.</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Taxpayer</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.recent_queue || []).map((queue) => (
                <tr key={queue.id}>
                  <td className="px-4 py-3 font-semibold">{queue.queue_number}</td>
                  <td className="px-4 py-3">{queue.service_type}</td>
                  <td className="px-4 py-3">{queue.taxpayer_name || 'Walk-in'}</td>
                  <td className="px-4 py-3 capitalize">{queue.status}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {queue.created_at ? formatUtc8DateTime(queue.created_at) : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl shadow p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Discrepancy Reporting Module</h2>
            <p className="mt-2 text-sm text-gray-600 max-w-3xl">
              Report discrepancies between system records and official collection records. Submitted reports are
              forwarded directly to Main Office for review, verification, traceability, and accountability.
            </p>
          </div>
          <button
            onClick={async () => {
              setDiscrepancyError('');
              const nextShowForm = !showDiscrepancyForm;
              if (!nextShowForm) {
                setShowDiscrepancyForm(false);
                resetForm();
                return;
              }
              resetForm();
              setShowDiscrepancyForm(true);
              await syncTrustedReportDate();
            }}
            className="rounded-lg bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700"
          >
            {showDiscrepancyForm ? 'Cancel Report' : 'Report Discrepancy'}
          </button>
        </div>

        {discrepancyError && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {discrepancyError}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard label="Pending Review" value={pendingDiscrepancies} color="text-yellow-600" />
          <MetricCard label="Verified Reports" value={verifiedDiscrepancies} color="text-green-600" />
          <MetricCard label="Submitted Offline" value={offlineDiscrepancies} color="text-blue-600" />
        </div>

        {showDiscrepancyForm && (
          <form onSubmit={handleSubmitDiscrepancy} noValidate className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-6">
            {Object.keys(validationErrors).length ? (
              <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                Please correct the highlighted discrepancy fields before submitting.
              </div>
            ) : null}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">Title / Subject</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                aria-invalid={validationErrors.title ? 'true' : 'false'}
                className={`w-full rounded-lg border px-4 py-3 ${
                  validationErrors.title ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
                }`}
                placeholder="e.g., System Error - Queue Registration Failed, Payment Record Mismatch"
                maxLength={DISCREPANCY_TITLE_MAX_LENGTH}
                required
              />
              {validationErrors.title ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{validationErrors.title}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">Report Date</label>
                <input
                  type="text"
                  name="report_date"
                  value={formData.report_date}
                  readOnly
                  aria-readonly="true"
                  aria-invalid={validationErrors.report_date ? 'true' : 'false'}
                  className={`w-full rounded-lg border px-4 py-3 text-slate-700 ${
                    validationErrors.report_date ? 'border-rose-400 bg-rose-50' : 'border-gray-300 bg-slate-100'
                  }`}
                  required
                />
                {validationErrors.report_date ? (
                  <p className="mt-2 text-xs font-medium text-rose-600">{validationErrors.report_date}</p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Automatically generated from the WARDS system date.</p>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">Discrepancy Type</label>
                <select
                  name="discrepancy_type"
                  value={formData.discrepancy_type}
                  onChange={handleInputChange}
                  aria-invalid={validationErrors.discrepancy_type ? 'true' : 'false'}
                  className={`w-full rounded-lg border px-4 py-3 ${
                    validationErrors.discrepancy_type ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
                  }`}
                  required
                >
                  <option value="">Select type</option>
                    <option value="No Internet Connection">No Internet Connection</option>
                    <option value="Slow Internet Connection">Slow Internet Connection</option>
                    <option value="Complete Network Outage">Complete Network Outage</option>
                    <option value="No Electricity / Power Interruption">No Electricity / Power Interruption</option>
                    <option value="Receipt Printer Not Working">Receipt Printer Not Working</option>
                    <option value="Flooding in Branch Office">Flooding in Branch Office</option>
                    <option value="Branch Closure Due to Emergency">Branch Closure Due to Emergency</option>
                    <option value="Revenue Collection Interruption">Revenue Collection Interruption</option>
                    <option value="Other">Other</option>
                </select>
                {validationErrors.discrepancy_type ? (
                  <p className="mt-2 text-xs font-medium text-rose-600">{validationErrors.discrepancy_type}</p>
                ) : null}
              </div>
            </div>

            {formData.discrepancy_type === 'Other' && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-gray-700">Specify Discrepancy Type</label>
                <textarea
                  name="other_specification"
                  value={formData.other_specification}
                  onChange={handleInputChange}
                  rows="3"
                  aria-invalid={validationErrors.other_specification ? 'true' : 'false'}
                  className={`w-full rounded-lg border px-4 py-3 ${
                    validationErrors.other_specification ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
                  }`}
                  placeholder="Provide the exact discrepancy category or special circumstance."
                  required
                ></textarea>
                {validationErrors.other_specification ? (
                  <p className="mt-2 text-xs font-medium text-rose-600">{validationErrors.other_specification}</p>
                ) : null}
              </div>
            )}

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">Discrepancy Details</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows="5"
                aria-invalid={validationErrors.description ? 'true' : 'false'}
                className={`w-full rounded-lg border px-4 py-3 ${
                  validationErrors.description ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
                }`}
                placeholder="Describe the discrepancy, affected receipts, and collection records..."
                required
              ></textarea>
              {validationErrors.description ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{validationErrors.description}</p>
              ) : null}
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">Supporting References</label>
              <input
                type="text"
                name="supporting_documents"
                value={formData.supporting_documents}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="Receipt numbers, file names, OR references, or offline batch notes"
              />
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">Attachment File</label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 file:mr-4 file:rounded-md file:border-0 file:bg-purple-100 file:px-4 file:py-2 file:font-semibold file:text-purple-700"
              />
              <p className="mt-2 text-xs text-gray-500">Accepted files: PDF, PNG, or JPEG only.</p>
            </div>

            <label className="mt-4 flex items-center gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                name="submitted_offline"
                checked={formData.submitted_offline}
                onChange={handleInputChange}
              />
              Submit as an offline collection discrepancy
            </label>

            <div className="mt-6 flex gap-4">
              <button
                type="button"
                onClick={() => {
                  setShowDiscrepancyForm(false);
                  resetForm();
                  setDiscrepancyError('');
                }}
                className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingDiscrepancy}
                className="flex-1 rounded-lg bg-purple-600 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
              >
                {submittingDiscrepancy ? 'Submitting...' : 'Submit Discrepancy'}
              </button>
            </div>
          </form>
        )}

        {discrepancyLoading ? (
          <div className="py-8 text-center text-gray-500">Loading discrepancy reports...</div>
        ) : recentDiscrepancies.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No discrepancy reports submitted for this branch yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Report ID</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Variance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Main Office Response</th>
                  <th className="px-4 py-3 text-left">Offline</th>
                  <th className="px-4 py-3 text-left">Verified By</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentDiscrepancies.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-3 font-mono">DR-{report.id}</td>
                    <td className="px-4 py-3">{report.discrepancy_type}</td>
                    <td className="px-4 py-3 font-semibold text-red-600">{formatCurrency(report.variance_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        report.status === 'Verified'
                          ? 'bg-green-100 text-green-800'
                          : report.status === 'Rejected'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {report.verification_notes ? (
                        <span className="line-clamp-2 max-w-xs block">{report.verification_notes}</span>
                      ) : (
                        <span className="text-gray-400">No response yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{report.submitted_offline ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3">{report.verified_by || 'Pending'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedDiscrepancy(report)}
                        className="rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white transition hover:bg-purple-700"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDiscrepancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className={discrepancyModalShellClass}>
            <div className={discrepancyModalHeaderClass}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">Discrepancy Report Details</p>
                  <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{selectedDiscrepancy.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-blue-100">
                    Review the full report, references, attachments, and the latest responses from the main office.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <DiscrepancyStatusBadge status={selectedDiscrepancy.status} className="border-white/20 bg-white/10 text-white" />
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
                    DR-{selectedDiscrepancy.id}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto bg-slate-50 p-6 sm:p-8">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <DiscrepancyInfoCard label="Report ID" value={`DR-${selectedDiscrepancy.id}`} tone="blue" helper="Unique discrepancy tracking reference." />
                <DiscrepancyInfoCard label="Date Submitted" value={formatDateTime(selectedDiscrepancy.created_at)} tone="amber" helper={`Report date: ${selectedDiscrepancy.report_date || 'Not provided'}`} />
                <DiscrepancyInfoCard
                  label="Submitted By"
                  value={selectedDiscrepancy.reported_by || 'Unknown submitter'}
                  tone="emerald"
                  helper={selectedDiscrepancy.reported_by_role || 'Branch personnel'}
                />
                <DiscrepancyInfoCard
                  label="Branch Information"
                  value={selectedDiscrepancy.branch_name || 'Current branch'}
                  tone="violet"
                  helper={selectedDiscrepancy.submitted_offline ? 'Marked as offline collection discrepancy.' : 'Submitted through the branch discrepancy workflow.'}
                />
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  <DiscrepancySection
                    title="Report Information"
                    description="Core submission details presented in a cleaner, audit-ready format."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard label="Discrepancy Type" value={selectedDiscrepancy.discrepancy_type || 'Not specified'} />
                      <DiscrepancyInfoCard label="Current Status" value={<DiscrepancyStatusBadge status={selectedDiscrepancy.status} />} />
                      <DiscrepancyInfoCard label="Last Updated" value={formatDateTime(selectedDiscrepancy.updated_at || selectedDiscrepancy.created_at)} />
                      <DiscrepancyInfoCard label="Last Main Office Response" value={selectedDiscrepancy.verified_at ? formatDateTime(selectedDiscrepancy.verified_at) : 'No response yet'} />
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Queue Information"
                    description="Reference details that help the branch reconcile the affected transaction or batch."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard
                        label="Queue Number / Reference"
                        value={selectedDiscrepancy.supporting_documents || 'No queue number or reference was supplied.'}
                        helper="Includes receipt numbers, batch notes, or collection references when available."
                      />
                      <DiscrepancyInfoCard
                        label="Submission Channel"
                        value={selectedDiscrepancy.submitted_offline ? 'Offline collection discrepancy' : 'Standard discrepancy submission'}
                      />
                      <DiscrepancyInfoCard label="System Amount" value={formatDiscrepancyCurrency(selectedDiscrepancy.system_amount)} />
                      <DiscrepancyInfoCard label="Actual Amount" value={formatDiscrepancyCurrency(selectedDiscrepancy.actual_amount)} />
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Variance</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{formatDiscrepancyCurrency(selectedDiscrepancy.variance_amount)}</p>
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Reported Issue Details"
                    description="The original discrepancy description submitted by the branch."
                  >
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 whitespace-pre-line">
                      {selectedDiscrepancy.description}
                    </div>
                  </DiscrepancySection>
                </div>

                <div className="space-y-6">
                  <DiscrepancySection
                    title="Attachments"
                    description="Supporting files linked to this discrepancy report."
                    action={selectedDiscrepancy.attachment_filename ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const response = await discrepancyAPI.downloadBranchAttachment(selectedDiscrepancy.id);
                            const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
                            const link = document.createElement('a');
                            link.href = fileUrl;
                            link.download = selectedDiscrepancy.attachment_filename || `discrepancy-${selectedDiscrepancy.id}-attachment`;
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                            window.URL.revokeObjectURL(fileUrl);
                          } catch (downloadError) {
                            console.error('Failed to download discrepancy attachment:', downloadError);
                            setDiscrepancyError(downloadError.response?.data?.detail || 'Failed to download attachment.');
                          }
                        }}
                        className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary"
                      >
                        Download File
                      </button>
                    ) : null}
                  >
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4">
                      <p className="text-sm font-semibold text-slate-900">
                        {selectedDiscrepancy.attachment_filename || 'No attachment uploaded for this report.'}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {selectedDiscrepancy.attachment_filename
                          ? 'Use the download action to review the original evidence submitted with this discrepancy.'
                          : 'Historical records without file uploads remain supported and will continue to display correctly.'}
                      </p>
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Review History / Responses"
                    description="Chronological responses with clear administrator identity, role, timestamp, and status."
                  >
                    <div className="space-y-4">
                      {(selectedDiscrepancy.conversation_thread || []).length > 0 ? (
                        (selectedDiscrepancy.conversation_thread || []).map((entry, index) => (
                          <DiscrepancyTimelineEntry
                            key={`${entry.created_at || 'entry'}-${index}`}
                            entry={entry}
                            formatDateTime={formatDateTime}
                          />
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">No responses yet.</p>
                      )}
                    </div>
                  </DiscrepancySection>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={closeDiscrepancyDetails}
                  className="rounded-2xl bg-slate-700 px-6 py-3 font-semibold text-white transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchDashboard;
