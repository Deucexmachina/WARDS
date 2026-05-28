import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import api, { receiptAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { announceQueue, recallQueue, isAnnouncementActive } from '../../utils/queueAnnouncement';

const PAGE_SIZE = 10;
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_QUEUE_STATUSES = ['appointment', 'waiting', 'called', 'serving'];

const statusClasses = {
  appointment: 'bg-slate-100 text-slate-800',
  waiting: 'bg-amber-100 text-amber-800',
  called: 'bg-orange-100 text-orange-800',
  serving: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-rose-100 text-rose-800',
};

const queueTypeLabels = {
  immediate: 'Immediate',
  appointment: 'Appointment',
};

const queueWindowLabels = {
  RPT: 'RPT',
  BUSINESS: 'BT',
  MISC: 'MISC',
  QW4: 'Queue Window 4',
  QW5: 'Queue Window 5',
};

const BRANCH_QUEUE_UPDATED_EVENT = 'branch-queue-updated';

const resolveReceiptCategory = (queue) => {
  const serviceWindow = (queue?.service_window || '').toUpperCase();
  const serviceType = (queue?.service_type || '').toLowerCase();
  if (serviceWindow === 'RPT' || serviceType.includes('rpt') || serviceType.includes('real property')) {
    return 'RPT';
  }
  if (serviceWindow === 'BUSINESS' || serviceType.includes('business') || serviceType.includes('permit') || serviceType.includes('bt')) {
    return 'BUSINESS';
  }
  return 'MISC';
};

const defaultReceiptDraft = (queue) => ({
  ref_number: '',
  txn_id: '',
  taxpayer_name: queue?.taxpayer_name || '',
  transaction_date: '',
  amount: '',
  tax_type: resolveReceiptCategory(queue),
  selected_category: resolveReceiptCategory(queue),
  detected_category: resolveReceiptCategory(queue),
  category_match: true,
  confidence: 0,
  raw_text: '',
});

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateInputValue = (value) => {
  const parsed = parseDate(value);
  if (!parsed) {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(parsed);
};

const formatTimeInputValue = (value) => {
  const parsed = parseDate(value);
  if (!parsed) {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(parsed);
};

const formatTimeLabel = (value) => {
  const parsed = parseDate(value);
  if (!parsed) {
    return 'N/A';
  }
  return parsed.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatAppointmentDateTimeLabel = (value) => {
  const parsed = parseDate(value);
  if (!parsed) {
    return 'N/A';
  }
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

const getRelevantDateTime = (queue) => queue.appointment_time || queue.completed_at || queue.served_at || queue.created_at;

const getDerivedStatus = (queue, now = new Date()) => {
  const baseStatus = (queue.status || '').toLowerCase();
  if (queue.queue_type === 'appointment' && baseStatus === 'waiting') {
    const appointmentTime = parseDate(queue.appointment_time);
    if (appointmentTime && appointmentTime > now) {
      return 'appointment';
    }
  }
  return baseStatus || 'waiting';
};

const getStatusLabel = (queue, now = new Date()) => {
  const derivedStatus = getDerivedStatus(queue, now);
  if (derivedStatus === 'appointment') {
    return 'Appointment';
  }
  if (derivedStatus === 'waiting') {
    return 'Waiting';
  }
  if (derivedStatus === 'called') {
    return 'Called';
  }
  if (derivedStatus === 'serving') {
    return 'Serving';
  }
  if (derivedStatus === 'completed') {
    return 'Completed';
  }
  if (derivedStatus === 'skipped') {
    return 'Skipped';
  }
  return queue.status_label || queue.status || 'Waiting';
};

const sortQueues = (queues, now) => {
  const activeQueues = [];
  const archivedQueues = [];

  queues.forEach((queue) => {
    const derivedStatus = getDerivedStatus(queue, now);
    if (ACTIVE_QUEUE_STATUSES.includes(derivedStatus)) {
      activeQueues.push(queue);
    } else {
      archivedQueues.push(queue);
    }
  });

  activeQueues.sort((left, right) => {
    const rightDate = parseDate(getRelevantDateTime(right))?.getTime() || 0;
    const leftDate = parseDate(getRelevantDateTime(left))?.getTime() || 0;
    return rightDate - leftDate;
  });

  archivedQueues.sort((left, right) => {
    const rightDate = parseDate(right.completed_at || right.served_at || right.created_at)?.getTime() || 0;
    const leftDate = parseDate(left.completed_at || left.served_at || left.created_at)?.getTime() || 0;
    return rightDate - leftDate;
  });

  return [...activeQueues, ...archivedQueues];
};

const paginateQueues = (queues, page) => {
  const totalPages = Math.max(1, Math.ceil(queues.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    items: queues.slice(startIndex, startIndex + PAGE_SIZE),
  };
};

const QueueSection = ({
  title,
  description,
  queues,
  page,
  onPageChange,
  queueUnavailable,
  onAction,
  onDeleteRequest,
  now,
  skippedOnly = false,
}) => {
  const paginated = useMemo(() => paginateQueues(queues, page), [queues, page]);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow">
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-primary">{title}</h2>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </div>
          <div className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            {queues.length} entr{queues.length === 1 ? 'y' : 'ies'}
          </div>
        </div>
      </div>

      {queues.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          No queue records match the current filters for this section.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white">
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="px-6 py-3 font-semibold">Queue No.</th>
                  <th className="px-6 py-3 font-semibold">Taxpayer</th>
                  <th className="px-6 py-3 font-semibold">Service</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Date / Time</th>
                  <th className="px-6 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.items.map((queue) => {
                  const derivedStatus = getDerivedStatus(queue, now);
                  const relevantDateTime = getRelevantDateTime(queue);

                  return (
                    <tr key={queue.id} className="align-top hover:bg-slate-50/80">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-primary">{queue.queue_number}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                          {queueTypeLabels[queue.queue_type] || 'Immediate'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-800">{queue.taxpayer_name || 'Walk-in'}</p>
                        <p className="mt-1 text-xs text-slate-500">{queue.email || queue.contact_number || 'No contact provided'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-800">{queue.service_type}</p>
                        {queue.estimated_wait_time ? (
                          <p className="mt-1 text-xs text-slate-500">Estimated wait: {queue.estimated_wait_time} min</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[derivedStatus] || 'bg-slate-100 text-slate-700'}`}>
                          {getStatusLabel(queue, now)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        <p className="font-medium text-slate-700">
                          {queue.queue_type === 'appointment' && queue.appointment_time
                            ? formatAppointmentDateTimeLabel(queue.appointment_time)
                            : (relevantDateTime ? formatUtc8DateTime(relevantDateTime) : 'N/A')}
                        </p>
                        {queue.queue_type === 'appointment' && queue.appointment_time ? (
                          <p className="mt-1 text-xs text-slate-500">Slot: {formatTimeLabel(queue.appointment_time)}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {skippedOnly || derivedStatus === 'skipped' ? (
                            <button
                              onClick={() => onAction('recall-skipped', queue)}
                              disabled={queueUnavailable}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                            >
                              Pull Up
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => onAction('serve', queue)}
                                disabled={(queue.status || '').toLowerCase() !== 'called' || queueUnavailable}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                              >
                                Serve
                              </button>
                              <button
                                onClick={() => onAction('skip', queue)}
                                disabled={!['called', 'serving'].includes((queue.status || '').toLowerCase()) || queueUnavailable}
                                className="rounded-lg bg-slate-600 px-3 py-1.5 font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
                              >
                                Skip
                              </button>
                              <button
                                onClick={() => onAction('complete', queue)}
                                disabled={(queue.status || '').toLowerCase() !== 'serving' || queueUnavailable}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                              >
                                Complete
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => onDeleteRequest(queue)}
                            disabled={queueUnavailable}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40"
                          >
                            Delete
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
            <p className="text-sm text-slate-500">
              Showing page {paginated.currentPage} of {paginated.totalPages}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => onPageChange(Math.max(1, paginated.currentPage - 1))}
                disabled={paginated.currentPage <= 1}
                className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-60"
              >
                Previous
              </button>
              <button
                onClick={() => onPageChange(Math.min(paginated.totalPages, paginated.currentPage + 1))}
                disabled={paginated.currentPage >= paginated.totalPages}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

const QueueHistorySection = ({
  title,
  description,
  items,
  searchValue,
  onSearchChange,
  onDeleteHistory,
  deletingHistoryId,
}) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-primary">{title}</h2>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
          <div className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            {items.length} completed entr{items.length === 1 ? 'y' : 'ies'}
          </div>
          <input
            type="text"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search taxpayer name"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none md:w-80"
          />
        </div>
      </div>
    </div>

    {items.length === 0 ? (
      <div className="px-6 py-10 text-center text-sm text-slate-500">
        No completed queue history found for this category.
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white">
            <tr className="border-b border-slate-100 text-left text-slate-500">
              <th className="px-6 py-3 font-semibold">Queue No.</th>
              <th className="px-6 py-3 font-semibold">Taxpayer</th>
              <th className="px-6 py-3 font-semibold">Queue Type</th>
              <th className="px-6 py-3 font-semibold">Service</th>
              <th className="px-6 py-3 font-semibold">Status</th>
              <th className="px-6 py-3 font-semibold">Completed</th>
              <th className="px-6 py-3 font-semibold">Completed By</th>
              <th className="px-6 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((queue) => (
              <tr key={queue.id} className="align-top hover:bg-slate-50/80">
                <td className="px-6 py-4">
                  <p className="font-semibold text-primary">{queue.queue_number}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                    {queueWindowLabels[queue.service_window] || queue.service_window || 'MISC'}
                  </p>
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium text-slate-800">{queue.taxpayer_name || 'Walk-in'}</p>
                  <p className="mt-1 text-xs text-slate-500">{queue.email || queue.contact_number || 'No contact provided'}</p>
                </td>
                <td className="px-6 py-4 text-slate-700">
                  {queueTypeLabels[queue.queue_type] || 'Immediate'}
                </td>
                <td className="px-6 py-4 text-slate-700">{queue.service_type || 'N/A'}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {queue.status_label || 'Completed'}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  {queue.completed_at ? formatUtc8DateTime(queue.completed_at) : 'N/A'}
                </td>
                <td className="px-6 py-4 text-slate-700">{queue.completed_by || 'N/A'}</td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => onDeleteHistory(queue)}
                    disabled={deletingHistoryId === queue.id}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40"
                  >
                    {deletingHistoryId === queue.id ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

const QueueManagement = () => {
  const { branchSlug } = useParams();
  const navigate = useNavigate();
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isSuperadminManagedBranch = Boolean(branchUser?.superadmin_managed_branch);
  const isQueueWindowAccount = branchUser?.account_scope === 'queue_window';
  const isBranchAdmin = !isSuperadminManagedBranch && (branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin');
  const assignedWindowLabel = branchUser?.service_window === 'BUSINESS' ? 'BT' : (branchUser?.service_window || '');
  const assignedWindowKey = branchUser?.service_window || 'MISC';
  const managedWindowAccounts = Array.isArray(branchUser?.window_accounts) ? branchUser.window_accounts : [];
  const [queues, setQueues] = useState([]);
  const [queueHistory, setQueueHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [systemStatus, setSystemStatus] = useState(null);
  const [queueToDelete, setQueueToDelete] = useState(null);
  const [historyToDelete, setHistoryToDelete] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingQueueId, setDeletingQueueId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [queueTypeFilter, setQueueTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [timeSlotFilter, setTimeSlotFilter] = useState('');
  const [serviceTypeFilter, setServiceTypeFilter] = useState('all');
  const [windowFilter, setWindowFilter] = useState('all');
  const [queueNumberFilter, setQueueNumberFilter] = useState('');
  const [isAnnouncementPlaying, setIsAnnouncementPlaying] = useState(false);
  const [lastCalledQueue, setLastCalledQueue] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [historySearch, setHistorySearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
  });
  const [completionQueue, setCompletionQueue] = useState(null);
  const [completionMode, setCompletionMode] = useState('options');
  const [completionError, setCompletionError] = useState('');
  const [completionNotice, setCompletionNotice] = useState('');
  const [receiptSavedForCompletion, setReceiptSavedForCompletion] = useState(false);
  const [showCancelCompletionConfirm, setShowCancelCompletionConfirm] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState(null);
  const [receiptUploadFile, setReceiptUploadFile] = useState(null);
  const [processingReceipt, setProcessingReceipt] = useState(false);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [completingQueueId, setCompletingQueueId] = useState(null);
  const [mobileSession, setMobileSession] = useState(null);
  const [immediatePage, setImmediatePage] = useState(1);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [skippedPage, setSkippedPage] = useState(1);

  const dispatchQueueStateUpdate = (nextQueues) => {
    window.dispatchEvent(new CustomEvent(BRANCH_QUEUE_UPDATED_EVENT, {
      detail: {
        queues: Array.isArray(nextQueues) ? nextQueues : [],
      },
    }));
  };

  const fetchQueues = async () => {
    try {
      const [queueResponse, historyResponse, statusResponse] = await Promise.all([
        api.get('/branch/queue'),
        api.get('/branch/queue/history'),
        api.get('/public/system-status'),
      ]);
      const nextQueues = queueResponse.data || [];
      setQueues(nextQueues);
      setQueueHistory(historyResponse.data || []);
      setSystemStatus(statusResponse.data);
      setError('');
      dispatchQueueStateUpdate(nextQueues);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setImmediatePage(1);
    setAppointmentPage(1);
    setSkippedPage(1);
  }, [queueTypeFilter, statusFilter, dateFilter, timeSlotFilter, serviceTypeFilter, windowFilter, queueNumberFilter, searchFilter]);

  const windowOptions = useMemo(() => {
    const fromAccounts = managedWindowAccounts.map((account) => ({
      key: account.service_window,
      label: account.window_label || queueWindowLabels[account.service_window] || account.service_window,
      username: account.username,
    })).filter((item) => item.key);
    const seen = new Set(fromAccounts.map((item) => item.key));
    queues.forEach((queue) => {
      const key = queue.service_window || 'MISC';
      if (!seen.has(key)) {
        seen.add(key);
        fromAccounts.push({ key, label: queueWindowLabels[key] || key, username: '' });
      }
    });
    return fromAccounts;
  }, [managedWindowAccounts, queues]);

  const openDeleteModal = (queue) => {
    setQueueToDelete(queue);
    setHistoryToDelete(null);
    setShowDeleteModal(true);
  };

  const openDeleteHistoryModal = (queueHistoryItem) => {
    setHistoryToDelete(queueHistoryItem);
    setQueueToDelete(queueHistoryItem);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deletingQueueId !== null || deletingHistoryId !== null) {
      return;
    }
    setQueueToDelete(null);
    setHistoryToDelete(null);
    setShowDeleteModal(false);
  };

  const resetCompletionFlow = () => {
    setCompletionQueue(null);
    setCompletionMode('options');
    setCompletionError('');
    setCompletionNotice('');
    setReceiptSavedForCompletion(false);
    setShowCancelCompletionConfirm(false);
    setReceiptDraft(null);
    setReceiptUploadFile(null);
    setProcessingReceipt(false);
    setSavingReceipt(false);
    setCompletingQueueId(null);
    setMobileSession(null);
  };

  const completeQueueDirectly = async (queue) => {
    try {
      setCompletingQueueId(queue.id);
      setCompletionError('');
      setCompletionNotice('');
      await api.post(`/branch/queue/${queue.id}/complete`);
      await fetchQueues();
      resetCompletionFlow();
      return true;
    } catch (err) {
      setCompletionError(err.response?.data?.detail || 'Failed to complete queue.');
      return false;
    } finally {
      setCompletingQueueId(null);
    }
  };

  const handleFileReceiptUpload = async (event) => {
    event.preventDefault();
    if (!receiptUploadFile || !completionQueue) {
      setCompletionError('Choose a receipt image before running OCR.');
      return;
    }

    const category = resolveReceiptCategory(completionQueue);
    const formData = new FormData();
    formData.append('file', receiptUploadFile);
    formData.append('category', category);

    try {
      setProcessingReceipt(true);
      setCompletionError('');
      setCompletionNotice('');
      const response = await receiptAPI.uploadForOCR(formData);
      setReceiptDraft({
        ...defaultReceiptDraft(completionQueue),
        ...response.data,
        tax_type: response.data?.tax_type || category,
        selected_category: response.data?.selected_category || category,
      });
      setCompletionMode('review');
    } catch (err) {
      setCompletionError(err.response?.data?.detail || 'Failed to parse receipt image.');
    } finally {
      setProcessingReceipt(false);
    }
  };

  const startMobileReceiptUpload = async () => {
    if (!completionQueue) {
      return;
    }
    try {
      setProcessingReceipt(true);
      setCompletionError('');
      setCompletionNotice('');
      const response = await receiptAPI.createMobileUploadSession({
        queue_id: completionQueue.id,
        category: resolveReceiptCategory(completionQueue),
      });
      setMobileSession(response.data);
      setCompletionMode('mobile');
    } catch (err) {
      setCompletionError(err.response?.data?.detail || 'Failed to create mobile upload QR.');
    } finally {
      setProcessingReceipt(false);
    }
  };

  const checkMobileReceiptUpload = async () => {
    if (!mobileSession?.token) {
      return;
    }
    try {
      setProcessingReceipt(true);
      setCompletionError('');
      const response = await receiptAPI.getMobileUploadSession(mobileSession.token);
      setMobileSession((current) => ({ ...current, ...response.data }));
      if (response.data?.status === 'saved') {
        setReceiptSavedForCompletion(true);
        setCompletionNotice('Receipt already uploaded and saved to Receipt Management. You can now complete this queue.');
        setReceiptDraft(null);
        setCompletionMode('options');
      } else if (response.data?.status === 'processed' && response.data?.result) {
        setReceiptDraft({
          ...defaultReceiptDraft(completionQueue),
          ...response.data.result,
        });
        setCompletionMode('review');
      } else if (response.data?.status === 'error') {
        setCompletionError(response.data?.error || 'Mobile receipt upload failed.');
      }
    } catch (err) {
      setCompletionError(err.response?.data?.detail || 'Failed to check mobile upload status.');
    } finally {
      setProcessingReceipt(false);
    }
  };

  const handleReceiptDraftChange = (event) => {
    const { name, value } = event.target;
    setReceiptDraft((current) => ({
      ...current,
      [name]: name === 'amount' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const saveReceiptAndCompleteQueue = async () => {
    if (!completionQueue || !receiptDraft) {
      return;
    }
    try {
      setSavingReceipt(true);
      setCompletionError('');
      setCompletionNotice('');
      const category = resolveReceiptCategory(completionQueue);
      await receiptAPI.saveRecord({
        ...receiptDraft,
        amount: receiptDraft.amount === '' ? null : receiptDraft.amount,
        tax_type: receiptDraft.tax_type || category,
        selected_category: receiptDraft.selected_category || category,
        detected_category: receiptDraft.detected_category || category,
        category_match: receiptDraft.category_match !== false,
      });
      setReceiptSavedForCompletion(true);
      setCompletionNotice('Receipt uploaded and saved to Receipt Management. You can now complete this queue.');
      setReceiptDraft(null);
      setReceiptUploadFile(null);
      setCompletionMode('options');
    } catch (err) {
      setCompletionError(err.response?.data?.detail || 'Failed to save receipt.');
    } finally {
      setSavingReceipt(false);
    }
  };

  const performAction = async (action, queue = null) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }

    try {
      if (action === 'call-next') {
        const response = await api.post('/branch/queue/call-next');
        const calledQueue = response.data;
        await fetchQueues();
        if (calledQueue && calledQueue.queue_number) {
          // Store last called queue for recall feature
          setLastCalledQueue({
            queue_number: calledQueue.queue_number,
            service_type: calledQueue.service_type
          });
          
          setIsAnnouncementPlaying(true);
          try {
            await announceQueue(calledQueue.queue_number, calledQueue.service_type);
          } catch (announcementError) {
            console.error('Voice announcement failed:', announcementError);
          } finally {
            setIsAnnouncementPlaying(false);
          }
        }
        return;
      } else if (action === 'recall') {
        // Recall (replay) the last called queue announcement
        if (lastCalledQueue && lastCalledQueue.queue_number) {
          setIsAnnouncementPlaying(true);
          try {
            await recallQueue(lastCalledQueue.queue_number, lastCalledQueue.service_type);
          } catch (announcementError) {
            console.error('Recall announcement failed:', announcementError);
          } finally {
            setIsAnnouncementPlaying(false);
          }
        }
        return;
      } else if (action === 'delete-skipped') {
        await api.delete('/branch/queue/skipped');
      } else if (action === 'delete') {
        setDeletingQueueId(queue.id);
        await api.delete(`/branch/queue/${queue.id}`);
      } else if (action === 'delete-history') {
        setDeletingHistoryId(queue.id);
        await api.delete(`/branch/queue/history/${queue.id}`);
      } else if (action === 'complete') {
        setCompletionQueue(queue);
        setCompletionMode('options');
        setCompletionError('');
        setCompletionNotice('');
        setReceiptSavedForCompletion(false);
        setShowCancelCompletionConfirm(false);
        setReceiptDraft(null);
        setReceiptUploadFile(null);
        setMobileSession(null);
        return;
      } else if (action === 'recall-skipped') {
        await api.post(`/branch/queue/${queue.id}/recall-skipped`);
      } else {
        await api.post(`/branch/queue/${queue.id}/${action}`);
      }
      await fetchQueues();
      if (action === 'delete' || action === 'delete-history') {
        setQueueToDelete(null);
        setHistoryToDelete(null);
        setShowDeleteModal(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${action.replace('-', ' ')} queue.`);
    } finally {
      if (action === 'delete') {
        setDeletingQueueId(null);
      } else if (action === 'delete-history') {
        setDeletingHistoryId(null);
      } else if (action === 'complete') {
        setCompletingQueueId(null);
      }
    }
  };

  const now = useMemo(() => new Date(), [queues]);
  const queueUnavailable = systemStatus && (!systemStatus.queueEnabled || systemStatus.maintenanceMode);
  const activeQueue = useMemo(
    () => queues.find((queue) => ['called', 'serving'].includes((queue.status || '').toLowerCase())),
    [queues],
  );

  const serviceTypes = useMemo(
    () => Array.from(new Set(queues.map((queue) => queue.service_type).filter(Boolean))).sort(),
    [queues],
  );

  const filteredQueues = useMemo(() => {
    return queues.filter((queue) => {
      const derivedStatus = getDerivedStatus(queue, now);
      const relevantDateTime = getRelevantDateTime(queue);
      const dateValue = formatDateInputValue(relevantDateTime);
      const timeValue = formatTimeInputValue(queue.appointment_time || queue.created_at);
      const searchableText = [
        queue.queue_number,
        queue.taxpayer_name,
        queue.service_type,
        queue.email,
        queue.contact_number,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (queueTypeFilter !== 'all' && queue.queue_type !== queueTypeFilter) {
        return false;
      }
      if (statusFilter !== 'all' && derivedStatus !== statusFilter) {
        return false;
      }
      if (dateFilter && dateValue !== dateFilter) {
        return false;
      }
      if (timeSlotFilter && timeValue !== timeSlotFilter) {
        return false;
      }
      if (serviceTypeFilter !== 'all' && queue.service_type !== serviceTypeFilter) {
        return false;
      }
      if (windowFilter !== 'all' && (queue.service_window || 'MISC') !== windowFilter) {
        return false;
      }
      if (queueNumberFilter && !(queue.queue_number || '').toLowerCase().includes(queueNumberFilter.toLowerCase())) {
        return false;
      }
      if (searchFilter && !searchableText.includes(searchFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [queues, now, queueTypeFilter, statusFilter, dateFilter, timeSlotFilter, serviceTypeFilter, windowFilter, queueNumberFilter, searchFilter]);

  const immediateQueues = useMemo(
    () => sortQueues(filteredQueues.filter((queue) => queue.queue_type !== 'appointment' && getDerivedStatus(queue, now) !== 'skipped'), now),
    [filteredQueues, now],
  );
  const appointmentQueues = useMemo(
    () => sortQueues(filteredQueues.filter((queue) => queue.queue_type === 'appointment' && getDerivedStatus(queue, now) !== 'skipped'), now),
    [filteredQueues, now],
  );
  const skippedQueues = useMemo(
    () => sortQueues(filteredQueues.filter((queue) => getDerivedStatus(queue, now) === 'skipped'), now),
    [filteredQueues, now],
  );

  const filteredQueueHistory = useMemo(() => {
    const byWindow = { RPT: [], BUSINESS: [], MISC: [] };

    queueHistory.forEach((queue) => {
      const windowKey = queue.service_window || 'MISC';
      const searchTerm = (historySearch[windowKey] || '').trim().toLowerCase();
      if (!searchTerm || (queue.taxpayer_name || '').toLowerCase().includes(searchTerm)) {
        if (!byWindow[windowKey]) {
          byWindow[windowKey] = [];
        }
        byWindow[windowKey].push(queue);
      }
    });

    Object.keys(byWindow).forEach((key) => {
      byWindow[key].sort((left, right) => {
        const rightDate = parseDate(right.completed_at || right.archived_at)?.getTime() || 0;
        const leftDate = parseDate(left.completed_at || left.archived_at)?.getTime() || 0;
        return rightDate - leftDate;
      });
    });

    return byWindow;
  }, [queueHistory, historySearch]);

  const visibleHistorySections = useMemo(() => {
    if (isQueueWindowAccount) {
      return [
        {
          key: assignedWindowKey,
          title: `Completed ${queueWindowLabels[assignedWindowKey] || assignedWindowKey} Queue History`,
          description: `Completed ${(queueWindowLabels[assignedWindowKey] || assignedWindowKey)} queue transactions are archived here after branch staff finish servicing them.`,
          items: filteredQueueHistory[assignedWindowKey] || [],
        },
      ];
    }

    return [
      {
        key: 'RPT',
        title: 'Completed RPT Queue History',
        description: 'Completed RPT queue transactions are archived here after branch staff finish servicing them.',
        items: filteredQueueHistory.RPT || [],
      },
      {
        key: 'BUSINESS',
        title: 'Completed BT Queue History',
        description: 'Completed BT queue transactions are archived here after branch staff finish servicing them.',
        items: filteredQueueHistory.BUSINESS || [],
      },
      {
        key: 'MISC',
        title: 'Completed Misc Queue History',
        description: 'Completed miscellaneous queue transactions are archived here after branch staff finish servicing them.',
        items: filteredQueueHistory.MISC || [],
      },
    ];
  }, [assignedWindowKey, filteredQueueHistory, isQueueWindowAccount]);

  const summary = useMemo(() => ({
    immediate: immediateQueues.length,
    appointment: appointmentQueues.length,
    active: queues.filter((queue) => ['waiting', 'called', 'serving'].includes((queue.status || '').toLowerCase())).length,
    scheduled: queues.filter((queue) => getDerivedStatus(queue, now) === 'appointment').length,
    skipped: queues.filter((queue) => getDerivedStatus(queue, now) === 'skipped').length,
  }), [immediateQueues.length, appointmentQueues.length, queues, now]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-gray-600">Loading queue...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Queue Management"
        subtitle={
          isQueueWindowAccount && assignedWindowLabel
            ? `Manage only the ${assignedWindowLabel} service window queue for this branch.`
            : isBranchAdmin
              ? 'Review skipped queue records and pull taxpayers back to the current window when they return.'
            : 'Manage immediate and appointment queues in separate sections with quick status visibility, search tools, and clean paging.'
        }
      />

      <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-md">
              <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-blue-900">Live Queue Monitoring</h3>
              <p className="mt-1 text-sm text-blue-700">
                Open a dedicated live monitoring screen optimized for TVs and large displays
              </p>
            </div>
          </div>
          <button
            onClick={() => window.open(`/live-monitor/${branchSlug}`, '_blank')}
            className="flex items-center gap-3 rounded-xl bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-md transition hover:bg-blue-700 hover:shadow-lg"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
            </svg>
            Open Live Queue Monitoring
          </button>
        </div>
      </section>

      {isQueueWindowAccount && assignedWindowLabel ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900 shadow-sm">
          <p className="font-semibold">Queue-only branch staff account active for the {assignedWindowLabel} window.</p>
          <p className="mt-1 text-sm text-blue-700">
            Other branch modules are hidden, and queue actions are limited to this assigned service window.
          </p>
        </div>
      ) : null}

      {isSuperadminManagedBranch ? (
        <section className="rounded-2xl border border-purple-200 bg-purple-50 p-5 text-purple-950 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-500">Window Staff Accounts</p>
              <h2 className="mt-2 text-xl font-bold">Superadmin Window Queue Selector</h2>
              <p className="mt-1 text-sm text-purple-800">
                Select a generated window staff account to focus this branch queue view on that service window.
              </p>
            </div>
            <select
              value={windowFilter}
              onChange={(event) => setWindowFilter(event.target.value)}
              className="min-w-[18rem] rounded-xl border border-purple-200 bg-white px-4 py-3 text-sm font-semibold text-purple-950 outline-none"
            >
              <option value="all">All window staff queues</option>
              {windowOptions.map((account) => (
                <option key={account.key} value={account.key}>
                  {account.label}{account.username ? ` - ${account.username}` : ''}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : null}

      {isBranchAdmin ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-800 shadow-sm">
          <p className="font-semibold">Immediate Queue and Appointment Queue are hidden for branch admin accounts.</p>
          <p className="mt-1 text-sm text-slate-600">
            These sections are reserved for branch staff handling active queue operations.
          </p>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {!isBranchAdmin ? (
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-sm font-medium text-slate-500">Immediate Queue</p>
            <p className="mt-2 text-3xl font-bold text-primary">{summary.immediate}</p>
            <p className="mt-2 text-sm text-slate-500">Immediate queue records after filters.</p>
          </div>
        ) : null}
        {!isBranchAdmin ? (
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-sm font-medium text-slate-500">Appointment Queue</p>
            <p className="mt-2 text-3xl font-bold text-primary">{summary.appointment}</p>
            <p className="mt-2 text-sm text-slate-500">Appointment queue records after filters.</p>
          </div>
        ) : null}
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Ready / Active</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.active}</p>
          <p className="mt-2 text-sm text-slate-500">Waiting, called, or serving queues.</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Scheduled Appointments</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.scheduled}</p>
          <p className="mt-2 text-sm text-slate-500">Appointment records not yet ready for servicing.</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Skipped</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.skipped}</p>
          <p className="mt-2 text-sm text-slate-500">Skipped queue records still waiting for recall or removal.</p>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Queue Controls</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">Filter And Search</h2>
            <p className="mt-2 text-sm text-slate-500">
              Narrow the queue list by type, status, date, time slot, service, queue number, or taxpayer details.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => performAction('call-next')}
              disabled={queueUnavailable || Boolean(activeQueue) || isBranchAdmin || isAnnouncementPlaying}
              className="rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
            >
              {isAnnouncementPlaying ? 'Announcing...' : 'Call Next'}
            </button>
            <button
              onClick={() => performAction('recall')}
              disabled={!lastCalledQueue || isAnnouncementPlaying || isBranchAdmin}
              className="rounded-xl bg-orange-500 px-6 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!lastCalledQueue ? 'No queue available for recall' : 'Replay the last called queue announcement'}
            >
              {isAnnouncementPlaying ? 'Playing...' : 'Recall'}
            </button>
            <button
              onClick={() => performAction('delete-skipped')}
              disabled={queueUnavailable || skippedQueues.length === 0}
              className="rounded-xl bg-rose-600 px-6 py-3 font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              Delete Skipped Queue
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <select value={queueTypeFilter} onChange={(event) => setQueueTypeFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none">
            <option value="all">All queue types</option>
            <option value="immediate">Immediate</option>
            <option value="appointment">Appointment</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none">
            <option value="all">All statuses</option>
            <option value="appointment">Appointment</option>
            <option value="waiting">Waiting</option>
            <option value="called">Called</option>
            <option value="serving">Serving</option>
            <option value="completed">Completed</option>
            <option value="skipped">Skipped</option>
          </select>
          <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none" />
          <input type="time" value={timeSlotFilter} onChange={(event) => setTimeSlotFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none" />
          <select value={serviceTypeFilter} onChange={(event) => setServiceTypeFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none">
            <option value="all">All services</option>
            {serviceTypes.map((serviceType) => (
              <option key={serviceType} value={serviceType}>{serviceType}</option>
            ))}
          </select>
          {isSuperadminManagedBranch ? (
            <select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none">
              <option value="all">All window staff queues</option>
              {windowOptions.map((account) => (
                <option key={account.key} value={account.key}>
                  {account.label}{account.username ? ` - ${account.username}` : ''}
                </option>
              ))}
            </select>
          ) : null}
          <input
            type="text"
            value={queueNumberFilter}
            onChange={(event) => setQueueNumberFilter(event.target.value)}
            placeholder="Filter by queue number"
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
          />
          <input
            type="text"
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            placeholder="Search taxpayer, service, email, or contact"
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none xl:col-span-2"
          />
          <button
            onClick={() => {
              setQueueTypeFilter('all');
              setStatusFilter('all');
              setDateFilter('');
              setTimeSlotFilter('');
              setServiceTypeFilter('all');
              setWindowFilter('all');
              setQueueNumberFilter('');
              setSearchFilter('');
            }}
            className="rounded-xl bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
          >
            Reset Filters
          </button>
        </div>
      </section>

      {queueUnavailable ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
          <p className="font-semibold">{systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE}</p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{error}</p>
        </div>
      ) : null}

      {activeQueue && !error ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900 shadow-sm">
          <p className="font-semibold">
            Active queue: {activeQueue.queue_number} is currently {getStatusLabel(activeQueue, now)}.
          </p>
          <p className="mt-1 text-sm text-blue-700">
            Complete or skip the current active queue before calling the next taxpayer.
          </p>
        </div>
      ) : null}

      {!isBranchAdmin ? (
        <div className="space-y-6">
          <QueueSection
            title="Immediate Queue"
            description="Immediate queue taxpayers are grouped here with active records shown first and completed history moved below them."
            queues={immediateQueues}
            page={immediatePage}
            onPageChange={setImmediatePage}
            queueUnavailable={queueUnavailable}
            onAction={performAction}
            onDeleteRequest={openDeleteModal}
            now={now}
          />
          <QueueSection
            title="Appointment Queue"
            description="Appointment queue taxpayers stay separate so branch admins can clearly distinguish scheduled appointments from ready, called, serving, completed, or skipped records."
            queues={appointmentQueues}
            page={appointmentPage}
            onPageChange={setAppointmentPage}
            queueUnavailable={queueUnavailable}
            onAction={performAction}
            onDeleteRequest={openDeleteModal}
            now={now}
          />
        </div>
      ) : null}

      <QueueSection
        title="Skipped Queue"
        description="Skipped taxpayers remain here instead of being deleted. Pull them back up when they return, or clear the skipped list at the end of the day."
        queues={skippedQueues}
        page={skippedPage}
        onPageChange={setSkippedPage}
        queueUnavailable={queueUnavailable}
        onAction={performAction}
        onDeleteRequest={openDeleteModal}
        now={now}
        skippedOnly
      />

      {!isBranchAdmin ? (
        <div className="space-y-6">
          {visibleHistorySections.map((section) => (
            <QueueHistorySection
              key={section.key}
              title={section.title}
              description={section.description}
              items={section.items}
              searchValue={historySearch[section.key] || ''}
              onSearchChange={(value) => setHistorySearch((current) => ({ ...current, [section.key]: value }))}
              onDeleteHistory={openDeleteHistoryModal}
              deletingHistoryId={deletingHistoryId}
            />
          ))}
        </div>
      ) : null}

      {completionQueue ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Complete Queue</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">{completionQueue.queue_number}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {completionQueue.taxpayer_name || 'Walk-in'} | {completionQueue.service_type}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelCompletionConfirm(true)}
                disabled={processingReceipt || savingReceipt || completingQueueId !== null}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>

            {completionError ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {completionError}
              </div>
            ) : null}

            {completionNotice ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                {completionNotice}
              </div>
            ) : null}

            {completionMode === 'options' ? (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {receiptSavedForCompletion ? (
                  <button
                    type="button"
                    onClick={() => completeQueueDirectly(completionQueue)}
                    disabled={completingQueueId !== null}
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-left transition hover:border-emerald-400 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    <p className="text-lg font-bold text-emerald-900">Complete Queue</p>
                    <p className="mt-2 text-sm leading-6 text-emerald-700">
                      Receipt is already uploaded and saved.
                    </p>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setCompletionError('');
                    setCompletionNotice('');
                    setCompletionMode('file');
                  }}
                  disabled={receiptSavedForCompletion}
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-6 text-left transition hover:border-blue-400 hover:bg-blue-100"
                >
                  <p className="text-lg font-bold text-blue-900">File Upload</p>
                  <p className="mt-2 text-sm leading-6 text-blue-700">Upload a receipt image from this computer and run OCR.</p>
                </button>
                <button
                  type="button"
                  onClick={startMobileReceiptUpload}
                  disabled={processingReceipt || receiptSavedForCompletion}
                  className="rounded-2xl border border-purple-200 bg-purple-50 px-5 py-6 text-left transition hover:border-purple-400 hover:bg-purple-100 disabled:opacity-60"
                >
                  <p className="text-lg font-bold text-purple-900">Via Mobile QR</p>
                  <p className="mt-2 text-sm leading-6 text-purple-700">Scan a QR code and take the receipt photo from a phone.</p>
                </button>
              </div>
            ) : null}

            {completionMode === 'file' ? (
              <form onSubmit={handleFileReceiptUpload} className="mt-6 space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                  Default receipt category: <span className="font-bold text-slate-900">{resolveReceiptCategory(completionQueue)}</span>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Receipt Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      setCompletionError('');
                      setReceiptUploadFile(event.target.files?.[0] || null);
                    }}
                    className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm"
                    required
                  />
                </label>
                <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                  <button type="button" onClick={() => {
                    setCompletionError('');
                    setCompletionNotice('');
                    setCompletionMode('options');
                  }} className="rounded-xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300">
                    Back
                  </button>
                  <button type="submit" disabled={processingReceipt} className="rounded-xl bg-primary px-5 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-60">
                    {processingReceipt ? 'Parsing...' : 'Run OCR'}
                  </button>
                </div>
              </form>
            ) : null}

            {completionMode === 'mobile' && mobileSession ? (
              <div className="mt-6 grid gap-6 md:grid-cols-[240px,1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
                  <img
                    src={`/api/receipts/records/mobile-upload-sessions/${mobileSession.token}/qr`}
                    alt="Mobile receipt upload QR"
                    className="mx-auto h-52 w-52"
                  />
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">Scan to upload receipt</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Open the QR link on a phone, take or choose the receipt image, then upload. Once uploaded, check the result here and review the parsed fields.
                  </p>
                  <p className="mt-3 break-all rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">{mobileSession.upload_url}</p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="button" onClick={checkMobileReceiptUpload} disabled={processingReceipt} className="rounded-xl bg-primary px-5 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-60">
                      {processingReceipt ? 'Checking...' : 'Check Upload'}
                    </button>
                    <button type="button" onClick={() => {
                      setCompletionError('');
                      setCompletionNotice('');
                      setCompletionMode('options');
                    }} className="rounded-xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300">
                      Back
                    </button>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-700">Status: {mobileSession.status || 'pending'}</p>
                </div>
              </div>
            ) : null}

            {completionMode === 'review' && receiptDraft ? (
              <div className="mt-6 space-y-5">
                {receiptDraft.duplicate_warning || receiptDraft.category_warning ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {receiptDraft.duplicate_warning || receiptDraft.category_warning}
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Reference Number</span>
                    <input name="ref_number" value={receiptDraft.ref_number || ''} onChange={handleReceiptDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Name</span>
                    <input name="taxpayer_name" value={receiptDraft.taxpayer_name || ''} onChange={handleReceiptDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Transaction Date</span>
                    <input name="transaction_date" value={receiptDraft.transaction_date || ''} onChange={handleReceiptDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Amount</span>
                    <input name="amount" type="number" step="0.01" value={receiptDraft.amount ?? ''} onChange={handleReceiptDraftChange} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none" />
                  </label>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Category: {receiptDraft.selected_category || resolveReceiptCategory(completionQueue)} | Confidence: {receiptDraft.confidence || 0} | Engine: {receiptDraft.engine || 'ocr'}
                </div>
                <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
                  <button type="button" onClick={() => {
                    setCompletionError('');
                    setCompletionNotice('');
                    setCompletionMode('options');
                  }} disabled={savingReceipt} className="rounded-xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-60">
                    Back
                  </button>
                  <button type="button" onClick={saveReceiptAndCompleteQueue} disabled={savingReceipt || receiptDraft.save_blocked} className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                    {savingReceipt ? 'Saving...' : receiptDraft.save_blocked ? 'Review Blocked' : 'Save Receipt'}
                  </button>
                </div>
              </div>
            ) : null}

            {showCancelCompletionConfirm ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 px-4">
                <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-500">Cancel Process</p>
                  <h4 className="mt-2 text-xl font-bold text-primary">Are you sure you want to cancel?</h4>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    This will close the Complete Queue process. Any unsaved receipt upload or OCR review in this modal will be discarded.
                  </p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setShowCancelCompletionConfirm(false)}
                      className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      No, Keep Editing
                    </button>
                    <button
                      type="button"
                      onClick={resetCompletionFlow}
                      className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
                    >
                      Yes, Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showDeleteModal && (queueToDelete || historyToDelete) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Confirm Deletion</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">{historyToDelete ? 'Delete this completed queue history?' : 'Delete this queue record?'}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  This will permanently remove queue <span className="font-semibold text-slate-800">{(historyToDelete || queueToDelete)?.queue_number}</span>{historyToDelete ? ' from the completed queue history.' : ' from the branch queue list.'}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Queue Details</p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {queueToDelete.taxpayer_name || 'Walk-in'} • {queueToDelete.service_type}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {queueTypeLabels[(historyToDelete || queueToDelete)?.queue_type] || 'Immediate'} queue
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deletingQueueId !== null || deletingHistoryId !== null}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={() => performAction(historyToDelete ? 'delete-history' : 'delete', historyToDelete || queueToDelete)}
                disabled={deletingQueueId !== null || deletingHistoryId !== null}
                className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-70"
              >
                {historyToDelete
                  ? (deletingHistoryId === historyToDelete.id ? 'Deleting...' : 'Confirm Delete')
                  : (deletingQueueId === queueToDelete.id ? 'Deleting...' : 'Confirm Delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QueueManagement;
