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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-8 shadow-2xl">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">Discrepancy Report Details</h2>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Report ID</p>
                <p className="mt-1 font-mono font-semibold text-gray-800">DR-{selectedDiscrepancy.id}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Status</p>
                <p className="mt-1 font-semibold text-gray-800">{selectedDiscrepancy.status}</p>
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Branch Report Details</p>
              <div className="rounded-lg border border-gray-200 p-4 whitespace-pre-line text-gray-700">
                {selectedDiscrepancy.description}
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Supporting References</p>
              <div className="rounded-lg border border-gray-200 p-4 text-gray-700">
                {selectedDiscrepancy.supporting_documents || 'No supporting references provided.'}
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Attached File</p>
              <div className="rounded-lg border border-gray-200 p-4 text-gray-700">
                {selectedDiscrepancy.attachment_filename || 'No attachment uploaded.'}
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-5">
              <p className="mb-2 text-sm font-semibold text-blue-900">Main Office Response</p>
              <p className="whitespace-pre-line text-blue-900">
                {selectedDiscrepancy.verification_notes || 'Main Office has not sent a response yet.'}
              </p>
              <p className="mt-3 text-xs text-blue-700">
                {selectedDiscrepancy.verified_by
                  ? `Responded by ${selectedDiscrepancy.verified_by} on ${formatDateTime(selectedDiscrepancy.verified_at || selectedDiscrepancy.updated_at)}`
                  : 'Waiting for main office review.'}
              </p>
            </div>

            <button
              onClick={closeDiscrepancyDetails}
              className="w-full rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchDashboard;
