import { useEffect, useState } from 'react';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const statusStyles = {
  'Pending Review': 'bg-yellow-100 text-yellow-800',
  'Under Review': 'bg-blue-100 text-blue-800',
  Verified: 'bg-green-100 text-green-800',
  Responded: 'bg-purple-100 text-purple-800',
  Solved: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-red-100 text-red-800',
};
const CLOSED_STATUSES = new Set(['Solved', 'Rejected']);

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

const getLatestBranchReply = (report) => {
  const thread = report.conversation_thread || [];
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    if (thread[index].sender_role === 'branch_admin') {
      return thread[index];
    }
  }
  return null;
};

const DiscrepancyReports = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState('Verified');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await discrepancyAPI.getAdminReports();
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

  const hasUnreadUpdate = (report) => Boolean(report?.has_unread_for_admin);

  const openVerifyModal = async (report) => {
    try {
      if (hasUnreadUpdate(report)) {
        await discrepancyAPI.markAdminViewed(report.id);
        window.dispatchEvent(new CustomEvent('admin-discrepancy-viewed'));
      }
    } catch (markViewedError) {
      console.error('Failed to mark discrepancy as viewed for admin:', markViewedError);
    }

    setSelectedReport(report);
    setVerificationStatus(report.status || 'Under Review');
    setVerificationNotes(report.verification_notes || '');
    setReplyDraft('');
    setShowReplyComposer(false);
    setReports((currentReports) =>
      currentReports.map((currentReport) =>
        currentReport.id === report.id
          ? { ...currentReport, last_viewed_by_admin: new Date().toISOString(), has_unread_for_admin: false }
          : currentReport
      )
    );
  };

  const closeVerifyModal = () => {
    setSelectedReport(null);
    setVerificationStatus('Verified');
    setVerificationNotes('');
    setReplyDraft('');
    setShowReplyComposer(false);
  };

  const handleDownloadAttachment = async (report) => {
    try {
      const response = await discrepancyAPI.downloadAdminAttachment(report.id);
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

  const handleVerify = async () => {
    if (!selectedReport) {
      return;
    }

    try {
      setSaving(true);
      const response = await discrepancyAPI.verifyReport(selectedReport.id, {
        status: verificationStatus,
        verification_notes: showReplyComposer ? replyDraft : verificationNotes,
      });
      setSelectedReport(response.data);
      setVerificationNotes(response.data.verification_notes || '');
      setReplyDraft('');
      setShowReplyComposer(false);
      await fetchReports();
      window.dispatchEvent(new CustomEvent('admin-discrepancy-reviewed'));
      window.dispatchEvent(new CustomEvent('admin-discrepancy-viewed'));
    } catch (saveError) {
      console.error('Failed to verify discrepancy report:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to update discrepancy report.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteReport = async (reportId) => {
    try {
      setError('');
      await discrepancyAPI.deleteAdminReport(reportId);
      if (selectedReport?.id === reportId) {
        closeVerifyModal();
      }
      setDeleteConfirmId(null);
      await fetchReports();
      window.dispatchEvent(new CustomEvent('admin-discrepancy-reviewed'));
      window.dispatchEvent(new CustomEvent('admin-discrepancy-viewed'));
    } catch (deleteError) {
      console.error('Failed to delete discrepancy report:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete discrepancy report.');
    }
  };

  const handleReplyCancel = () => {
    setReplyDraft('');
    setShowReplyComposer(false);
  };

  const isClosedReport = Boolean(selectedReport && CLOSED_STATUSES.has(selectedReport.status));

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Discrepancy Reports"
        subtitle="Review and verify discrepancy reports submitted by branch personnel. Every report remains archived for traceability, accountability, and audit reference."
        className="mb-8"
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl bg-white p-6 shadow-lg">
        {loading ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-gray-600">Loading discrepancy reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="py-12 text-center text-gray-500">No discrepancy reports submitted yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Report ID</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                  <th className="px-4 py-3 text-left">Status / Resolution</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reports.map((report) => {
                  const latestBranchReply = getLatestBranchReply(report);
                  return (
                    <tr key={report.id} className={hasUnreadUpdate(report) ? 'bg-blue-50' : ''}>
                      <td className="px-4 py-3 font-mono">DR-{report.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{report.title}</span>
                          {hasUnreadUpdate(report) && (
                            <span className="flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{report.branch_name}</td>
                      <td className="px-4 py-3">{report.discrepancy_type}</td>
                      <td className="px-4 py-3">{report.reported_by}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[report.status] || 'bg-slate-100 text-slate-700'}`}>
                          {report.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(report.updated_at || report.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openVerifyModal(report)}
                            className="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(report.id)}
                            className="rounded-lg bg-red-500 px-4 py-2 font-semibold text-white transition hover:bg-red-600"
                          >
                            Delete
                          </button>
                        </div>
                        {hasUnreadUpdate(report) && (
                          <p className="mt-2 text-xs font-semibold text-blue-700">
                            {latestBranchReply ? 'Updated / New Reply' : 'New update'}
                          </p>
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
              <h2 className="text-2xl font-bold text-white">Review Discrepancy Report</h2>
              <p className="mt-1 text-sm text-blue-100">
                Report ID: DR-{selectedReport.id} | {selectedReport.branch_name}
              </p>
            </div>
            <div className="p-8">
              <div className="mb-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
                  <svg className="h-5 w-5 text-blue-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  {selectedReport.title}
                </h3>
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Reported By</p>
                    <p className="mt-1 font-bold text-blue-900">{selectedReport.reported_by}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Discrepancy Type</p>
                    <p className="mt-1 font-semibold text-gray-800">{selectedReport.discrepancy_type}</p>
                  </div>
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

              <div className="mb-5 rounded-lg border-2 border-blue-200 bg-blue-50 p-5">
                <label className="mb-3 block font-bold text-blue-900">Status / Resolution</label>
                <select
                  value={verificationStatus}
                  onChange={(event) => setVerificationStatus(event.target.value)}
                  disabled={isClosedReport}
                  className="w-full rounded-lg border-2 border-blue-300 px-4 py-3 font-semibold focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Pending Review">Pending Review</option>
                  <option value="Under Review">Under Review</option>
                  <option value="Verified">Verified</option>
                  <option value="Responded">Responded</option>
                  <option value="Solved">Solved</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <p className="mt-2 text-xs text-blue-700">
                  Update the status to reflect the current resolution stage of this discrepancy.
                </p>
                {isClosedReport && (
                  <p className="mt-2 text-xs font-semibold text-red-700">
                    This discrepancy is closed. Main Admin can no longer change the status.
                  </p>
                )}
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
                          {entry.status && (
                            <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[entry.status] || 'bg-slate-100 text-slate-700'}`}>
                              {entry.status}
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

              {!showReplyComposer && !isClosedReport && (
                <button
                  onClick={() => {
                    setReplyDraft('');
                    setShowReplyComposer(true);
                  }}
                  className="mb-4 w-full rounded-lg bg-green-600 py-3 font-semibold text-white transition hover:bg-green-700"
                >
                  Reply
                </button>
              )}

              {showReplyComposer && !isClosedReport && (
                <div className="mb-6 rounded-lg border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-blue-100 p-6 shadow-sm">
                  <p className="mb-3 text-sm font-bold text-blue-900">Main Admin Reply</p>
                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    rows="6"
                    className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    placeholder="Type your response here..."
                  ></textarea>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleVerify}
                      disabled={saving || !replyDraft.trim()}
                      className="flex-1 rounded-lg bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Send Reply'}
                    </button>
                    <button
                      onClick={handleReplyCancel}
                      disabled={saving}
                      className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!showReplyComposer && !isClosedReport && (
                <button
                  onClick={handleVerify}
                  disabled={saving}
                  className="mb-4 w-full rounded-lg bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Status Update'}
                </button>
              )}

              {isClosedReport && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  This discrepancy is closed because it is marked as {selectedReport.status}. Main Admin replies and status updates are disabled.
                </div>
              )}

              <button
                onClick={closeVerifyModal}
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

export default DiscrepancyReports;
