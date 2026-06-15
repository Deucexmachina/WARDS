import { useEffect, useState } from 'react';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import WardsPageHero from '../../components/WardsPageHero';
import { CustomSelect } from '../../components/FormControls';
import {
  DiscrepancyInfoCard,
  DiscrepancySection,
  DiscrepancyStatusBadge,
  DiscrepancyTimelineEntry,
  discrepancyModalHeaderClass,
  discrepancyModalShellClass,
} from '../../components/discrepancies/DiscrepancyUI';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import { getFriendlyErrorMessage } from '../../utils/errorMessages';
import {
  DISCREPANCY_TITLE_MAX_LENGTH,
  getDiscrepancySubmitErrorMessage,
  getDiscrepancyValidationErrors,
  getDiscrepancyValidationSummary,
  getInitialDiscrepancyForm,
} from '../../utils/discrepancyValidation';

const EMPTY_FORM = getInitialDiscrepancyForm();

const CLOSED_STATUSES = new Set(['Solved', 'Rejected']);

const formatDateTime = (value) => formatUtc8DateTime(value);

const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'Not provided';
  }

  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(Number(value));
};

const getLatestCounterpartyMessage = (report) => {
  const thread = report.conversation_thread || [];
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    if (thread[index].sender_role === 'main_admin') {
      return thread[index];
    }
  }
  return null;
};

