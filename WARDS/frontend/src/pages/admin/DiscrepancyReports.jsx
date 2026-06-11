import { useEffect, useMemo, useState } from 'react';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import WardsPageHero from '../../components/WardsPageHero';
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

const getLatestBranchReply = (report) => {
  const thread = report.conversation_thread || [];
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    if (thread[index].sender_role === 'branch_admin' || thread[index].sender_role === 'branch_staff') {
      return thread[index];
    }
  }
  return null;
};

const buildPendingActionMessage = (report) => {
  if (!report) return 'Review the discrepancy details and determine the next resolution step.';
  if (CLOSED_STATUSES.has(report.status)) {
    return `This report is already ${report.status}. Historical responses remain available for audit review.`;
  }
  if (report.has_unread_for_admin) {
    return 'A new branch update is waiting for administrative review.';
  }
  if (report.status === 'Pending Review') {
    return 'Initial assessment is needed. Confirm the issue and move it into the appropriate resolution stage.';
  }
  if (report.status === 'Under Review') {
    return 'Continue investigating the discrepancy and communicate the next required action to the branch if needed.';
  }
  return 'Review the current status, add resolution notes if needed, and save the updated administrative action.';
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
      setVerificationStatus(response.data.status || verificationStatus);
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

  const pendingActionMessage = useMemo(
    () => buildPendingActionMessage(selectedReport),
    [selectedReport],
  );

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Discrepancy Reports"
        subtitle="Review and verify discrepancy reports submitted by branch personnel. Every report remains archived for traceability, accountability, and audit reference."
        className="mb-8"
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[2rem] bg-white p-6 shadow-lg">
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
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{report.branch_name}</td>
                      <td className="px-4 py-3">{report.discrepancy_type}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{report.reported_by}</div>
                        <div className="text-xs text-slate-500">{report.reported_by_role || 'Branch personnel'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <DiscrepancyStatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(report.updated_at || report.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openVerifyModal(report)}
                            className="rounded-xl bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary"
                          >
                            Review
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(report.id)}
                            className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white transition hover:bg-red-600"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className={discrepancyModalShellClass}>
            <div className={discrepancyModalHeaderClass}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">Review Discrepancy Report</p>
                  <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{selectedReport.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-blue-100">
                    Review the original submission, understand prior responses, and apply the next administrative action with clear audit context.
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
                <DiscrepancyInfoCard label="Branch" value={selectedReport.branch_name} tone="blue" helper="Origin of the discrepancy report." />
                <DiscrepancyInfoCard
                  label="Submitted By"
                  value={selectedReport.reported_by || 'Unknown submitter'}
                  tone="emerald"
                  helper={selectedReport.reported_by_role || 'Branch personnel'}
                />
                <DiscrepancyInfoCard
                  label="Date Submitted"
                  value={formatDateTime(selectedReport.created_at)}
                  tone="amber"
                  helper={`Report date: ${selectedReport.report_date || 'Not provided'}`}
                />
                <DiscrepancyInfoCard
                  label="Pending Action"
                  value={isClosedReport ? 'Audit only' : 'Review required'}
                  tone="violet"
                  helper={pendingActionMessage}
                />
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
                <div className="space-y-6">
                  <DiscrepancySection
                    title="Original Report Details"
                    description="What was reported, who submitted it, and the primary discrepancy context."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard label="Discrepancy Type" value={selectedReport.discrepancy_type || 'Not specified'} />
                      <DiscrepancyInfoCard label="Current Status" value={<DiscrepancyStatusBadge status={selectedReport.status} />} />
                      <DiscrepancyInfoCard label="Submitted Offline" value={selectedReport.submitted_offline ? 'Yes' : 'No'} />
                      <DiscrepancyInfoCard label="Last Updated" value={formatDateTime(selectedReport.updated_at || selectedReport.created_at)} />
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 whitespace-pre-line">
                      {selectedReport.description}
                    </div>
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Supporting Information"
                    description="References, amounts, and attachments relevant to the review."
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <DiscrepancyInfoCard
                        label="Queue Number / Reference"
                        value={selectedReport.supporting_documents || 'No queue or reference details supplied.'}
                        helper="Includes receipt numbers, collection sheet references, or other branch notes."
                      />
                      <DiscrepancyInfoCard
                        label="Attachment"
                        value={selectedReport.attachment_filename || 'No attachment uploaded'}
                        helper={selectedReport.attachment_filename ? 'Use the download button to inspect the submitted evidence.' : 'Older reports remain fully readable even without uploaded files.'}
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
                    title="Review History"
                    description="Chronological responses showing the exact administrator or branch participant involved."
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
                </div>

                <div className="space-y-6">
                  <DiscrepancySection
                    title="Administrative Actions"
                    description="Update the resolution stage and communicate next steps to the branch."
                  >
                    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                      {pendingActionMessage}
                    </div>
                    <div className="mt-4">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Status / Resolution</label>
                      <select
                        value={verificationStatus}
                        onChange={(event) => setVerificationStatus(event.target.value)}
                        disabled={isClosedReport}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-semibold focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Pending Review">Pending Review</option>
                        <option value="Under Review">Under Review</option>
                        <option value="Verified">Verified</option>
                        <option value="Responded">Responded</option>
                        <option value="Solved">Solved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </div>

                    {!showReplyComposer && (
                      <div className="mt-4">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Resolution Notes</label>
                        <textarea
                          value={verificationNotes}
                          onChange={(event) => setVerificationNotes(event.target.value)}
                          rows="6"
                          disabled={isClosedReport || saving}
                          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                          placeholder="Document the review findings, instructions to the branch, or final resolution notes."
                        ></textarea>
                      </div>
                    )}

                    {!showReplyComposer && !isClosedReport && (
                      <div className="mt-4 flex flex-col gap-3">
                        <button
                          onClick={handleVerify}
                          disabled={saving}
                          className="w-full rounded-2xl bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save Administrative Update'}
                        </button>
                        <button
                          onClick={() => {
                            setReplyDraft('');
                            setShowReplyComposer(true);
                          }}
                          className="w-full rounded-2xl bg-green-600 py-3 font-semibold text-white transition hover:bg-green-700"
                        >
                          Send Reply to Branch
                        </button>
                      </div>
                    )}

                    {showReplyComposer && !isClosedReport && (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Administrative Reply</label>
                        <textarea
                          value={replyDraft}
                          onChange={(event) => setReplyDraft(event.target.value)}
                          rows="6"
                          className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                          placeholder="Type the response that should appear in the discrepancy history."
                        ></textarea>
                        <div className="mt-4 flex gap-3">
                          <button
                            onClick={handleVerify}
                            disabled={saving || !replyDraft.trim()}
                            className="flex-1 rounded-2xl bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Send Reply'}
                          </button>
                          <button
                            onClick={handleReplyCancel}
                            disabled={saving}
                            className="flex-1 rounded-2xl bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {isClosedReport && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                        This discrepancy is closed because it is marked as {selectedReport.status}. Main Admin replies and status updates are disabled.
                      </div>
                    )}
                  </DiscrepancySection>

                  <DiscrepancySection
                    title="Resolution Notes"
                    description="Current administrative resolution details and latest accountable reviewer."
                  >
                    <div className="space-y-4">
                      <DiscrepancyInfoCard
                        label="Last Reviewed By"
                        value={selectedReport.verified_by || 'No administrator response yet'}
                        helper={selectedReport.verified_by_role || 'Administrative response pending'}
                      />
                      <DiscrepancyInfoCard
                        label="Last Review Timestamp"
                        value={selectedReport.verified_at ? formatDateTime(selectedReport.verified_at) : 'No review timestamp yet'}
                      />
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Current Notes</p>
                        <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">
                          {selectedReport.verification_notes || 'No administrative resolution notes have been saved yet.'}
                        </p>
                      </div>
                    </div>
                  </DiscrepancySection>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={closeVerifyModal}
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
        message="This removes the report from the administrative discrepancy archive and deletes any uploaded attachment."
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

export default DiscrepancyReports;
