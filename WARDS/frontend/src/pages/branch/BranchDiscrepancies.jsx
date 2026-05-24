import { useEffect, useState } from 'react';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const statusStyles = {
  'Pending Review': 'bg-yellow-100 text-yellow-800',
  'Under Review': 'bg-blue-100 text-blue-800',
  Verified: 'bg-green-100 text-green-800',
  Fixed: 'bg-teal-100 text-teal-800',
  Responded: 'bg-purple-100 text-purple-800',
  Solved: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-red-100 text-red-800',
};

const EMPTY_FORM = {
  title: '',
  report_date: '',
  discrepancy_type: '',
  description: '',
  other_specification: '',
  supporting_documents: '',
  submitted_offline: false,
};
const CLOSED_STATUSES = new Set(['Solved', 'Rejected']);

const getTodayDate = () => {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().split('T')[0];
};

const formatDateTime = (value) => formatUtc8DateTime(value);

const getThreadRoleLabel = (entry) => {
  if (entry.label) return entry.label;
  if (entry.sender_role === 'initial_report') return 'Branch Admin Reported';
  if (entry.sender_role === 'main_admin') return 'Main Admin Reply';
  if (entry.sender_role === 'branch_admin') return 'Branch Admin Reply';
  return 'Branch Admin Reported';
};

const getThreadCardStyles = (entry) => {
  if (entry.sender_role === 'main_admin') {
    return 'border-blue-200 bg-blue-50';
  }
  return 'border-green-200 bg-green-50';
};