const BranchDiscrepancies = () => {
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isBranchAdmin = branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin';
  const branchRoleLabel = isBranchAdmin ? 'Branch Admin' : 'Branch Staff';
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [validationErrors, setValidationErrors] = useState({});
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [replying, setReplying] = useState(false);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await discrepancyAPI.getBranchReports();
      setReports(response.data || []);
    } catch (fetchError) {
      console.error('Failed to load discrepancy reports:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load discrepancy reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
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
      setError(getFriendlyErrorMessage(dateError, 'Failed to load the current Report Date.'));
      return '';
    }
  };

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
    setError('');
  };

  const handleSelectChange = (fieldName) => (value) => {
    handleInputChange({ target: { name: fieldName, value, type: 'select-one', checked: false } });
  };

  const resetForm = () => {
    setFormData(getInitialDiscrepancyForm());
    setValidationErrors({});
    setAttachmentFile(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextValidationErrors = getDiscrepancyValidationErrors(formData);
    if (Object.keys(nextValidationErrors).length) {
      setValidationErrors(nextValidationErrors);
      setError(getDiscrepancyValidationSummary(nextValidationErrors));
      return;
    }
    try {
      setSubmitting(true);
      setError('');
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
      setShowForm(false);
      await fetchReports();
      window.dispatchEvent(new CustomEvent('branch-discrepancy-viewed'));
    } catch (submitError) {
      console.error('Failed to submit discrepancy report:', submitError);
      setError(getDiscrepancySubmitErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const closeDetailsModal = () => {
    setSelectedReport(null);
    setReplyDraft('');
    setShowReplyComposer(false);
  };

  const hasUnreadUpdate = (report) => Boolean(report?.has_unread_for_branch);

  const canReplyToAdmin = (report) =>
    Boolean(
      isBranchAdmin &&
      report &&
      !CLOSED_STATUSES.has(report.status) &&
      (report.conversation_thread || []).some((entry) => entry.sender_role === 'main_admin')
    );

  const handleDownloadAttachment = async (report) => {
    try {
      const response = await discrepancyAPI.downloadBranchAttachment(report.id);
      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = report.attachment_filename || `discrepancy-${report.id}-attachment`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (downloadError) {
      console.error('Failed to download discrepancy attachment:', downloadError);
      setError(downloadError.response?.data?.detail || 'Failed to download attachment.');
    }
  };

  const handleDeleteReport = async (reportId) => {
    try {
      setError('');
      await discrepancyAPI.deleteBranchReport(reportId);
      if (selectedReport?.id === reportId) {
        closeDetailsModal();
      }
      setDeleteConfirmId(null);
      await fetchReports();
      window.dispatchEvent(new CustomEvent('branch-discrepancy-viewed'));
    } catch (deleteError) {
      console.error('Failed to delete discrepancy report:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete discrepancy report.');
    }
  };

  const handleOpenReport = async (report) => {
    try {
      await discrepancyAPI.markBranchViewed(report.id);
      window.dispatchEvent(new CustomEvent('branch-discrepancy-viewed'));
      const response = await discrepancyAPI.getBranchReports();
      const refreshedReport = (response.data || []).find((item) => item.id === report.id) || report;
      setReports(response.data || []);
      setSelectedReport(refreshedReport);
      setReplyDraft('');
      setShowReplyComposer(false);
    } catch (viewError) {
      console.error('Failed to open discrepancy report:', viewError);
      setSelectedReport(report);
      setReplyDraft('');
      setShowReplyComposer(false);
    }
  };

  const handleReplyCancel = () => {
    setReplyDraft('');
    setShowReplyComposer(false);
  };

  const handleSubmitReply = async () => {
    if (!selectedReport || !canReplyToAdmin(selectedReport) || !replyDraft.trim()) {
      return;
    }

    try {
      setReplying(true);
      setError('');
      const response = await discrepancyAPI.replyToAdminResponse(selectedReport.id, {
        reply_notes: replyDraft.trim(),
      });
      setSelectedReport(response.data);
      setReplyDraft('');
      setShowReplyComposer(false);
      await fetchReports();
    } catch (replyError) {
      console.error('Failed to submit branch reply:', replyError);
      setError(replyError.response?.data?.detail || 'Failed to submit branch reply.');
    } finally {
      setReplying(false);
    }
  };

  return (
    <div>
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Discrepancy Reports"
        subtitle="Submit and track discrepancies between system records and official collection records. Every submission is forwarded to Main Office for review, verification, and audit traceability."
        actions={(
          <button
            onClick={async () => {
              const nextShowForm = !showForm;
              setError('');
              if (!nextShowForm) {
                setShowForm(false);
                resetForm();
                return;
              }
              resetForm();
              setShowForm(true);
              await syncTrustedReportDate();
            }}
            className="rounded-2xl bg-blue-900 px-5 py-3 font-semibold text-white transition hover:bg-blue-800"
          >
            {showForm ? 'Cancel Report' : 'Report Discrepancy'}
          </button>
        )}
        className="mb-8"
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} noValidate className="mb-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg">
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
              className={`w-full rounded-2xl border px-4 py-3 ${
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
                className={`w-full rounded-2xl border px-4 py-3 text-slate-700 ${
                  validationErrors.report_date ? 'border-rose-400 bg-rose-50' : 'border-gray-300 bg-slate-50'
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
              <CustomSelect
                value={formData.discrepancy_type}
                onChange={handleSelectChange('discrepancy_type')}
                options={[{ value: '', label: 'Select type' }, { value: 'No Internet Connection', label: 'No Internet Connection' }, { value: 'Slow Internet Connection', label: 'Slow Internet Connection' }, { value: 'Complete Network Outage', label: 'Complete Network Outage' }, { value: 'No Electricity / Power Interruption', label: 'No Electricity / Power Interruption' }, { value: 'Receipt Printer Not Working', label: 'Receipt Printer Not Working' }, { value: 'Flooding in Branch Office', label: 'Flooding in Branch Office' }, { value: 'Branch Closure Due to Emergency', label: 'Branch Closure Due to Emergency' }, { value: 'Revenue Collection Interruption', label: 'Revenue Collection Interruption' }, { value: 'Other', label: 'Other' }]}
                placeholder="Select type"
                hasError={!!validationErrors.discrepancy_type}
              />
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
                className={`w-full rounded-2xl border px-4 py-3 ${
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
              className={`w-full rounded-2xl border px-4 py-3 ${
                validationErrors.description ? 'border-rose-400 bg-rose-50' : 'border-gray-300'
              }`}
              placeholder="Describe the discrepancy and the affected records..."
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
              className="w-full rounded-2xl border border-gray-300 px-4 py-3"
              placeholder="Receipt numbers, file names, batch notes, or collection sheet references"
            />
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Attachment File</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 file:mr-4 file:rounded-xl file:border-0 file:bg-blue-100 file:px-4 file:py-2 file:font-semibold file:text-blue-900"
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
                setShowForm(false);
                resetForm();
                setError('');
              }}
              className="flex-1 rounded-2xl bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-2xl bg-blue-900 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Discrepancy'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-[2rem] bg-white p-6 shadow-lg">
        {loading ? (
          <div className="py-8 text-center text-gray-500">Loading discrepancy reports...</div>
        ) : reports.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No discrepancy reports submitted for this branch yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 md:overflow-hidden">
            <table className="w-full table-auto text-sm min-w-[600px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Report ID</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Status / Resolution</th>
                  <th className="px-4 py-3 text-left">Main Office Update</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reports.map((report) => {
                  const latestAdminMessage = getLatestCounterpartyMessage(report);
                  return (
                    <tr key={report.id} className={hasUnreadUpdate(report) ? 'bg-blue-50' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">DR-{report.id}</span>
                          {hasUnreadUpdate(report) && (
                            <span className="flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900">{report.title}</span>
                      </td>
                      <td className="px-4 py-3">{report.discrepancy_type}</td>
                      <td className="px-4 py-3">
                        <DiscrepancyStatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {latestAdminMessage ? (
                          <div className="flex items-start gap-2">
                            {hasUnreadUpdate(report) && <span className="font-bold text-blue-600">NEW:</span>}
                            <span className="block max-w-xs line-clamp-2">
                              {latestAdminMessage.message || `Status updated to ${latestAdminMessage.status || report.status}.`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">No response yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(report.updated_at || report.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleOpenReport(report)}
                            className="rounded-xl bg-blue-900 px-4 py-2 font-semibold text-white transition hover:bg-blue-800"
                          >
                            View
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(report.id)}
                            className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white transition hover:bg-red-600"
                          >
                            Delete
                          </button>
                        </div>
                        {hasUnreadUpdate(report) && (
                          <p className="mt-2 text-xs font-semibold text-blue-700">Updated / New Reply</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className={discrepancyModalShellClass}>
            <div className={discrepancyModalHeaderClass}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">Discrepancy Report Details</p>
                  <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{selectedReport.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-blue-100">
                    Review the full report, references, attachments, and the latest responses from the main office.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                    {selectedReport.status}
                  </span>
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
                    DR-{selectedReport.id}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto bg-slate-50 p-6 sm:p-8">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <DiscrepancyInfoCard label="Report ID" value={`DR-${selectedReport.id}`} tone="blue" helper="Unique discrepancy tracking reference." />
                <DiscrepancyInfoCard label="Date Submitted" value={formatDateTime(selectedReport.created_at)} tone="amber" helper={`Report date: ${selectedReport.report_date || 'Not provided'}`} />
                  <DiscrepancyInfoCard
                    label="Submitted By"
                    value={selectedReport.reported_by || 'Unknown submitter'}
                    tone="emerald"
                    helper={selectedReport.reported_by_role || `${branchRoleLabel} account`}
                  />
                <DiscrepancyInfoCard
                  label="Branch Information"
                  value={selectedReport.branch_name || 'Current branch'}
                  tone="violet"
                  helper={selectedReport.submitted_offline ? 'Marked as offline collection discrepancy.' : 'Submitted through the branch discrepancy workflow.'}
                />
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  <DiscrepancySection
                    title="Report Information"
                    description="Core submission details presented in a cleaner, audit-ready format."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard label="Discrepancy Type" value={selectedReport.discrepancy_type || 'Not specified'} />
                      <DiscrepancyInfoCard label="Current Status" value={<DiscrepancyStatusBadge status={selectedReport.status} />} />
                      <DiscrepancyInfoCard label="Last Updated" value={formatDateTime(selectedReport.updated_at || selectedReport.created_at)} />
                      <DiscrepancyInfoCard label="Last Main Office Response" value={selectedReport.verified_at ? formatDateTime(selectedReport.verified_at) : 'No response yet'} />
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Queue Information"
                    description="Reference details that help the branch reconcile the affected transaction or batch."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard
                        label="Queue Number / Reference"
                        value={selectedReport.supporting_documents || 'No queue number or reference was supplied.'}
                        helper="Includes receipt numbers, batch notes, or collection references when available."
                      />
                      <DiscrepancyInfoCard
                        label="Submission Channel"
                        value={selectedReport.submitted_offline ? 'Offline collection discrepancy' : 'Standard discrepancy submission'}
                      />
                      <DiscrepancyInfoCard label="System Amount" value={formatCurrency(selectedReport.system_amount)} />
                      <DiscrepancyInfoCard label="Actual Amount" value={formatCurrency(selectedReport.actual_amount)} />
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Variance</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(selectedReport.variance_amount)}</p>
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Reported Issue Details"
                    description="The original discrepancy description submitted by the branch."
                  >
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 whitespace-pre-line">
                      {selectedReport.description}
                    </div>
                  </DiscrepancySection>
                </div>

                <div className="space-y-6">
                  <DiscrepancySection
                    title="Attachments"
                    description="Supporting files linked to this discrepancy report."
                    action={selectedReport.attachment_filename ? (
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(selectedReport)}
                        className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary"
                      >
                        Download File
                      </button>
                    ) : null}
                  >
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4">
                      <p className="text-sm font-semibold text-slate-900">
                        {selectedReport.attachment_filename || 'No attachment uploaded for this report.'}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {selectedReport.attachment_filename
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
                      {(selectedReport.conversation_thread || []).map((entry, index) => (
                        <DiscrepancyTimelineEntry
                          key={`${entry.created_at || 'entry'}-${index}`}
                          entry={entry}
                          formatDateTime={formatDateTime}
                        />
                      ))}
                    </div>
                  </DiscrepancySection>

                  {canReplyToAdmin(selectedReport) && !showReplyComposer && (
                    <button
                      onClick={() => setShowReplyComposer(true)}
                      className="w-full rounded-2xl bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800"
                    >
                      Reply to Main Office
                    </button>
                  )}

                  {!isBranchAdmin && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                      Reply actions are restricted to the authenticated Branch Admin for this branch. You can still review the full discrepancy details and history.
                    </div>
                  )}

                  {canReplyToAdmin(selectedReport) && showReplyComposer && (
                    <DiscrepancySection
                      title="Branch Response"
                      description="Reply directly to the most recent administrative review without leaving the report."
                    >
                      <textarea
                        value={replyDraft}
                        onChange={(event) => setReplyDraft(event.target.value)}
                        rows="5"
                        className="w-full rounded-2xl border border-green-300 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-2 focus:ring-green-500"
                        placeholder="Type your reply here..."
                      ></textarea>
                      <div className="mt-4 flex gap-3">
                        <button
                          onClick={handleSubmitReply}
                          disabled={replying || !replyDraft.trim()}
                          className="flex-1 rounded-2xl bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {replying ? 'Sending Reply...' : 'Send Reply'}
                        </button>
                        <button
                          onClick={handleReplyCancel}
                          disabled={replying}
                          className="flex-1 rounded-2xl bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </DiscrepancySection>
                  )}

                  {isBranchAdmin && CLOSED_STATUSES.has(selectedReport.status) && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                      This discrepancy is closed because it is marked as {selectedReport.status}. Branch replies are disabled.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={closeDetailsModal}
                  className="rounded-2xl bg-slate-700 px-6 py-3 font-semibold text-white transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmationModal
        open={Boolean(deleteConfirmId)}
        title="Delete discrepancy report?"
        message="This removes the discrepancy record and its uploaded attachment from the branch view."
        details={deleteConfirmId ? [
          { label: 'Report ID', value: `DR-${deleteConfirmId}` },
          { label: 'Module', value: 'Discrepancy Reports' },
        ] : []}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => handleDeleteReport(deleteConfirmId)}
      />
    </div>
  );
};

export default BranchDiscrepancies;
