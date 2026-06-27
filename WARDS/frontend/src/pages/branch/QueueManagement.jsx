import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, useRef } from 'react';
import api, { receiptAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { CustomSelect, CustomDatePicker } from '../../components/FormControls';
import { isAnnouncementActive } from '../../utils/queueAnnouncement';

const PAGE_SIZE = 5;
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

const completedStatusClasses = {
  completed: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-rose-100 text-rose-800',
};

const queueWindowLabels = {
  RPT: 'RPT',
  BUSINESS: 'BT',
  MISC: 'MISC',
  CTC: 'CTC',
  PTR: 'PTR',
  MARKET: 'MARKET',
  QW4: 'Queue Window 4',
  QW5: 'Queue Window 5',
};

const getQueueWindowLabel = (queueOrKey) => {
  if (queueOrKey && typeof queueOrKey === 'object') {
    return queueOrKey.window_label || queueWindowLabels[queueOrKey.service_window] || queueOrKey.service_window || 'MISC';
  }
  return queueWindowLabels[queueOrKey] || queueOrKey || 'MISC';
};

const BRANCH_QUEUE_UPDATED_EVENT = 'branch-queue-updated';
const OCR_REQUIRED_RECEIPT_CATEGORIES = new Set(['RPT', 'BUSINESS', 'MISC', 'PTR', 'MARKET']);
const MARKET_PURPOSE_OPTIONS = [
  'Renewal of Business Permit',
  'New Business Permit Application',
  'Renewal of Stall Occupancy',
  'Transfer of Stall Ownership',
  'Change of Business Name',
  'Change of Business Activity',
  'Stall Verification',
  'Market Clearance Requirement',
  'Permit Renewal Requirement',
];

const getTodayDateInputValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value) => {
  const normalized = (value || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const isMarketIssueDateInvalid = (value) => {
  const parsed = parseDateInputValue(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getTime() !== today.getTime();
};

const isMarketValidUntilInvalid = (value) => {
  const parsed = parseDateInputValue(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
};

const getMarketPurposeSelectValue = (value) => {
  const normalized = (value || '').trim().toLowerCase();
  const match = MARKET_PURPOSE_OPTIONS.find((option) => option.toLowerCase() === normalized);
  return match || 'Other';
};

const resolveReceiptCategory = (queue) => {
  const serviceWindow = (queue?.service_window || '').toUpperCase();
  const serviceType = (queue?.service_type || '').toLowerCase();
  if (serviceWindow === 'RPT' || serviceType.includes('rpt') || serviceType.includes('real property')) {
    return 'RPT';
  }
  if (serviceWindow === 'BUSINESS' || serviceType.includes('business') || serviceType.includes('permit') || serviceType.includes('bt')) {
    return 'BUSINESS';
  }
  if (serviceWindow === 'CTC' || serviceType.includes('ctc') || serviceType.includes('cedula') || serviceType.includes('community tax')) {
    return 'CTC';
  }
  if (serviceWindow === 'PTR' || serviceType.includes('ptr') || serviceType.includes('professional tax')) {
    return 'PTR';
  }
  if (serviceWindow === 'MARKET' || serviceType.includes('market')) {
    return 'MARKET';
  }
  return serviceWindow || 'MISC';
};

const normalizeReceiptCategory = (value) => {
  const normalized = (value || '').trim().toUpperCase();
  const aliases = {
    BT: 'BUSINESS',
    'BUSINESS TAX': 'BUSINESS',
    "MAYOR'S PERMIT": 'BUSINESS',
    'MAYORS PERMIT': 'BUSINESS',
    MISCELLANEOUS: 'MISC',
  };
  const resolved = aliases[normalized] || normalized || 'RPT';
  if (/^QW\d+$/.test(resolved)) {
    return 'MISC';
  }
  return resolved;
};

const defaultReceiptDraft = (queue) => ({
  ref_number: '',
  txn_id: '',
  taxpayer_name: resolveReceiptCategory(queue) === 'CTC' ? '' : (queue?.taxpayer_name || ''),
  transaction_date: resolveReceiptCategory(queue) === 'CTC' ? getTodayDateInputValue() : '',
  amount: '',
  market_purpose_of_renewal: '',
  market_valid_until: '',
  tax_type: resolveReceiptCategory(queue),
  selected_category: resolveReceiptCategory(queue),
  detected_category: resolveReceiptCategory(queue),
  category_match: true,
  confidence: 0,
  raw_text: '',
  auto_rename_source_image: false,
});

const normalizeReceiptFilenameForCompare = (value) => (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const buildSuggestedReceiptFilename = (filename, taxpayerName) => {
  const extensionMatch = (filename || '').match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || '.jpg';
  const baseName = (taxpayerName || '').trim() || 'receipt';
  return `${baseName}${extension}`;
};

const getReceiptFieldLabel = (field, category) => {
  const normalizedCategory = (category || '').trim().toUpperCase();
  if (normalizedCategory === 'MARKET') {
    const labels = {
      taxpayer_name: 'Name',
      transaction_date: 'Date of Issue',
      market_purpose_of_renewal: 'Purpose of Renewal',
      market_valid_until: 'Valid Until',
    };
    return labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (normalizedCategory === 'CTC') {
    const labels = {
      transaction_date: 'Date',
    };
    return labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const labels = {
    ref_number: 'Reference Number',
    taxpayer_name: 'Taxpayer Name',
    transaction_date: 'Transaction Date',
    amount: 'Amount',
  };
  return labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const buildExtractionWarningMessage = (missingFields, category) => {
  if (!missingFields || missingFields.length === 0) {
    return '';
  }
  const fieldLabels = missingFields.map((field) => getReceiptFieldLabel(field, category));
  if (fieldLabels.length === 1) {
    return `Unable to extract the following required field from the receipt: ${fieldLabels[0]}. Please review and enter the information manually.`;
  }
  const allButLast = fieldLabels.slice(0, -1).join(', ');
  const last = fieldLabels[fieldLabels.length - 1];
  return `Unable to extract the following required fields from the receipt: ${allButLast}, and ${last}. Please review and complete these fields manually.`;
};

const getReceiptDraftMissingFields = (draft, category) => {
  const normalizedCategory = (category || '').trim().toUpperCase();
  if (!OCR_REQUIRED_RECEIPT_CATEGORIES.has(normalizedCategory)) {
    return [];
  }

  if (normalizedCategory === 'MARKET') {
    const missingFields = [];
    if (!(draft?.taxpayer_name || '').trim()) {
      missingFields.push('taxpayer_name');
    }
    if (!(draft?.transaction_date || '').trim() || isMarketIssueDateInvalid(draft?.transaction_date)) {
      missingFields.push('transaction_date');
    }
    if (!(draft?.market_purpose_of_renewal || '').trim()) {
      missingFields.push('market_purpose_of_renewal');
    }
    if (!(draft?.market_valid_until || '').trim() || isMarketValidUntilInvalid(draft?.market_valid_until)) {
      missingFields.push('market_valid_until');
    }
    return missingFields;
  }

  if (normalizedCategory === 'CTC') {
    const missingFields = [];
    if (!(draft?.transaction_date || '').trim()) {
      missingFields.push('transaction_date');
    }
    return missingFields;
  }

  const missingFields = [];
  if (!(draft?.ref_number || '').trim()) {
    missingFields.push('ref_number');
  }
  if (!(draft?.taxpayer_name || '').trim()) {
    missingFields.push('taxpayer_name');
  }
  if (draft?.amount === '' || draft?.amount === null || draft?.amount === undefined || Number.isNaN(Number(draft?.amount)) || Number(draft?.amount) <= 0) {
    missingFields.push('amount');
  }
  return missingFields;
};

const isAmountInvalid = (amount) => {
  if (amount === '' || amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return false;
  }
  return Number(amount) <= 0;
};

const normalizeReceiptDraftReviewState = (draft) => {
  if (!draft) {
    return draft;
  }

  const taxpayerName = (draft.taxpayer_name || '').trim();
  const originalFilename = draft.source_image_original_filename || draft.source_image_suggested_filename || '';
  const suggestedFilename = taxpayerName
    ? buildSuggestedReceiptFilename(originalFilename, taxpayerName)
    : (draft.source_image_suggested_filename || '');
  const filenameStem = (originalFilename || '').replace(/\.[^.]+$/, '');
  const suggestedStem = suggestedFilename.replace(/\.[^.]+$/, '');
  const filenameMatchesTaxpayer = taxpayerName
    ? normalizeReceiptFilenameForCompare(filenameStem) === normalizeReceiptFilenameForCompare(suggestedStem)
    : draft.filename_matches_taxpayer;
  const shouldAutoRename = Boolean(taxpayerName && !filenameMatchesTaxpayer);

  return {
    ...draft,
    source_image_suggested_filename: suggestedFilename,
    filename_matches_taxpayer: taxpayerName ? filenameMatchesTaxpayer : draft.filename_matches_taxpayer,
    file_name_validation_message: shouldAutoRename
      ? `The uploaded file name must match the taxpayer name. Rename it to ${suggestedFilename} or use auto rename.`
      : '',
    auto_rename_source_image: shouldAutoRename ? true : Boolean(draft.auto_rename_source_image),
  };
};

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
    timeZone: 'Asia/Manila',
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
    timeZone: 'Asia/Manila',
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

  // Sort active queues by status priority (serving > called > waiting > appointment), then by creation time
  const statusPriority = { serving: 0, called: 1, waiting: 2, appointment: 3 };
  activeQueues.sort((left, right) => {
    const leftStatus = getDerivedStatus(left, now);
    const rightStatus = getDerivedStatus(right, now);
    const leftPriority = statusPriority[leftStatus] ?? 999;
    const rightPriority = statusPriority[rightStatus] ?? 999;
    
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    
    // Same status, sort by creation time (oldest first)
    const leftDate = parseDate(left.created_at)?.getTime() || 0;
    const rightDate = parseDate(right.created_at)?.getTime() || 0;
    return leftDate - rightDate;
  });

  archivedQueues.sort((left, right) => {
    const rightDate = parseDate(right.completed_at || right.served_at || right.created_at)?.getTime() || 0;
    const leftDate = parseDate(left.completed_at || left.served_at || left.created_at)?.getTime() || 0;
    return leftDate - rightDate;
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
  canManageQueues = true,
  headerAction = null,
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
          <div className="flex flex-wrap items-center gap-3">
            {headerAction}
            {queues.length > 0 && (
              <div className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                {queues.length} entr{queues.length === 1 ? 'y' : 'ies'}
              </div>
            )}
          </div>
        </div>
      </div>

      {queues.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          No queue records match the current filters for this section.
        </div>
      ) : (
        <>
          {/* Mobile queue cards */}
          <div className="md:hidden space-y-3">
            {paginated.items.map((queue) => {
              const derivedStatus = getDerivedStatus(queue, now);
              const relevantDateTime = getRelevantDateTime(queue);
              return (
                <div key={queue.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-primary">{queue.queue_number}</p>
                      <p className="text-xs text-slate-500">{queue.taxpayer_name || 'Walk-in'}</p>
                    </div>
                    <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses[derivedStatus] || 'bg-slate-100 text-slate-700'}`}>
                      {getStatusLabel(queue, now)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    <p>{queue.service_type}</p>
                    <p className="mt-0.5 text-slate-400">
                      {queue.queue_type === 'appointment' && queue.appointment_time
                        ? formatAppointmentDateTimeLabel(queue.appointment_time)
                        : (relevantDateTime ? formatUtc8DateTime(relevantDateTime) : 'N/A')}
                    </p>
                  </div>
                  {canManageQueues ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {skippedOnly || derivedStatus === 'skipped' ? (
                        <button onClick={() => onAction('recall-skipped', queue)} disabled={queueUnavailable} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Pull Up</button>
                      ) : (
                        <>
                          {(queue.status || '').toLowerCase() === 'called' && (
                            <button onClick={() => onAction('serve', queue)} disabled={queueUnavailable} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Serve</button>
                          )}
                          {['called', 'serving'].includes((queue.status || '').toLowerCase()) && (
                            <button onClick={() => onAction('skip', queue)} disabled={queueUnavailable} className="rounded-md bg-yellow-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Skip</button>
                          )}
                          {(queue.status || '').toLowerCase() === 'serving' && (
                            <button onClick={() => onAction('complete', queue)} disabled={queueUnavailable} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Complete</button>
                          )}
                        </>
                      )}
                      <button onClick={() => onDeleteRequest(queue)} disabled={queueUnavailable} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Delete</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Desktop queue table */}
          <table className="hidden md:table w-full table-auto text-xs">
            <thead className="bg-white">
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-3 py-2.5 text-[10px] font-semibold">Queue No.</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold">Taxpayer</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold">Service</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold">Status</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold">Date / Time</th>
                {canManageQueues ? (
                  <th className="px-3 py-2.5 text-[10px] font-semibold">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.items.map((queue) => {
                const derivedStatus = getDerivedStatus(queue, now);
                const relevantDateTime = getRelevantDateTime(queue);

                return (
                  <tr key={queue.id} className="align-top hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-primary">{queue.queue_number}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                          {queueTypeLabels[queue.queue_type] || 'Immediate'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-[11px] font-medium text-slate-800">{queue.taxpayer_name || 'Walk-in'}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">{queue.email || queue.contact_number || 'No contact'}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-[11px] font-medium text-slate-800">{queue.service_type}</p>
                        {queue.estimated_wait_time ? (
                          <p className="mt-0.5 text-[10px] text-slate-500">~{queue.estimated_wait_time}m</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClasses[derivedStatus] || 'bg-slate-100 text-slate-700'}`}>
                          {getStatusLabel(queue, now)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        <p className="text-[11px] font-medium text-slate-700">
                          {queue.queue_type === 'appointment' && queue.appointment_time
                            ? formatAppointmentDateTimeLabel(queue.appointment_time)
                            : (relevantDateTime ? formatUtc8DateTime(relevantDateTime) : 'N/A')}
                        </p>
                        {queue.queue_type === 'appointment' && queue.appointment_time ? (
                          <p className="mt-0.5 text-[10px] text-slate-500">{formatTimeLabel(queue.appointment_time)}</p>
                        ) : null}
                      </td>
                      {canManageQueues ? (
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {skippedOnly || derivedStatus === 'skipped' ? (
                              <button
                                onClick={() => onAction('recall-skipped', queue)}
                                disabled={queueUnavailable}
                                className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
                              >
                                Pull Up
                              </button>
                            ) : (
                              <>
                                {(queue.status || '').toLowerCase() === 'called' && (
                                  <button
                                    onClick={() => onAction('serve', queue)}
                                    disabled={queueUnavailable}
                                    className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
                                  >
                                    Serve
                                  </button>
                                )}
                                {['called', 'serving'].includes((queue.status || '').toLowerCase()) && (
                                  <button
                                    onClick={() => onAction('skip', queue)}
                                    disabled={queueUnavailable}
                                    className="rounded-md bg-yellow-500 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-yellow-600 disabled:opacity-40"
                                  >
                                    Skip
                                  </button>
                                )}
                                {(queue.status || '').toLowerCase() === 'serving' && (
                                  <button
                                    onClick={() => onAction('complete', queue)}
                                    disabled={queueUnavailable}
                                    className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                                  >
                                    Complete
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              onClick={() => onDeleteRequest(queue)}
                              disabled={queueUnavailable}
                              className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-red-700 disabled:opacity-40"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                {Array.from({ length: PAGE_SIZE - paginated.items.length }).map((_, i) => (
                  <tr key={`empty-${i}`} className="h-[54px]">
                    <td colSpan={canManageQueues ? 6 : 5} className="px-3 py-2.5">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

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

const WindowMonitoringSection = ({
  windowsByQueueType,
  totalFilteredCount,
  lastRefreshedAt,
  now,
  serviceTypeFilter,
  queueUnavailable,
  isSuperadminBranch,
  isBranchAdmin,
  onWindowCallNext,
  onWindowRecall,
  onWindowSkip,
  onWindowServe,
  onWindowComplete,
  onWindowRecallSkipped,
  isAnnouncementPlaying,
  callingNext,
  onDeleteRequest,
}) => {
  const queueTypeEntries = Object.entries(windowsByQueueType);
  const hasWindows = queueTypeEntries.some(([, windows]) => windows.length > 0);
  const isServiceTypeFiltered = serviceTypeFilter && serviceTypeFilter !== 'all';
  const [activeQueueTypeTab, setActiveQueueTypeTab] = useState('immediate');
  const [skipConfirmQueue, setSkipConfirmQueue] = useState(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Branch Admin Monitoring</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">Window Monitoring</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">Live, view-only window status grouped by queue type.</p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-slate-600 lg:items-end">
          <div className="rounded-xl bg-slate-50 px-4 py-2 font-semibold text-slate-700">
            {totalFilteredCount} matching queue entr{totalFilteredCount === 1 ? 'y' : 'ies'}
          </div>
          <p>
            Last refreshed: <span className="font-medium text-slate-700">{lastRefreshedAt ? formatUtc8DateTime(lastRefreshedAt) : 'Waiting for first sync'}</span>
          </p>
        </div>
      </div>

      {isServiceTypeFiltered ? (
        <div className="mt-5 flex justify-center">
          <div className="inline-flex min-w-[16rem] justify-center rounded-full border border-blue-200 bg-blue-50 px-6 py-2 text-center text-sm font-semibold text-blue-900 shadow-sm">
            {serviceTypeFilter}
          </div>
        </div>
      ) : null}

      {!hasWindows ? (
        <div className="py-10 text-center text-sm text-slate-500">
          No service windows are available for monitoring with the current filters.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {queueTypeEntries.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {queueTypeEntries.map(([queueTypeKey]) => (
                <button
                  key={queueTypeKey}
                  onClick={() => setActiveQueueTypeTab(queueTypeKey)}
                  className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                    activeQueueTypeTab === queueTypeKey
                      ? 'bg-primary text-white shadow'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {queueTypeLabels[queueTypeKey] || 'Immediate'} Queue Windows
                </button>
              ))}
            </div>
          )}
          {queueTypeEntries
            .filter(([queueTypeKey]) => queueTypeKey === activeQueueTypeTab)
            .map(([queueTypeKey, windows]) => (
            <div
              key={queueTypeKey}
              className={`space-y-4 ${isServiceTypeFiltered ? 'mx-auto max-w-6xl' : ''}`}
            >
              <div
                className={`flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 ${
                  isServiceTypeFiltered
                    ? 'mx-auto w-full max-w-5xl text-center sm:text-center'
                    : 'sm:flex-row sm:items-center sm:justify-between'
                }`}
              >
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{queueTypeLabels[queueTypeKey] || 'Immediate'} Queue Windows</h3>
                </div>
                <div className={`rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ${isServiceTypeFiltered ? 'mx-auto' : ''}`}>
                  {windows.length} visible window{windows.length === 1 ? '' : 's'}
                </div>
              </div>

              <div
                className={`grid grid-cols-1 gap-4 ${
                  isServiceTypeFiltered
                    ? 'mx-auto max-w-5xl justify-center'
                    : 'xl:grid-cols-2'
                }`}
              >
                {windows.map((window) => {
                  const activeQueues = window.queues.filter((queue) => ['serving', 'called'].includes(getDerivedStatus(queue, now)));
                  const activeQueue = activeQueues[0] || null;
                  const waitingCount = window.queues.filter((queue) => getDerivedStatus(queue, now) === 'waiting').length;
                  const appointmentCount = window.queues.filter((queue) => getDerivedStatus(queue, now) === 'appointment').length;
                  const skippedCount = window.queues.filter((queue) => getDerivedStatus(queue, now) === 'skipped').length;
                  const servingCount = window.queues.filter((queue) => getDerivedStatus(queue, now) === 'serving').length;
                  const calledCount = window.queues.filter((queue) => getDerivedStatus(queue, now) === 'called').length;
                  const currentQueueLabel = activeQueue ? getStatusLabel(activeQueue, now) : null;
                  const windowStatus = servingCount > 0
                    ? 'Serving'
                    : calledCount > 0
                      ? 'Active'
                      : waitingCount > 0
                        ? 'Waiting'
                        : appointmentCount > 0
                          ? 'Scheduled'
                          : 'Idle';
                  const statusClassName = servingCount > 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : calledCount > 0
                      ? 'bg-blue-100 text-blue-800'
                      : waitingCount > 0
                        ? 'bg-amber-100 text-amber-800'
                        : appointmentCount > 0
                          ? 'bg-violet-100 text-violet-800'
                          : 'bg-slate-200 text-slate-700';
                  const nextQueue = window.queues.find((queue) => getDerivedStatus(queue, now) === 'waiting') || null;

                  return (
                    <article
                      key={`${queueTypeKey}-${window.service_window}`}
                      className={`overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${
                        isServiceTypeFiltered ? 'mx-auto w-full max-w-4xl' : ''
                      }`}
                    >
                      <div className="border-b border-slate-100 bg-[#0B2545] px-5 py-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                                {window.window_label}
                              </span>
                              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                                {window.assigned_window_number ? `Window ${window.assigned_window_number}` : 'Unassigned'}
                              </span>
                              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                                {queueTypeLabels[queueTypeKey] || 'Immediate'}
                              </span>
                              {!isServiceTypeFiltered ? (
                                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
                                  {window.serviceTypesLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white">{window.service_window}</p>
                          </div>
                          <div className="flex flex-col gap-3 lg:items-end">
                            <span className={`inline-flex rounded-full px-4 py-1.5 text-xs font-semibold border border-white/20 bg-white/10 ${
                              windowStatus === 'Active' ? 'text-lime-400' :
                              windowStatus === 'Idle' ? 'text-gray-400' :
                              windowStatus === 'Inactive' ? 'text-red-400' :
                              'text-white'
                            }`}>
                              {windowStatus}
                            </span>
                            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm shadow-sm lg:text-right backdrop-blur-sm">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                                {activeQueues.length > 1 ? 'Active Queues' : 'Current Queue'}
                              </p>
                              <p className="mt-1 text-lg font-bold text-white">
                                {activeQueues.length === 0 ? 'None' : activeQueues.length > 1 ? `${activeQueues.length} Active` : activeQueue?.queue_number}
                              </p>
                              {activeQueues.length === 1 && currentQueueLabel ? (
                                <p className="mt-1 text-xs text-white/60">{currentQueueLabel}</p>
                              ) : activeQueues.length > 1 ? (
                                <p className="mt-1 text-xs text-white/60">
                                  {activeQueues.map((q) => q.queue_number).join(', ')}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-slate-500">Active</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{activeQueue?.queue_number || 'None'}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-slate-500">Serving</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{servingCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-slate-500">Next</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{nextQueue?.queue_number || waitingCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-slate-500">Waiting</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{waitingCount}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-slate-500">Scheduled</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{appointmentCount}</p>
                          </div>
                        </div>

                        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Queue Snapshot</p>
                            <div className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                              {window.queues.length} queue entr{window.queues.length === 1 ? 'y' : 'ies'}
                            </div>
                          </div>

                          {(() => {
                            const visibleQueues = window.queues.filter((queue) => getDerivedStatus(queue, now) !== 'skipped');
                            return visibleQueues.length === 0 ? (
                              <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                                No queue records in this window match the active filters.
                              </p>
                            ) : (
                              <div className="mt-4 space-y-3">
                                {visibleQueues.slice(0, 5).map((queue) => {
                                  const derivedStatus = getDerivedStatus(queue, now);
                                  return (
                                    <div key={queue.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-bold text-primary">{queue.queue_number}</p>
                                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[derivedStatus] || 'bg-slate-100 text-slate-700'}`}>
                                            {getStatusLabel(queue, now)}
                                          </span>
                                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                            {queue.service_type || 'N/A'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <p className="text-xs text-slate-500">{queue.taxpayer_name || 'Walk-in'}</p>
                                          {(isSuperadminBranch || isBranchAdmin) && (
                                            <button
                                              onClick={() => onDeleteRequest(queue)}
                                              disabled={queueUnavailable}
                                              className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-red-700 disabled:opacity-40"
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {(isSuperadminBranch || isBranchAdmin) && ['called', 'serving'].includes(derivedStatus) && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                          {derivedStatus === 'called' && (
                                            <button
                                              onClick={() => onWindowServe(queue)}
                                              disabled={queueUnavailable}
                                              className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
                                            >
                                              Serve
                                            </button>
                                          )}
                                          {derivedStatus === 'serving' && (
                                            <button
                                              onClick={() => onWindowComplete(queue)}
                                              disabled={queueUnavailable}
                                              className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                                            >
                                              Complete
                                            </button>
                                          )}
                                          <button
                                            onClick={() => onWindowRecall(queue)}
                                            disabled={queueUnavailable}
                                            className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                                          >
                                            Recall
                                          </button>
                                          <button
                                            onClick={() => setSkipConfirmQueue(queue)}
                                            disabled={queueUnavailable}
                                            className="rounded-md bg-yellow-500 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-yellow-600 disabled:opacity-40"
                                          >
                                            Skip
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {visibleQueues.length > 5 ? (
                                  <p className="text-xs text-slate-500">
                                    Showing 5 of {visibleQueues.length} matching queue entries for this window.
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                        </div>
                        {queueTypeKey === 'immediate' && (isSuperadminBranch || isBranchAdmin) && (
                          <div className="mt-5 flex flex-wrap gap-2">
                            <button
                              onClick={() => onWindowCallNext(window.service_window)}
                              disabled={queueUnavailable || !nextQueue || isAnnouncementPlaying || callingNext || Boolean(activeQueue)}
                              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                            >
                              {callingNext ? 'Calling...' : isAnnouncementPlaying ? 'Announcing...' : 'Call Next'}
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {skipConfirmQueue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Skip Queue</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to skip queue{' '}
              <span className="font-semibold text-rose-600">{skipConfirmQueue.queue_number}</span>?
              The customer will be moved to the skipped list and can be recalled later.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setSkipConfirmQueue(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onWindowSkip(skipConfirmQueue);
                  setSkipConfirmQueue(null);
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                Skip Queue
              </button>
            </div>
          </div>
        </div>
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
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        {/* Mobile completed cards */}
        <div className="md:hidden space-y-3">
          {items.map((queue) => (
            <div key={queue.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-primary">{queue.queue_number}</p>
                  <p className="text-xs text-slate-500">{queue.taxpayer_name || 'Walk-in'}</p>
                </div>
                <span className="shrink-0 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  {queue.status_label || 'Completed'}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                <p>{queue.service_type || 'N/A'}</p>
                <p className="mt-0.5 text-slate-400">{queue.completed_at ? formatUtc8DateTime(queue.completed_at) : 'N/A'}</p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => onDeleteHistory(queue)} disabled={deletingHistoryId === queue.id} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                  {deletingHistoryId === queue.id ? '...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop completed table */}
        <table className="hidden md:table w-full table-auto text-xs">
          <thead className="bg-white">
            <tr className="border-b border-slate-100 text-left text-slate-500">
              <th className="px-3 py-2.5 text-[10px] font-semibold">Queue No.</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Taxpayer</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Queue Type</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Service</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Status</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Completed At</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Completed By</th>
              <th className="px-3 py-2.5 text-[10px] font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((queue) => (
              <tr key={queue.id} className="align-top hover:bg-slate-50/80">
                <td className="px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-primary">{queue.queue_number}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {getQueueWindowLabel(queue)}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-[11px] font-medium text-slate-800">{queue.taxpayer_name || 'Walk-in'}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{queue.email || queue.contact_number || 'No contact'}</p>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-700">
                  {queueTypeLabels[queue.queue_type] || 'Immediate'}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-700">{queue.service_type || 'N/A'}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    {queue.status_label || 'Completed'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-600">
                  {queue.completed_at ? formatUtc8DateTime(queue.completed_at) : 'N/A'}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-700">{queue.completed_by || 'N/A'}</td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => onDeleteHistory(queue)}
                    disabled={deletingHistoryId === queue.id}
                    className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-rose-700 disabled:opacity-40"
                  >
                    {deletingHistoryId === queue.id ? '...' : 'Delete'}
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

const COMPLETED_PAGE_SIZE = 5;

const CompletedTransactionsSection = ({
  items,
  filters,
  onFilterChange,
  onOpenView,
  onDeleteHistory,
  deletingHistoryId,
  canDeleteHistory,
  windowOptions,
  maxCompletionDate,
}) => {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / COMPLETED_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * COMPLETED_PAGE_SIZE;
  const pageItems = items.slice(startIndex, startIndex + COMPLETED_PAGE_SIZE);

  const hasActiveFilters = filters.queueNumber || filters.taxpayer || filters.queueType !== 'all'
    || filters.window !== 'all' || filters.servedBy || filters.completionDate || filters.status !== 'all';

  const handleFilterChange = (field, value) => {
    setPage(1);
    onFilterChange(field, value);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Audit Visibility</p>
              <h2 className="mt-2 text-2xl font-bold text-primary">Completed Queue Transactions</h2>
              <p className="mt-2 text-sm text-slate-500">
                Review completed branch queue transactions with dynamic branch-based service and window context.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                {items.length} completed entr{items.length === 1 ? 'y' : 'ies'}
              </span>
              {hasActiveFilters ? (
                <button
                  onClick={() => {
                    setPage(1);
                    ['queueNumber', 'taxpayer', 'servedBy', 'completionDate'].forEach((f) => onFilterChange(f, ''));
                    ['queueType', 'window', 'status'].forEach((f) => onFilterChange(f, 'all'));
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 shadow-sm"
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <input
              type="text"
              value={filters.queueNumber}
              onChange={(event) => handleFilterChange('queueNumber', event.target.value)}
              placeholder="Filter by queue number"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/20 transition"
            />
            <input
              type="text"
              value={filters.taxpayer}
              onChange={(event) => handleFilterChange('taxpayer', event.target.value)}
              placeholder="Search taxpayer or customer"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/20 transition"
            />
            <CustomSelect value={filters.queueType} onChange={(value) => handleFilterChange('queueType', value)} options={[{ value: 'all', label: 'All queue types' }, { value: 'immediate', label: 'Immediate' }, { value: 'appointment', label: 'Appointment' }]} placeholder="All queue types" />
            <CustomSelect value={filters.window} onChange={(value) => handleFilterChange('window', value)} options={[{ value: 'all', label: 'All windows' }, ...windowOptions.map((option) => ({ value: option.key, label: option.label }))]} placeholder="All windows" />
            <input
              type="text"
              value={filters.servedBy}
              onChange={(event) => handleFilterChange('servedBy', event.target.value)}
              placeholder="Filter by served by"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/20 transition"
            />
            <CustomDatePicker
              value={filters.completionDate}
              onChange={(event) => handleFilterChange('completionDate', event.target.value)}
              max={maxCompletionDate}
            />
            <CustomSelect value={filters.status} onChange={(value) => handleFilterChange('status', value)} options={[{ value: 'all', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'skipped', label: 'Skipped' }]} placeholder="All statuses" />
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-500">No completed queue transactions match the current filters.</p>
          {hasActiveFilters ? (
            <p className="mt-1 text-xs text-slate-400">Try adjusting or clearing the filters above.</p>
          ) : null}
        </div>
      ) : (
        <>
          {/* Mobile completed history cards */}
          <div className="md:hidden space-y-3">
            {pageItems.map((queue) => (
              <div key={queue.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-primary">{queue.queue_number}</p>
                    <p className="text-xs text-slate-500">{queue.taxpayer_name || 'Walk-in'}</p>
                  </div>
                  <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${completedStatusClasses[queue.status] || 'bg-slate-100 text-slate-700'}`}>
                    {queue.status_label || 'Completed'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  <p>{queue.service_type || 'N/A'}</p>
                  <p className="mt-0.5 text-slate-400">{queue.completed_at ? formatUtc8DateTime(queue.completed_at) : 'N/A'}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => onOpenView(queue)} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">View</button>
                  <button onClick={() => onDeleteHistory(queue)} disabled={!canDeleteHistory || deletingHistoryId === queue.id} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                    {deletingHistoryId === queue.id ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop completed history table */}
          <div className="hidden md:block rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-white">
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="px-3 py-2 font-semibold">Queue No.</th>
                  <th className="px-3 py-2 font-semibold">Taxpayer</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Window</th>
                  <th className="px-3 py-2 font-semibold">Service</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Served</th>
                  <th className="px-3 py-2 font-semibold">Completed</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((queue) => (
                  <tr key={queue.id} className="align-middle hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-primary">{queue.queue_number}</p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                        {queue.document_processing_status}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-800">{queue.taxpayer_name || 'Walk-in'}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{queue.email || queue.contact_number || 'No contact'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {queueTypeLabels[queue.queue_type] || 'Immediate'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <p className="font-medium text-slate-800">{queue.window_label}</p>
                      {queue.window_assignment && queue.window_assignment !== 'Window not assigned' ? (
                        <p className="mt-0.5 text-[10px] text-slate-500">{queue.window_assignment}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{queue.service_type || 'N/A'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${completedStatusClasses[queue.status] || 'bg-slate-100 text-slate-700'}`}>
                        {queue.status_label || 'Completed'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {queue.served_at ? formatUtc8DateTime(queue.served_at) : 'N/A'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {queue.completed_at ? formatUtc8DateTime(queue.completed_at) : 'N/A'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{queue.completed_by || 'N/A'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => onOpenView(queue)}
                          className="rounded-md bg-blue-600 px-2 py-1 text-center text-[10px] font-semibold text-white transition hover:bg-blue-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => onDeleteHistory(queue)}
                          disabled={!canDeleteHistory || deletingHistoryId === queue.id}
                          className="rounded-md bg-rose-600 px-2 py-1 text-center text-[10px] font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                          title={canDeleteHistory ? 'Delete completed transaction' : 'You do not have permission to delete completed transactions'}
                        >
                          {deletingHistoryId === queue.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {Array.from({ length: COMPLETED_PAGE_SIZE - pageItems.length }).map((_, i) => (
                  <tr key={`empty-${i}`} className="h-[54px]">
                    <td colSpan="10" className="px-3 py-2.5">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing {startIndex + 1}–{Math.min(startIndex + COMPLETED_PAGE_SIZE, items.length)} of {items.length} entr{items.length === 1 ? 'y' : 'ies'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-60"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
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

const QueueManagement = () => {
  const { branchSlug } = useParams();
  const navigate = useNavigate();
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isSuperadminManagedBranch = Boolean(branchUser?.superadmin_managed_branch);
  const isQueueWindowAccount = branchUser?.account_scope === 'queue_window';
  const isBranchAdmin = branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin';
  const isMonitorOnlyRole = !isQueueWindowAccount && (isSuperadminManagedBranch || isBranchAdmin);
  const canManageQueueOperations = !isMonitorOnlyRole;
  const canDeleteCompletedTransactions = isSuperadminManagedBranch || isBranchAdmin || !isMonitorOnlyRole;
  const assignedWindowLabel = branchUser?.window_label || branchUser?.service_window_label || (branchUser?.service_window === 'BUSINESS' ? 'BT' : (branchUser?.service_window || ''));
  const assignedPhysicalWindowLabel = branchUser?.assigned_window_number ? `Window ${branchUser.assigned_window_number}` : '';
  const assignedWindowKey = branchUser?.service_window || 'MISC';
  const managedWindowAccounts = Array.isArray(branchUser?.window_accounts) ? branchUser.window_accounts : [];
  const [queues, setQueues] = useState([]);
  const [queueHistory, setQueueHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [systemStatus, setSystemStatus] = useState(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
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
  const [callingNext, setCallingNext] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [historySearch, setHistorySearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
    QW4: '',
    QW5: '',
  });
  const [currentDateInputValue, setCurrentDateInputValue] = useState(getTodayDateInputValue);
  const [completedTransactionFilters, setCompletedTransactionFilters] = useState({
    queueNumber: '',
    taxpayer: '',
    queueType: 'all',
    window: 'all',
    servedBy: '',
    completionDate: '',
    status: 'all',
  });
  const [selectedCompletedTransaction, setSelectedCompletedTransaction] = useState(null);
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
  const [lastCalledQueue, setLastCalledQueue] = useState(null);
  const lastCalledQueueRef = useRef(null);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInServiceType, setWalkInServiceType] = useState('');
  const [walkInTaxpayerName, setWalkInTaxpayerName] = useState('');
  const [walkInContactNumber, setWalkInContactNumber] = useState('');
  const [walkInError, setWalkInError] = useState('');
  const [addingWalkIn, setAddingWalkIn] = useState(false);
  const receiptDraftCategory = (receiptDraft?.selected_category || receiptDraft?.tax_type || resolveReceiptCategory(completionQueue)).trim().toUpperCase();
  const completionReceiptCategory = resolveReceiptCategory(completionQueue);
  const isCtcFileOnlyCompletion = completionReceiptCategory === 'CTC';
  const receiptDraftMissingFields = getReceiptDraftMissingFields(receiptDraft, receiptDraftCategory);
  const receiptDraftExtractionWarning = buildExtractionWarningMessage(receiptDraftMissingFields, receiptDraftCategory);
  const receiptDraftFilenameMismatchBlocked = Boolean(
    receiptDraft?.taxpayer_name &&
    receiptDraft?.filename_matches_taxpayer === false &&
    !receiptDraft?.auto_rename_source_image
  );
  const receiptDraftAmountInvalid = isAmountInvalid(receiptDraft?.amount);
  const receiptDraftSaveBlocked = Boolean(
    receiptDraft?.duplicate_detected ||
    receiptDraft?.category_warning ||
    receiptDraftMissingFields.length ||
    receiptDraftFilenameMismatchBlocked ||
    receiptDraftAmountInvalid
  );

  const dispatchQueueStateUpdate = (nextQueues) => {
    window.dispatchEvent(new CustomEvent(BRANCH_QUEUE_UPDATED_EVENT, {
      detail: {
        queues: Array.isArray(nextQueues) ? nextQueues : [],
      },
    }));
  };

  const applyQueueSnapshot = (nextQueues) => {
    let normalizedQueues = Array.isArray(nextQueues) ? nextQueues : [];
    normalizedQueues = normalizedQueues.map((q) => ({
      ...q,
      queue_type: q.queue_type === 'kiosk' ? 'immediate' : q.queue_type,
    }));
    setQueues(normalizedQueues);
    dispatchQueueStateUpdate(normalizedQueues);
    return normalizedQueues;
  };

  const updateQueuesLocally = (updater) => {
    setQueues((currentQueues) => {
      const nextQueues = typeof updater === 'function' ? updater(currentQueues) : updater;
      dispatchQueueStateUpdate(nextQueues);
      return nextQueues;
    });
  };

  const clearLastCalledQueue = (queueId = null) => {
    if (queueId !== null && lastCalledQueueRef.current?.id !== queueId && lastCalledQueue?.id !== queueId) {
      return;
    }
    setLastCalledQueue(null);
    lastCalledQueueRef.current = null;
  };

  const fetchQueues = async () => {
    try {
      const [queueResponse, historyResponse, statusResponse] = await Promise.all([
        api.get('/branch/queue'),
        api.get('/branch/queue/history'),
        api.get('/public/system-status'),
      ]);
      const nextQueues = queueResponse.data || [];
      applyQueueSnapshot(nextQueues);
      setQueueHistory(historyResponse.data || []);
      setSystemStatus(statusResponse.data);
      setLastRefreshedAt(new Date().toISOString());
      setError('');
      return nextQueues;
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load queue.');
      return [];
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
    setCurrentDateInputValue(getTodayDateInputValue());
    const interval = setInterval(() => {
      setCurrentDateInputValue((current) => {
        const next = getTodayDateInputValue();
        return current === next ? current : next;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-clear invalid recall state - monitors queue list and clears stale lastCalledQueue
  useEffect(() => {
    const checkRecallValidity = () => {
      if (!lastCalledQueue) return;

      const queue = queues.find(q => q.id === lastCalledQueue.id);
      const status = queue?.status?.toLowerCase();

      // Clear if queue no longer exists or is not in active status
      if (!queue || !['called', 'serving'].includes(status)) {
        console.log('Auto-clearing invalid recall state:', lastCalledQueue.queue_number);
        setLastCalledQueue(null);
        lastCalledQueueRef.current = null;
      }
    };

    // Check immediately and then every 10 seconds
    checkRecallValidity();
    const interval = setInterval(checkRecallValidity, 10000);
    return () => clearInterval(interval);
  }, [queues, lastCalledQueue]);

  useEffect(() => {
    setImmediatePage(1);
    setAppointmentPage(1);
    setSkippedPage(1);
  }, [queueTypeFilter, statusFilter, dateFilter, timeSlotFilter, serviceTypeFilter, windowFilter, queueNumberFilter, searchFilter]);

  const windowOptions = useMemo(() => {
    const fromAccounts = managedWindowAccounts.map((account) => ({
      key: account.service_window,
      label: account.window_label || account.service_window_label || getQueueWindowLabel(account.service_window),
      username: account.username,
    })).filter((item) => item.key);
    const seen = new Set(fromAccounts.map((item) => item.key));
    queues.forEach((queue) => {
      const key = queue.service_window || 'MISC';
      if (!seen.has(key)) {
        seen.add(key);
        fromAccounts.push({ key, label: getQueueWindowLabel(queue), username: '' });
      }
    });
    return fromAccounts;
  }, [managedWindowAccounts, queues]);

  const windowMetadataByKey = useMemo(() => (
    windowOptions.reduce((accumulator, option) => {
      accumulator[option.key] = option;
      return accumulator;
    }, {})
  ), [windowOptions]);

  const selectedCallNextWindow = isQueueWindowAccount
    ? assignedWindowKey
    : (isSuperadminManagedBranch && windowFilter !== 'all' ? windowFilter : null);

  const buildCallNextRequestConfig = () => ({
    params: {
      ...(selectedCallNextWindow ? { service_window: selectedCallNextWindow } : {}),
      ...(firstCallableQueue?.id ? { queue_id: firstCallableQueue.id } : {}),
    },
  });

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
      updateQueuesLocally((currentQueues) => currentQueues.filter((entry) => entry.id !== queue.id));
      clearLastCalledQueue(queue.id);
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
      setCompletionError('Choose a receipt image before continuing.');
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
      const response = await receiptAPI.uploadForOCR(formData, { queue_context: 'true' });
      const resolvedCategory = normalizeReceiptCategory(response.data?.selected_category || response.data?.tax_type || response.data?.category || category);
      const todayDate = getTodayDateInputValue();
      setReceiptDraft(normalizeReceiptDraftReviewState({
        ...defaultReceiptDraft(completionQueue),
        ...response.data,
        transaction_date: resolvedCategory === 'MARKET'
          ? todayDate
          : response.data?.transaction_date,
        ref_number: resolvedCategory === 'CTC' ? '' : response.data?.ref_number,
        taxpayer_name: resolvedCategory === 'CTC' ? '' : response.data?.taxpayer_name,
        amount: resolvedCategory === 'CTC' ? null : response.data?.amount,
        tax_type: response.data?.tax_type || category,
        selected_category: response.data?.selected_category || category,
      }));
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
        const resolvedCategory = normalizeReceiptCategory(response.data?.result?.selected_category || response.data?.result?.tax_type || response.data?.result?.category || resolveReceiptCategory(completionQueue));
        const todayDate = getTodayDateInputValue();
        setReceiptDraft(normalizeReceiptDraftReviewState({
          ...defaultReceiptDraft(completionQueue),
          ...response.data.result,
          transaction_date: resolvedCategory === 'MARKET'
            ? todayDate
            : response.data?.result?.transaction_date,
          ref_number: resolvedCategory === 'CTC' ? '' : response.data?.result?.ref_number,
          taxpayer_name: resolvedCategory === 'CTC' ? '' : response.data?.result?.taxpayer_name,
          amount: resolvedCategory === 'CTC' ? null : response.data?.result?.amount,
        }));
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
    setReceiptDraft((current) => normalizeReceiptDraftReviewState({
      ...current,
      [name]: name === 'amount' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const handleMarketDateChange = (event) => {
    const { name, value } = event.target;
    if (name === 'transaction_date' && isMarketIssueDateInvalid(value)) {
      setCompletionError('Date of Issue must be today.');
      return;
    }
    if (name === 'market_valid_until' && isMarketValidUntilInvalid(value)) {
      setCompletionError('Valid Until cannot be in the past.');
      return;
    }
    setCompletionError('');
    handleReceiptDraftChange(event);
  };

  const saveReceiptAndCompleteQueue = async () => {
    if (!completionQueue || !receiptDraft) {
      return;
    }
    const reviewedDraft = normalizeReceiptDraftReviewState(receiptDraft);
    if (
      reviewedDraft?.duplicate_detected ||
      reviewedDraft?.category_warning ||
      getReceiptDraftMissingFields(reviewedDraft, receiptDraftCategory).length ||
      isAmountInvalid(reviewedDraft?.amount) ||
      (
        reviewedDraft?.taxpayer_name &&
        reviewedDraft?.filename_matches_taxpayer === false &&
        !reviewedDraft?.auto_rename_source_image
      )
    ) {
      return;
    }
    try {
      setSavingReceipt(true);
      setCompletionError('');
      setCompletionNotice('');
      const category = resolveReceiptCategory(completionQueue);
      await receiptAPI.saveRecord({
        ...reviewedDraft,
        amount: reviewedDraft.amount === '' ? null : reviewedDraft.amount,
        tax_type: reviewedDraft.tax_type || category,
        selected_category: reviewedDraft.selected_category || category,
        detected_category: reviewedDraft.detected_category || category,
        category_match: reviewedDraft.category_match !== false,
        auto_rename_source_image: reviewedDraft.auto_rename_source_image === true,
      });
      setReceiptSavedForCompletion(true);
      setCompletionNotice('Receipt uploaded and saved to Receipt Management. You can now complete this queue.');
      setReceiptDraft(null);
      setReceiptUploadFile(null);
      setCompletionMode('options');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setCompletionError((typeof detail === 'object' ? detail?.message : detail) || 'Failed to save receipt.');
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
        setCallingNext(true);
        let response;
        try {
          response = await api.post('/branch/queue/call-next', null, buildCallNextRequestConfig());
        } catch (err) {
          if (err.response?.status === 409) {
            const refreshedQueues = await fetchQueues();
            const refreshedActiveQueue = (refreshedQueues || []).find((entry) =>
              isSelectedCallNextWindowQueue(entry) &&
              ['called', 'serving'].includes((entry.status || '').toLowerCase()),
            );
            if (!refreshedActiveQueue) {
              response = await api.post('/branch/queue/call-next', null, buildCallNextRequestConfig());
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
        const calledQueue = response.data;
        await fetchQueues();
        
        // Store last called queue with service_window (NOT service_type)
        if (calledQueue && calledQueue.queue_number) {
          const queueData = {
            id: calledQueue.id,
            queue_number: calledQueue.queue_number,
            service_window: calledQueue.service_window || 'MISC',
            assigned_window_number: calledQueue.assigned_window_number,
            status: calledQueue.status,
            timestamp: new Date().toISOString(),
          };
          setLastCalledQueue(queueData);
          lastCalledQueueRef.current = queueData;

          // Trigger announcement on Live Monitor via localStorage
          localStorage.setItem('queue_announcement_trigger', JSON.stringify({
            queue_number: calledQueue.queue_number,
            queue_id: calledQueue.id,
            service_window: calledQueue.service_window || 'MISC',
            assigned_window_number: calledQueue.assigned_window_number,
            recall: false,
            timestamp: Date.now(),
          }));
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
      } else if (action === 'recall') {
        // Validate queue before recall
        if (!lastCalledQueue) {
          setError('No queue available to recall.');
          return;
        }

        const currentQueue = queues.find(q => q.id === lastCalledQueue.id);
        const currentStatus = currentQueue?.status?.toLowerCase();

        if (!currentQueue || !['called', 'serving'].includes(currentStatus)) {
          setError('Queue is no longer active and cannot be recalled.');
          setLastCalledQueue(null);
          lastCalledQueueRef.current = null;
          return;
        }

        // Trigger recall announcement on Live Monitor
        localStorage.setItem('queue_announcement_trigger', JSON.stringify({
          queue_number: lastCalledQueue.queue_number,
          queue_id: lastCalledQueue.id,
          service_window: lastCalledQueue.service_window,
          assigned_window_number: lastCalledQueue.assigned_window_number,
          recall: true,
          timestamp: Date.now(),
        }));
        return;
      } else if (action === 'recall-skipped') {
        await api.post(`/branch/queue/${queue.id}/recall-skipped`);
      } else {
        await api.post(`/branch/queue/${queue.id}/${action}`);
      }
      await fetchQueues();
      
      // Clear lastCalledQueue if the queue was completed, deleted, skipped, or cancelled
      if (['complete', 'skip', 'delete'].includes(action) && queue) {
        clearLastCalledQueue(queue.id);
      }
      
      if (action === 'delete' || action === 'delete-history') {
        setQueueToDelete(null);
        setHistoryToDelete(null);
        setShowDeleteModal(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${action.replace('-', ' ')} queue.`);
    } finally {
      if (action === 'call-next') {
        setCallingNext(false);
      } else if (action === 'delete') {
        setDeletingQueueId(null);
      } else if (action === 'delete-history') {
        setDeletingHistoryId(null);
      } else if (action === 'complete') {
        setCompletingQueueId(null);
      }
    }
  };

  const handleAddWalkIn = async () => {
    setWalkInError('');
    const effectiveServiceType = isQueueWindowAccount ? assignedWindowKey : walkInServiceType.trim();
    if (!effectiveServiceType) {
      setWalkInError('Service type is required.');
      return;
    }
    if (!walkInTaxpayerName.trim()) {
      setWalkInError('Taxpayer name is required.');
      return;
    }
    try {
      setAddingWalkIn(true);
      await api.post('/branch/queue/walk-in', {
        service_type: effectiveServiceType,
        taxpayer_name: walkInTaxpayerName.trim(),
        contact_number: walkInContactNumber.trim() || undefined,
      });
      setShowWalkInModal(false);
      setWalkInServiceType('');
      setWalkInTaxpayerName('');
      setWalkInContactNumber('');
      setWalkInError('');
      await fetchQueues();
    } catch (err) {
      setWalkInError(err.response?.data?.detail || 'Failed to register walk-in queue.');
    } finally {
      setAddingWalkIn(false);
    }
  };

  const handleWindowCallNext = async (serviceWindow) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    setCallingNext(true);
    try {
      let response;
      try {
        response = await api.post('/branch/queue/call-next', null, {
          params: { service_window: serviceWindow },
        });
      } catch (err) {
        if (err.response?.status === 409) {
          const refreshedQueues = await fetchQueues();
          const refreshedActiveQueue = (refreshedQueues || []).find((entry) =>
            (entry.service_window || 'MISC') === serviceWindow &&
            ['called', 'serving'].includes((entry.status || '').toLowerCase()),
          );
          if (!refreshedActiveQueue) {
            response = await api.post('/branch/queue/call-next', null, {
              params: { service_window: serviceWindow },
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      const calledQueue = response.data;
      const refreshedQueues = await fetchQueues();
      const refreshedQueue = refreshedQueues.find((q) => q.id === calledQueue?.id);
      const queueToAnnounce = refreshedQueue || calledQueue;
      if (queueToAnnounce && queueToAnnounce.queue_number) {
        const queueData = {
          id: queueToAnnounce.id,
          queue_number: queueToAnnounce.queue_number,
          service_window: queueToAnnounce.service_window || 'MISC',
          assigned_window_number: queueToAnnounce.assigned_window_number,
          status: queueToAnnounce.status,
          timestamp: new Date().toISOString(),
        };
        setLastCalledQueue(queueData);
        lastCalledQueueRef.current = queueData;

        localStorage.setItem('queue_announcement_trigger', JSON.stringify({
          queue_number: queueToAnnounce.queue_number,
          queue_id: queueToAnnounce.id,
          service_window: queueToAnnounce.service_window || 'MISC',
          assigned_window_number: queueToAnnounce.assigned_window_number,
          recall: false,
          timestamp: Date.now(),
        }));
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to call next queue.');
    } finally {
      setCallingNext(false);
    }
  };

  const handleWindowRecall = (queue) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!queue) {
      setError('No queue available to recall.');
      return;
    }
    const currentQueue = queues.find(q => q.id === queue.id);
    const currentStatus = currentQueue?.status?.toLowerCase();
    if (!currentQueue || !['called', 'serving'].includes(currentStatus)) {
      setError('Queue is no longer active and cannot be recalled.');
      return;
    }
    localStorage.setItem('queue_announcement_trigger', JSON.stringify({
      queue_number: currentQueue.queue_number,
      queue_id: currentQueue.id,
      service_window: currentQueue.service_window,
      assigned_window_number: currentQueue.assigned_window_number,
      recall: true,
      timestamp: Date.now(),
    }));
  };

  const handleWindowSkip = async (queue) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!queue) {
      setError('No active queue to skip.');
      return;
    }
    try {
      await api.post(`/branch/queue/${queue.id}/skip`);
      await fetchQueues();
      clearLastCalledQueue(queue.id);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to skip queue.');
    }
  };

  const handleWindowServe = async (queue) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!queue) {
      setError('No active queue to serve.');
      return;
    }
    try {
      await api.post(`/branch/queue/${queue.id}/serve`);
      await fetchQueues();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to serve queue.');
    }
  };

  const handleWindowComplete = (queue) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!queue) {
      setError('No active queue to complete.');
      return;
    }
    setCompletionQueue(queue);
    setCompletionMode('options');
    setCompletionError('');
    setCompletionNotice('');
    setReceiptSavedForCompletion(false);
    setShowCancelCompletionConfirm(false);
    setReceiptDraft(null);
    setReceiptUploadFile(null);
    setMobileSession(null);
  };

  const handleWindowRecallSkipped = async (queue) => {
    setError('');
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!queue) {
      setError('No skipped queue to pull up.');
      return;
    }
    try {
      await api.post(`/branch/queue/${queue.id}/recall-skipped`);
      await fetchQueues();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to pull up queue.');
    }
  };

  const now = useMemo(() => new Date(), [queues]);
  const queueUnavailable = systemStatus && (!systemStatus.queueEnabled || systemStatus.maintenanceMode);
  const isSelectedCallNextWindowQueue = (queue) => (
    !selectedCallNextWindow || (queue.service_window || 'MISC') === selectedCallNextWindow
  );
  const activeQueue = useMemo(
    () => queues.find((queue) => (
      isSelectedCallNextWindowQueue(queue) &&
      ['called', 'serving'].includes((queue.status || '').toLowerCase())
    )),
    [queues, selectedCallNextWindow],
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
  const firstCallableQueue = useMemo(
    () => sortQueues(filteredQueues.filter((queue) => getDerivedStatus(queue, now) === 'waiting'), now)[0] || null,
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

  const completedTransactions = useMemo(() => (
    queueHistory
      .map((queue) => {
        const windowKey = queue.service_window || 'MISC';
        const windowMetadata = windowMetadataByKey[windowKey];
        const completedAt = queue.completed_at || queue.archived_at || null;
        const completionDate = formatDateInputValue(completedAt);
        const servedBy = queue.completed_by || '';
        return {
          ...queue,
          window_key: windowKey,
          window_label: windowMetadata?.label || getQueueWindowLabel(windowKey),
          window_assignment: windowMetadata?.assigned_window_number ? `Window ${windowMetadata.assigned_window_number}` : 'Window not assigned',
          completion_date_value: completionDate,
          served_by_search: servedBy.toLowerCase(),
          document_processing_status: queue.document_processing_status || 'No linked OCR / document status',
        };
      })
      .filter((queue) => {
        const queueNumberMatch = !completedTransactionFilters.queueNumber
          || (queue.queue_number || '').toLowerCase().includes(completedTransactionFilters.queueNumber.toLowerCase());
        const taxpayerMatch = !completedTransactionFilters.taxpayer
          || [
            queue.taxpayer_name,
            queue.email,
            queue.contact_number,
          ].filter(Boolean).join(' ').toLowerCase().includes(completedTransactionFilters.taxpayer.toLowerCase());
        const queueTypeMatch = completedTransactionFilters.queueType === 'all'
          || queue.queue_type === completedTransactionFilters.queueType;
        const windowMatch = completedTransactionFilters.window === 'all'
          || queue.window_key === completedTransactionFilters.window;
        const servedByMatch = !completedTransactionFilters.servedBy
          || queue.served_by_search.includes(completedTransactionFilters.servedBy.toLowerCase());
        const completionDateMatch = !completedTransactionFilters.completionDate
          || queue.completion_date_value === completedTransactionFilters.completionDate;
        const statusMatch = completedTransactionFilters.status === 'all'
          || (queue.status || '').toLowerCase() === completedTransactionFilters.status;

        return queueNumberMatch
          && taxpayerMatch
          && queueTypeMatch
          && windowMatch
          && servedByMatch
          && completionDateMatch
          && statusMatch;
      })
      .sort((left, right) => {
        const rightDate = parseDate(right.completed_at || right.archived_at)?.getTime() || 0;
        const leftDate = parseDate(left.completed_at || left.archived_at)?.getTime() || 0;
        return rightDate - leftDate;
      })
  ), [queueHistory, windowMetadataByKey, completedTransactionFilters]);

  const monitoredWindows = useMemo(() => {
    const sourceWindows = windowOptions.length > 0
      ? windowOptions
      : Array.from(
        new Map(
          queues.map((queue) => [
            queue.service_window || 'MISC',
            {
              key: queue.service_window || 'MISC',
              label: getQueueWindowLabel(queue),
              username: '',
            },
          ]),
        ).values(),
      );

    return sourceWindows
      .filter((windowOption) => windowFilter === 'all' || windowOption.key === windowFilter)
      .map((windowOption) => {
        const matchingQueues = sortQueues(
          filteredQueues.filter((queue) => (queue.service_window || 'MISC') === windowOption.key),
          now,
        );
        const serviceTypesForWindow = Array.from(new Set(matchingQueues.map((queue) => queue.service_type).filter(Boolean))).sort();
        const queueTypeSet = new Set(matchingQueues.map((queue) => queue.queue_type || 'immediate'));
        if (queueTypeFilter === 'all' && queueTypeSet.size === 0) {
          queueTypeSet.add('immediate');
          queueTypeSet.add('appointment');
        }

        return {
          service_window: windowOption.key,
          window_label: windowOption.label || getQueueWindowLabel(windowOption.key),
          assigned_window_number:
            queues.find((queue) => (queue.service_window || 'MISC') === windowOption.key)?.assigned_window_number ||
            managedWindowAccounts.find((account) => account.service_window === windowOption.key)?.assigned_window_number ||
            null,
          queues: matchingQueues,
          queueTypes: Array.from(queueTypeSet),
          serviceTypes: serviceTypesForWindow,
          serviceTypesLabel: serviceTypesForWindow.length > 0 ? serviceTypesForWindow.join(', ') : 'No matching service type',
        };
      })
      .filter((window) => {
        if (serviceTypeFilter !== 'all') {
          return window.queues.length > 0;
        }
        return window.queueTypes.length > 0;
      });
  }, [windowOptions, queues, windowFilter, filteredQueues, now, queueTypeFilter, managedWindowAccounts, serviceTypeFilter]);

  const windowsByQueueType = useMemo(() => {
    const groups = { immediate: [], appointment: [] };

    monitoredWindows.forEach((window) => {
      const queueTypes = queueTypeFilter === 'all'
        ? window.queueTypes
        : [queueTypeFilter];

      queueTypes.forEach((queueTypeKey) => {
        if (!groups[queueTypeKey]) {
          groups[queueTypeKey] = [];
        }

        const queuesForType = window.queues.filter((queue) => (queue.queue_type || 'immediate') === queueTypeKey);
        const serviceTypesForQueueType = Array.from(new Set(queuesForType.map((queue) => queue.service_type).filter(Boolean))).sort();
        if (queueTypeFilter !== 'all' && queuesForType.length === 0) {
          return;
        }

        groups[queueTypeKey].push({
          ...window,
          queues: queuesForType,
          serviceTypes: serviceTypesForQueueType,
          serviceTypesLabel: serviceTypesForQueueType.length > 0 ? serviceTypesForQueueType.join(', ') : window.serviceTypesLabel,
        });
      });
    });

    if (queueTypeFilter === 'all') {
      return groups;
    }

    return {
      [queueTypeFilter]: groups[queueTypeFilter] || [],
    };
  }, [monitoredWindows, queueTypeFilter]);

  const visibleHistorySections = useMemo(() => {
    if (isQueueWindowAccount) {
      return [
        {
          key: assignedWindowKey,
          title: `Completed ${assignedWindowLabel || getQueueWindowLabel(assignedWindowKey)} Queue History`,
          description: `Completed ${(assignedWindowLabel || getQueueWindowLabel(assignedWindowKey))} queue transactions are archived here after branch staff finish servicing them.`,
          items: filteredQueueHistory[assignedWindowKey] || [],
        },
      ];
    }

    return windowOptions
      .filter((option) => (filteredQueueHistory[option.key] || []).length > 0 || ['RPT', 'BUSINESS', 'MISC'].includes(option.key))
      .map((option) => ({
        key: option.key,
        title: `Completed ${option.label} Queue History`,
        description: `Completed ${option.label} queue transactions are archived here after branch staff finish servicing them.`,
        items: filteredQueueHistory[option.key] || [],
      }));
  }, [assignedWindowKey, assignedWindowLabel, filteredQueueHistory, isQueueWindowAccount, windowOptions]);

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
            ? `Manage only the ${assignedWindowLabel} service queue for this branch${assignedPhysicalWindowLabel ? ` at ${assignedPhysicalWindowLabel}` : ''}.`
            : isMonitorOnlyRole
              ? 'Monitor queue activity across all active service windows with live, filter-driven visibility and branch-context consistency.'
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
          <p className="font-semibold">Queue-only branch staff account active for the {assignedWindowLabel} service queue{assignedPhysicalWindowLabel ? ` at ${assignedPhysicalWindowLabel}` : ''}.</p>
          <p className="mt-1 text-sm text-blue-700">
            Other branch modules are hidden, and queue actions are limited to this assigned service window.
          </p>
        </div>
      ) : null}

      {isMonitorOnlyRole ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-800 shadow-sm">
          <p className="font-semibold">Queue operations are shown in read-only mode for this branch context.</p>
          <p className="mt-1 text-sm text-slate-600">
            Queue windows, skipped queues, and completed transactions remain visible, while operational controls stay limited to authorized queue operators.
          </p>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Immediate Queue</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.immediate}</p>
          <p className="mt-2 text-sm text-slate-500">Immediate queue records after filters.</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Appointment Queue</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.appointment}</p>
          <p className="mt-2 text-sm text-slate-500">Appointment queue records after filters.</p>
        </div>
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
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Queue Filters</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">Filter And Search</h2>
            <p className="mt-2 text-sm text-slate-500">
              Narrow the queue list by type, status, date, time slot, service, queue number, or taxpayer details.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <CustomSelect value={queueTypeFilter} onChange={(value) => setQueueTypeFilter(value)} options={[{ value: 'all', label: 'All queue types' }, { value: 'immediate', label: 'Immediate' }, { value: 'appointment', label: 'Appointment' }]} placeholder="All queue types" />
          <CustomSelect value={statusFilter} onChange={(value) => setStatusFilter(value)} options={[{ value: 'all', label: 'All statuses' }, { value: 'appointment', label: 'Appointment' }, { value: 'waiting', label: 'Waiting' }, { value: 'called', label: 'Called' }, { value: 'serving', label: 'Serving' }, { value: 'completed', label: 'Completed' }, { value: 'skipped', label: 'Skipped' }]} placeholder="All statuses" />
          <CustomDatePicker value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} max={currentDateInputValue} />
          <input type="time" value={timeSlotFilter} onChange={(event) => setTimeSlotFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none" />
          <CustomSelect value={serviceTypeFilter} onChange={(value) => setServiceTypeFilter(value)} options={[{ value: 'all', label: 'All services' }, ...serviceTypes.map((serviceType) => ({ value: serviceType, label: serviceType }))]} placeholder="All services" />
          {isMonitorOnlyRole ? (
            <CustomSelect value={windowFilter} onChange={(value) => setWindowFilter(value)} options={[{ value: 'all', label: 'All branch windows' }, ...windowOptions.map((account) => ({ value: account.key, label: `${account.label}${account.username ? ` - ${account.username}` : ''}` }))]} placeholder="All branch windows" />
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

      {canManageQueueOperations ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Queue Actions</p>
              <h2 className="mt-2 text-2xl font-bold text-primary">Window Queue Controls</h2>
              <p className="mt-2 text-sm text-slate-500">
                Operational controls stay available for authorized queue staff without mixing them into the filter and search tools.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => performAction('call-next')}
                disabled={queueUnavailable || Boolean(activeQueue) || isAnnouncementPlaying || callingNext}
                className="rounded-xl bg-primary px-6 py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
              >
                {callingNext ? 'Calling...' : isAnnouncementPlaying ? 'Announcing...' : 'Call Next'}
              </button>
              <button
                onClick={() => performAction('recall')}
                disabled={queueUnavailable || !lastCalledQueue}
                className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                title={lastCalledQueue ? `Recall ${lastCalledQueue.queue_number}` : 'No queue to recall'}
              >
                Recall Queue
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
        </section>
      ) : null}

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
          {canManageQueueOperations ? (
            <p className="mt-1 text-sm text-blue-700">
              Complete or skip the current active queue before calling the next taxpayer.
            </p>
          ) : (
            <p className="mt-1 text-sm text-blue-700">
              This live status is shown for monitoring only. Queue operations remain limited to authorized staff accounts.
            </p>
          )}
        </div>
      ) : null}

      {!isSuperadminManagedBranch && (
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
            canManageQueues={canManageQueueOperations}
            headerAction={
              canManageQueueOperations ? (
                <button
                  onClick={() => {
                    setWalkInError('');
                    setShowWalkInModal(true);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                  </svg>
                  Add Walk-in
                </button>
              ) : null
            }
          />
          <QueueSection
            title="Appointment Queue"
            description="Appointment queue taxpayers stay separate so branch users can clearly distinguish scheduled appointments from ready, called, serving, completed, or skipped records."
            queues={appointmentQueues}
            page={appointmentPage}
            onPageChange={setAppointmentPage}
            queueUnavailable={queueUnavailable}
            onAction={performAction}
            onDeleteRequest={openDeleteModal}
            now={now}
            canManageQueues={canManageQueueOperations}
          />
        </div>
      )}

      {!isQueueWindowAccount ? (
        <WindowMonitoringSection
          windowsByQueueType={windowsByQueueType}
          totalFilteredCount={filteredQueues.length}
          lastRefreshedAt={lastRefreshedAt}
          now={now}
          serviceTypeFilter={serviceTypeFilter}
          queueUnavailable={queueUnavailable}
          isSuperadminBranch={isSuperadminManagedBranch}
          isBranchAdmin={isBranchAdmin}
          onWindowCallNext={handleWindowCallNext}
          onWindowRecall={handleWindowRecall}
          onWindowSkip={handleWindowSkip}
          onWindowServe={handleWindowServe}
          onWindowComplete={handleWindowComplete}
          onWindowRecallSkipped={handleWindowRecallSkipped}
          isAnnouncementPlaying={isAnnouncementPlaying}
          callingNext={callingNext}
          onDeleteRequest={openDeleteModal}
        />
      ) : null}

      <QueueSection
        title="Skipped Queue"
        description={
          isBranchAdmin
            ? 'Skipped queue records remain visible here for monitoring and audit visibility.'
            : 'Skipped taxpayers remain here instead of being deleted. Pull them back up when they return, or clear the skipped list at the end of the day.'
        }
        queues={skippedQueues}
        page={skippedPage}
        onPageChange={setSkippedPage}
        queueUnavailable={queueUnavailable}
        onAction={performAction}
        onDeleteRequest={openDeleteModal}
        now={now}
        skippedOnly
        canManageQueues={canManageQueueOperations || isSuperadminManagedBranch || isBranchAdmin}
      />

      <CompletedTransactionsSection
        items={completedTransactions}
        filters={completedTransactionFilters}
        onFilterChange={(field, value) => setCompletedTransactionFilters((current) => ({ ...current, [field]: value }))}
        onOpenView={setSelectedCompletedTransaction}
        onDeleteHistory={openDeleteHistoryModal}
        deletingHistoryId={deletingHistoryId}
        canDeleteHistory={canDeleteCompletedTransactions}
        windowOptions={windowOptions}
        maxCompletionDate={currentDateInputValue}
      />

      {selectedCompletedTransaction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Completed Transaction</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">{selectedCompletedTransaction.queue_number}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {selectedCompletedTransaction.taxpayer_name || 'Walk-in'} | {selectedCompletedTransaction.service_type || 'N/A'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCompletedTransaction(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ['Queue Number', selectedCompletedTransaction.queue_number],
                ['Queue Type', queueTypeLabels[selectedCompletedTransaction.queue_type] || 'Immediate'],
                ['Taxpayer / Customer', selectedCompletedTransaction.taxpayer_name || 'Walk-in'],
                ['Email', selectedCompletedTransaction.email || 'N/A'],
                ['Contact Number', selectedCompletedTransaction.contact_number || 'N/A'],
                ['Assigned Window', selectedCompletedTransaction.window_label || 'N/A'],
                ['Window Assignment', selectedCompletedTransaction.window_assignment || 'N/A'],
                ['Service Type', selectedCompletedTransaction.service_type || 'N/A'],
                ['Transaction Status', selectedCompletedTransaction.status_label || 'Completed'],
                ['OCR / Document Processing Status', selectedCompletedTransaction.document_processing_status || 'No linked OCR / document status'],
                ['Created At', selectedCompletedTransaction.created_at ? formatUtc8DateTime(selectedCompletedTransaction.created_at) : 'N/A'],
                ['Served At', selectedCompletedTransaction.served_at ? formatUtc8DateTime(selectedCompletedTransaction.served_at) : 'N/A'],
                ['Completed At', selectedCompletedTransaction.completed_at ? formatUtc8DateTime(selectedCompletedTransaction.completed_at) : 'N/A'],
                ['Archived At', selectedCompletedTransaction.archived_at ? formatUtc8DateTime(selectedCompletedTransaction.archived_at) : 'N/A'],
                ['Served By', selectedCompletedTransaction.completed_by || 'N/A'],
                ['Estimated Wait Time', selectedCompletedTransaction.estimated_wait_time ? `${selectedCompletedTransaction.estimated_wait_time} min` : 'N/A'],
                ['Recommended Arrival', selectedCompletedTransaction.recommended_arrival ? formatUtc8DateTime(selectedCompletedTransaction.recommended_arrival) : 'N/A'],
                ['Appointment Time', selectedCompletedTransaction.appointment_time ? formatUtc8DateTime(selectedCompletedTransaction.appointment_time) : 'N/A'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">{value || 'N/A'}</p>
                </div>
              ))}
            </div>
          </div>
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
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-left transition hover:border-emerald-400 hover:bg-emerald-100 disabled:opacity-60 md:col-span-2"
                  >
                    <p className="text-lg font-bold text-emerald-900">Complete Queue</p>
                    <p className="mt-2 text-sm leading-6 text-emerald-700">
                      Receipt is already uploaded and saved.
                    </p>
                  </button>
                ) : null}
                {!receiptSavedForCompletion ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCompletionError('');
                        setCompletionNotice('');
                        setCompletionMode('file');
                      }}
                      className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-6 text-left transition hover:border-blue-400 hover:bg-blue-100"
                    >
                      <p className="text-lg font-bold text-blue-900">File Upload</p>
                      <p className="mt-2 text-sm leading-6 text-blue-700">
                        {isCtcFileOnlyCompletion
                          ? 'Upload a receipt copy image from this computer. CTC is saved without OCR.'
                          : 'Upload a receipt image from this computer and run OCR.'}
                      </p>
                    </button>
                    {!isCtcFileOnlyCompletion ? (
                      <button
                        type="button"
                        onClick={startMobileReceiptUpload}
                        disabled={processingReceipt}
                        className="rounded-2xl border border-purple-200 bg-purple-50 px-5 py-6 text-left transition hover:border-purple-400 hover:bg-purple-100 disabled:opacity-60"
                      >
                        <p className="text-lg font-bold text-purple-900">Via Mobile QR</p>
                        <p className="mt-2 text-sm leading-6 text-purple-700">Scan a QR code and take the receipt photo from a phone.</p>
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {completionMode === 'file' ? (
              <form onSubmit={handleFileReceiptUpload} className="mt-6 space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                  Default receipt category: <span className="font-bold text-slate-900">{resolveReceiptCategory(completionQueue)}</span>
                  {isCtcFileOnlyCompletion ? <span className="ml-2 text-slate-500">File upload only, no OCR.</span> : null}
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Receipt Image</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(event) => {
                      setCompletionError('');
                      setReceiptUploadFile(event.target.files?.[0] || null);
                    }}
                    className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[#0f2f5f] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:border-blue-400 hover:bg-slate-50 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200 transition"
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
                    {processingReceipt ? (isCtcFileOnlyCompletion ? 'Uploading...' : 'Parsing...') : (isCtcFileOnlyCompletion ? 'Upload File' : 'Run OCR')}
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
                {receiptDraftExtractionWarning ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">Unable to Extract Required Information</p>
                    <p className="mt-1">The following fields could not be automatically extracted from the uploaded receipt:</p>
                    <ul className="mt-1 list-inside list-disc">
                      {receiptDraftMissingFields.map((field) => (
                        <li key={field}>{getReceiptFieldLabel(field, receiptDraftCategory)}</li>
                      ))}
                    </ul>
                    <p className="mt-1">Please review and complete the highlighted fields before proceeding.</p>
                  </div>
                ) : null}
                {receiptDraft.duplicate_warning || receiptDraft.category_warning ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {receiptDraft.duplicate_warning || receiptDraft.category_warning || 'This looks like a Different recipt'}
                  </div>
                ) : null}
                {receiptDraftFilenameMismatchBlocked ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    <p className="font-semibold">File name needs correction</p>
                    <p className="mt-1">{receiptDraft.file_name_validation_message || 'The uploaded file name must match the extracted taxpayer name.'}</p>
                    {receiptDraft.source_image_suggested_filename ? (
                      <p className="mt-1">Suggested file name: {receiptDraft.source_image_suggested_filename}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setReceiptDraft((current) => normalizeReceiptDraftReviewState({
                        ...current,
                        auto_rename_source_image: true,
                        filename_matches_taxpayer: true,
                      }))}
                      className="mt-3 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700"
                    >
                      Use Extracted Taxpayer Name
                    </button>
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {completionReceiptCategory === 'CTC' ? (
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Date</span>
                      <CustomDatePicker
                        name="transaction_date"
                        min={getTodayDateInputValue()}
                        max={getTodayDateInputValue()}
                        value={formatDateInputValue(receiptDraft.transaction_date || getTodayDateInputValue())}
                        disabled
                      />
                    </label>
                  ) : (
                    <>
                      {completionReceiptCategory !== 'MARKET' ? (
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Reference Number</span>
                          <input
                            name="ref_number"
                            value={receiptDraft.ref_number || ''}
                            onChange={handleReceiptDraftChange}
                            aria-invalid={receiptDraftMissingFields.includes('ref_number') ? 'true' : 'false'}
                            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none ${
                              receiptDraftMissingFields.includes('ref_number') ? 'border-red-500 bg-red-50' : 'border-slate-300'
                            }`}
                          />
                          {receiptDraftMissingFields.includes('ref_number') ? (
                            <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('ref_number', receiptDraftCategory)} could not be extracted. Please enter a value.</p>
                          ) : null}
                        </label>
                      ) : null}
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">{completionReceiptCategory === 'MARKET' ? 'Name' : 'Taxpayer Name'}</span>
                        <input
                          name="taxpayer_name"
                          value={receiptDraft.taxpayer_name || ''}
                          onChange={handleReceiptDraftChange}
                          aria-invalid={receiptDraftMissingFields.includes('taxpayer_name') ? 'true' : 'false'}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none ${
                            receiptDraftMissingFields.includes('taxpayer_name') ? 'border-red-500 bg-red-50' : 'border-slate-300'
                          }`}
                        />
                        {receiptDraftMissingFields.includes('taxpayer_name') ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('taxpayer_name', receiptDraftCategory)} could not be extracted. Please enter a value.</p>
                        ) : null}
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">{completionReceiptCategory === 'MARKET' ? 'Date of Issue' : 'Transaction Date'}</span>
                        <input
                          name="transaction_date"
                          type={completionReceiptCategory === 'MARKET' ? 'date' : 'text'}
                          min={completionReceiptCategory === 'MARKET' ? getTodayDateInputValue() : undefined}
                          max={completionReceiptCategory === 'MARKET' ? getTodayDateInputValue() : undefined}
                          value={completionReceiptCategory === 'MARKET' ? formatDateInputValue(receiptDraft.transaction_date) : (receiptDraft.transaction_date || '')}
                          onChange={completionReceiptCategory === 'MARKET' ? handleMarketDateChange : handleReceiptDraftChange}
                          aria-invalid={receiptDraftMissingFields.includes('transaction_date') ? 'true' : 'false'}
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none ${
                            receiptDraftMissingFields.includes('transaction_date') ? 'border-red-500 bg-red-50' : 'border-slate-300'
                          }`}
                        />
                        {receiptDraftMissingFields.includes('transaction_date') ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('transaction_date', receiptDraftCategory)} could not be extracted. Please enter a value.</p>
                        ) : null}
                      </label>
                      {completionReceiptCategory === 'MARKET' ? (
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">Purpose of Renewal</span>
                            <CustomSelect
                              value={getMarketPurposeSelectValue(receiptDraft.market_purpose_of_renewal)}
                              onChange={(nextValue) => setReceiptDraft((current) => normalizeReceiptDraftReviewState({
                                ...current,
                                market_purpose_of_renewal: nextValue === 'Other' ? '' : nextValue,
                              }))}
                              options={[...MARKET_PURPOSE_OPTIONS.map((option) => ({ value: option, label: option })), { value: 'Other', label: 'Other (please specify)' }]}
                              placeholder="Select purpose"
                              hasError={receiptDraftMissingFields.includes('market_purpose_of_renewal')}
                            />
                            {getMarketPurposeSelectValue(receiptDraft.market_purpose_of_renewal) === 'Other' ? (
                              <input
                                name="market_purpose_of_renewal"
                                value={receiptDraft.market_purpose_of_renewal || ''}
                                onChange={handleReceiptDraftChange}
                                placeholder="Type the purpose of renewal"
                                aria-invalid={receiptDraftMissingFields.includes('market_purpose_of_renewal') ? 'true' : 'false'}
                                className={`mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none ${
                                  receiptDraftMissingFields.includes('market_purpose_of_renewal') ? 'border-red-500 bg-red-50' : 'border-slate-300'
                                }`}
                              />
                            ) : null}
                            {receiptDraftMissingFields.includes('market_purpose_of_renewal') ? (
                              <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('market_purpose_of_renewal', receiptDraftCategory)} could not be extracted. Please enter a value.</p>
                            ) : null}
                          </label>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">Valid Until</span>
                            <CustomDatePicker
                              name="market_valid_until"
                              min={getTodayDateInputValue()}
                              value={formatDateInputValue(receiptDraft.market_valid_until)}
                              onChange={handleMarketDateChange}
                              hasError={receiptDraftMissingFields.includes('market_valid_until')}
                            />
                            {receiptDraftMissingFields.includes('market_valid_until') ? (
                              <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('market_valid_until', receiptDraftCategory)} could not be extracted. Please enter a value.</p>
                            ) : null}
                          </label>
                        </>
                      ) : (
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Amount</span>
                          <input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={receiptDraft.amount ?? ''}
                            onChange={handleReceiptDraftChange}
                            aria-invalid={receiptDraftMissingFields.includes('amount') || receiptDraftAmountInvalid ? 'true' : 'false'}
                            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none ${
                              receiptDraftMissingFields.includes('amount') || receiptDraftAmountInvalid ? 'border-red-500 bg-red-50' : 'border-slate-300'
                            }`}
                          />
                          {receiptDraftMissingFields.includes('amount') || receiptDraftAmountInvalid ? (
                            <p className="mt-1 text-xs font-semibold text-red-600">
                              {receiptDraftAmountInvalid
                                ? 'Amount must be greater than zero.'
                                : `${getReceiptFieldLabel('amount', receiptDraftCategory)} could not be extracted. Please enter a value.`}
                            </p>
                          ) : null}
                        </label>
                      )}
                    </>
                  )}
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
                  <button type="button" onClick={saveReceiptAndCompleteQueue} disabled={savingReceipt || receiptDraftSaveBlocked} className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                    {savingReceipt ? 'Saving...' : receiptDraftSaveBlocked ? 'Review Blocked' : 'Save Receipt'}
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

      {showWalkInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">Walk-in</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">Register Walk-in</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Create a queue entry for a walk-in citizen. They will be placed in the queue based on arrival time (FIFO).
                </p>
              </div>
            </div>

            {walkInError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-semibold">{walkInError}</p>
              </div>
            ) : null}

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Service Type <span className="text-red-500">*</span></label>
                {isQueueWindowAccount ? (
                  <input
                    type="text"
                    value={assignedWindowLabel}
                    disabled
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500 outline-none cursor-not-allowed"
                  />
                ) : (
                  <input
                    type="text"
                    value={walkInServiceType}
                    onChange={(e) => setWalkInServiceType(e.target.value)}
                    placeholder="e.g. Real Property Tax"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Taxpayer Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={walkInTaxpayerName}
                  onChange={(e) => setWalkInTaxpayerName(e.target.value)}
                  placeholder="Enter taxpayer name"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Contact Number <span className="font-normal text-slate-500">(optional)</span></label>
                <input
                  type="text"
                  value={walkInContactNumber}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '');
                    if (raw.startsWith('0')) {
                      setWalkInContactNumber(raw.slice(0, 11));
                    } else if (raw.startsWith('63')) {
                      setWalkInContactNumber(raw.slice(0, 12));
                    } else {
                      setWalkInContactNumber(raw.slice(0, 11));
                    }
                  }}
                  placeholder="09XXXXXXXXX"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowWalkInModal(false);
                  setWalkInServiceType('');
                  setWalkInTaxpayerName('');
                  setWalkInContactNumber('');
                  setWalkInError('');
                }}
                disabled={addingWalkIn}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddWalkIn}
                disabled={addingWalkIn || !(isQueueWindowAccount ? assignedWindowKey : walkInServiceType.trim()) || !walkInTaxpayerName.trim()}
                className="rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-70"
              >
                {addingWalkIn ? 'Registering...' : 'Register Walk-in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueueManagement;