const getThreadStatusLabel = (entry) => {
  if (!entry.status) return null;
  return entry.status;
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
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [replying, setReplying] = useState(false);
  const todayDate = getTodayDate();

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

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((previous) => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setAttachmentFile(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      if (formData.report_date < todayDate) {
        throw new Error("Report date cannot be earlier than today's date.");
      }
      if (!formData.title || !formData.title.trim()) {
        throw new Error('Title/Subject is required.');
      }
      if (formData.discrepancy_type === 'Other' && !formData.other_specification.trim()) {
        throw new Error('Please provide additional details for the "Other" discrepancy type.');
      }
      const payload = new FormData();
      payload.append('title', formData.title);
      payload.append('report_date', formData.report_date);
      payload.append('discrepancy_type', formData.discrepancy_type);
      payload.append('description', formData.description);
      payload.append('other_specification', formData.other_specification || '');
      payload.append('supporting_documents', formData.supporting_documents || '');
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
      setError(submitError.response?.data?.detail || submitError.message || 'Failed to submit discrepancy report.');
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
            onClick={() => setShowForm((previous) => !previous)}
            className="rounded-lg bg-blue-900 px-5 py-3 font-semibold text-white transition hover:bg-blue-800"
          >
            {showForm ? 'Cancel Report' : 'Report Discrepancy'}
          </button>
        )}
        className="mb-8"
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Title / Subject</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              placeholder="e.g., System Error - Queue Registration Failed, Payment Record Mismatch"
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Report Date</label>
              <input
                type="date"
                name="report_date"
                value={formData.report_date}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                min={todayDate}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Discrepancy Type</label>
              <select
                name="discrepancy_type"
                value={formData.discrepancy_type}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                required
              >
                <option value="">Select type</option>
                <option value="Collection Variance">Collection Variance</option>
                <option value="Official Record Mismatch">Official Record Mismatch</option>
                <option value="Missing Transaction">Missing Transaction</option>
                <option value="Duplicate Entry">Duplicate Entry</option>
                <option value="Offline Collection Encoding">Offline Collection Encoding</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {formData.discrepancy_type === 'Other' && (
            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700">Specify Other Discrepancy</label>
              <textarea
                name="other_specification"
                value={formData.other_specification}
                onChange={handleInputChange}
                rows="3"
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="Provide the exact discrepancy category or special circumstance."
                required
              ></textarea>
            </div>
          )}

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Discrepancy Details</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              rows="5"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              placeholder="Describe the discrepancy and the affected records..."
              required
            ></textarea>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Supporting References</label>
            <input
              type="text"
              name="supporting_documents"
              value={formData.supporting_documents}
              onChange={handleInputChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              placeholder="Receipt numbers, file names, batch notes, or collection sheet references"
            />
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Attachment File</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 file:mr-4 file:rounded-md file:border-0 file:bg-blue-100 file:px-4 file:py-2 file:font-semibold file:text-blue-900"
            />
            <p className="mt-2 text-xs text-gray-500">Accepted files: PDF, image, DOC, or DOCX.</p>
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
              }}
              className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-900 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Discrepancy'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl bg-white p-6 shadow">
        {loading ? (
          <div className="py-8 text-center text-gray-500">Loading discrepancy reports...</div>
        ) : reports.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No discrepancy reports submitted for this branch yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
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
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900">{report.title}</span>
                      </td>
                      <td className="px-4 py-3">{report.discrepancy_type}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[report.status] || 'bg-slate-100 text-slate-700'}`}>
                          {report.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {latestAdminMessage ? (
                          <div className="flex items-start gap-2">
                            {hasUnreadUpdate(report) && <span className="text-blue-600 font-bold">NEW:</span>}
                            <span className="line-clamp-2 max-w-xs block">
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
                            className="rounded-lg bg-blue-900 px-4 py-2 font-semibold text-white transition hover:bg-blue-800"
                          >
                            View
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(report.id)}
                            className="rounded-lg bg-red-500 px-4 py-2 font-semibold text-white transition hover:bg-red-600"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 rounded-t-xl bg-primary px-8 py-6">
              <h2 className="text-2xl font-bold text-white">Discrepancy Report Details</h2>
              <p className="mt-1 text-sm text-blue-100">Report ID: DR-{selectedReport.id}</p>
            </div>
            <div className="p-8">
              <div className="mb-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
                  <svg className="h-5 w-5 text-blue-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  {selectedReport.title}
                </h3>
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Status</p>
                    <p className="mt-1 font-bold text-blue-900">{selectedReport.status}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Reported By</p>
                    <p className="mt-1 font-semibold text-gray-800">{selectedReport.reported_by}</p>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-gradient-to-br from-green-50 to-green-100 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Last Updated</p>
                    <p className="mt-1 font-semibold text-green-900">{formatDateTime(selectedReport.updated_at || selectedReport.created_at)}</p>
                  </div>
                </div>
              </div>

              <div className="mb-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
                  <svg className="h-4 w-4 text-blue-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"></path>
                  </svg>
                  Discrepancy Type
                </p>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <span className="inline-block rounded-full bg-blue-900 px-3 py-1 text-sm font-semibold text-white">
                    {selectedReport.discrepancy_type}
                  </span>
                </div>
              </div>

              <div className="mb-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
                  <svg className="h-4 w-4 text-blue-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
                  </svg>
                  Attached File
                </p>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-gray-700">
                  {selectedReport.attachment_filename ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-blue-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                        </svg>
                        <span className="font-medium">{selectedReport.attachment_filename}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(selectedReport)}
                        className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
                      >
                        Download
                      </button>
                    </div>
                  ) : (
                    <span className="italic text-gray-500">No attachment uploaded.</span>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <h4 className="mb-4 text-lg font-bold text-gray-900">Communication Thread</h4>
                <div className="space-y-4">
                  {(selectedReport.conversation_thread || []).map((entry, index) => (
                    <div key={`${entry.created_at || 'entry'}-${index}`} className={`rounded-xl border p-5 ${getThreadCardStyles(entry)}`}>
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{getThreadRoleLabel(entry)}</p>
                          <p className="text-xs font-medium text-gray-600">{entry.sender_name || 'System'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium text-gray-600">{formatDateTime(entry.created_at)}</p>
                          {getThreadStatusLabel(entry) && (
                            <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[getThreadStatusLabel(entry)] || 'bg-slate-100 text-slate-700'}`}>
                              {getThreadStatusLabel(entry)}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="whitespace-pre-line leading-relaxed text-gray-800">
                        {entry.message || 'Status updated without additional message.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {canReplyToAdmin(selectedReport) && !showReplyComposer && (
                <button
                  onClick={() => setShowReplyComposer(true)}
                  className="mb-4 w-full rounded-lg bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800"
                >
                  Reply
                </button>
              )}

              {canReplyToAdmin(selectedReport) && showReplyComposer && (
                <div className="mb-6 rounded-lg border-2 border-green-300 bg-gradient-to-br from-green-50 to-green-100 p-6 shadow-sm">
                  <p className="mb-3 text-sm font-bold text-green-900">Reply to Main Admin</p>
                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    rows="5"
                    className="w-full rounded-lg border border-green-300 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-2 focus:ring-green-500"
                    placeholder="Type your reply here..."
                  ></textarea>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleSubmitReply}
                      disabled={replying || !replyDraft.trim()}
                      className="flex-1 rounded-lg bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {replying ? 'Sending Reply...' : 'Send Reply'}
                    </button>
                    <button
                      onClick={handleReplyCancel}
                      disabled={replying}
                      className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isBranchAdmin && selectedReport && CLOSED_STATUSES.has(selectedReport.status) && (
                <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  This discrepancy is closed because it is marked as {selectedReport.status}. Branch replies are disabled.
                </div>
              )}

              <button
                onClick={closeDetailsModal}
                className="w-full rounded-lg bg-gray-600 py-3 font-semibold text-white transition hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-bold text-gray-900">Confirm Deletion</h3>
              <p className="text-gray-600">Are you sure you want to delete this discrepancy report?</p>
              <p className="mt-2 text-sm text-gray-500">This action cannot be undone.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteReport(deleteConfirmId)}
                className="flex-1 rounded-lg bg-red-600 py-3 font-semibold text-white transition hover:bg-red-700"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchDiscrepancies;
