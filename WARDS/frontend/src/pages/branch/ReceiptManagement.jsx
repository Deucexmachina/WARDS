import { useEffect, useMemo, useRef, useState } from 'react';

import { receiptAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import ProcessingModal from '../../components/ProcessingModal';
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext';

const SECTION_PAGE_SIZE = 5;
const MAX_RELEASE_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_RELEASE_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const BRANCH_RECEIPT_UPDATED_EVENT = 'branch-receipt-updated';
const PROCESSING_SUCCESS_DELAY_MS = 1100;
const OCR_REQUIRED_RECEIPT_CATEGORIES = new Set(['RPT', 'BUSINESS', 'MISC', 'PTR', 'MARKET']);
const RECEIPT_CATEGORY_KEYS = ['RPT', 'BUSINESS', 'MISC', 'CTC', 'PTR', 'MARKET'];
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

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const dedupeRequestsById = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const requestId = item?.requestId || '';
    if (!requestId || seen.has(requestId)) {
      return false;
    }
    seen.add(requestId);
    return true;
  });
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

const detectReceiptCategoryFromDraft = (draft, fallbackCategory) => {
  const rawText = `${draft?.raw_text || ''}\n${draft?.ref_number || ''}\n${draft?.taxpayer_name || ''}`.toUpperCase();
  const reference = (draft?.ref_number || '').trim().toUpperCase();

  const businessSignals = [
    "MAYOR'S PERMIT",
    'BUSINESS TAX',
    'CITY TAX',
    'GARBAGE FEE',
    'SANITARY FEE',
    'BUILDING INSP. FEE',
    'ELECTRICAL INSP. FEE',
    'PLUMBING INSP.',
    'SIGNBOARD',
    'SPECIAL PERMIT',
  ];
  const rptSignals = [
    'REAL PROPERTY TAX',
    'BASIC TAX',
    'IDLE LAND TAX',
    'SOCIALIZED HOUSING TAX',
    'SH GARBAGE FEE',
    'LAND TAX',
    'PENALTY',
    'DISCOUNT',
  ];
  const miscSignals = [
    'MISCELLANEOUS',
    'CERTIFICATION',
    'CLEARANCE',
    'SERVICE FEE',
  ];

  const businessScore = businessSignals.filter((signal) => rawText.includes(signal)).length + (reference.startsWith('B-') ? 3 : 0);
  const rptScore = rptSignals.filter((signal) => rawText.includes(signal)).length + (reference.startsWith('R-') ? 3 : 0);
  const miscScore = miscSignals.filter((signal) => rawText.includes(signal)).length + (!reference ? 1 : 0);
  const ptrScore = [
    /\bPROFESSIONAL\s+TAX\s+RECEIPT\b/,
    /\bPROFESSIONAL\s+TAX\b/,
  ].filter((signal) => signal.test(rawText)).length;
  const marketScore = [
    'CERTIFICATE OF STALL OCCUPANCY',
    'STALL AWARDEE',
    'PUBLIC MARKET',
    'MARKET CERTIFICATE',
    'VALID UNTIL',
    'PURPOSE OF RENEWAL',
  ].filter((signal) => rawText.includes(signal)).length;

  if (businessScore > rptScore && businessScore > miscScore) {
    return 'BUSINESS';
  }
  if (rptScore > businessScore && rptScore > miscScore) {
    return 'RPT';
  }
  if (ptrScore > 0) {
    return 'PTR';
  }
  if (marketScore > 0) {
    return 'MARKET';
  }
  if (miscScore > 0) {
    return 'MISC';
  }

  return normalizeReceiptCategory(draft?.detected_category || fallbackCategory || draft?.tax_type || 'RPT');
};

const normalizeReceiptFilenameForCompare = (value) => (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const buildSuggestedReceiptFilename = (filename, taxpayerName) => {
  const extensionMatch = (filename || '').match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || '.jpg';
  const baseName = (taxpayerName || '').trim() || 'receipt';
  return `${baseName}${extension}`;
};

const formatDateInputValue = (value) => {
  const parsed = parseDateInputValue(value);
  if (!parsed) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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

const getMissingRequiredReceiptFields = (draft, category) => {
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

const paginateRows = (rows, page) => rows.slice((page - 1) * SECTION_PAGE_SIZE, page * SECTION_PAGE_SIZE);

const PaginationControls = ({ page, totalPages, totalItems, onPageChange }) => {
  if (totalItems <= SECTION_PAGE_SIZE) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
      <div className="flex gap-3">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
};

const BRANCH_TAX_DISPLAY_NAMES = {
  'Real Property Tax': 'REAL PROPERTY TAX',
  'Business Tax': 'BUSINESS TAX',
  'Miscellaneous Tax': 'MISCELLANEOUS',
  'Community Tax Certificate': 'COMMUNITY TAX CERTIFICATE',
  'Professional Tax Receipt': 'PROFESSIONAL TAX RECEIPT',
  'Market': 'MARKET',
  RPT: 'REAL PROPERTY TAX',
  'RPT WINDOW': 'REAL PROPERTY TAX',
  BT: 'BUSINESS TAX',
  'BT WINDOW': 'BUSINESS TAX',
  BUSINESS: 'BUSINESS TAX',
  'BUSINESS WINDOW': 'BUSINESS TAX',
  MISC: 'MISCELLANEOUS',
  'MISC WINDOW': 'MISCELLANEOUS',
  CTC: 'COMMUNITY TAX CERTIFICATE',
  'CTC WINDOW': 'COMMUNITY TAX CERTIFICATE',
  PTR: 'PROFESSIONAL TAX RECEIPT',
  'PTR WINDOW': 'PROFESSIONAL TAX RECEIPT',
  MARKET: 'MARKET',
  'MARKET WINDOW': 'MARKET',
};

const getBranchTaxDisplayName = (name) => {
  if (!name) return 'N/A';
  const clean = name.replace(/ Window$/i, '').trim();
  const displayName = BRANCH_TAX_DISPLAY_NAMES[clean]
    || BRANCH_TAX_DISPLAY_NAMES[clean.toUpperCase()]
    || BRANCH_TAX_DISPLAY_NAMES[name]
    || BRANCH_TAX_DISPLAY_NAMES[name.toUpperCase()];
  if (displayName) return displayName;
  return name;
};

const ReceiptManagement = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('RPT');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [ocrDraft, setOcrDraft] = useState(null);
  const [records, setRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestHistory, setRequestHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState(null);
  const [deletingRequestId, setDeletingRequestId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [uploadingReleaseId, setUploadingReleaseId] = useState(null);
  const [processingFeedback, setProcessingFeedback] = useState(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedCompletedRequest, setSelectedCompletedRequest] = useState(null);
  const [selectedReleaseCopyPreview, setSelectedReleaseCopyPreview] = useState(null);
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseUploadDrafts, setReleaseUploadDrafts] = useState({});
  const { registerDirty } = useUnsavedChanges();
  const navSaveRef = useRef(() => {});

  const [sectionPages, setSectionPages] = useState({
    online: 1,
    completedRPT: 1,
    completedBUSINESS: 1,
    completedMISC: 1,
    completedCTC: 1,
    completedPTR: 1,
    completedMARKET: 1,
    recordsRPT: 1,
    recordsBUSINESS: 1,
    recordsMISC: 1,
    recordsCTC: 1,
    recordsPTR: 1,
    recordsMARKET: 1,
  });
  const [recordSearch, setRecordSearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
    CTC: '',
    PTR: '',
    MARKET: '',
  });
  const [historySearch, setHistorySearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
    CTC: '',
    PTR: '',
    MARKET: '',
  });

  const getActiveReceiptBadgeCount = (items) => (
    (items || []).filter((item) => {
      if (['Released', 'Completed'].includes(item.status)) return false;
      const paymentStatus = item.paymentStatus || (item.feePaid ? 'Pending Transaction' : 'Pending');
      return paymentStatus === 'Verified';
    }).length
  );

  const emitBranchReceiptUpdated = (items) => {
    window.dispatchEvent(new CustomEvent(BRANCH_RECEIPT_UPDATED_EVENT, {
      detail: {
        requests: items || [],
        activeCount: getActiveReceiptBadgeCount(items || []),
      },
    }));
  };

  const refreshData = async ({ emitReceiptEvent = false } = {}) => {
    try {
      const [recordsResponse, requestsResponse, historyResponse] = await Promise.all([
        receiptAPI.listRecords(),
        receiptAPI.listRequests(),
        receiptAPI.listRequestHistory(),
      ]);
      setRecords(recordsResponse.data);
      setRequests(requestsResponse.data);
      setRequestHistory(historyResponse.data);
      if (emitReceiptEvent) {
        emitBranchReceiptUpdated(requestsResponse.data || []);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load receipt management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    const previewUrls = Object.values(releaseUploadDrafts)
      .map((draft) => draft?.previewUrl)
      .filter(Boolean);

    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [releaseUploadDrafts]);

  useEffect(() => () => {
    if (selectedReleaseCopyPreview?.imageUrl) {
      URL.revokeObjectURL(selectedReleaseCopyPreview.imageUrl);
    }
  }, [selectedReleaseCopyPreview]);

  navSaveRef.current = async () => {
    if (!ocrDraft || saveBlocked) {
      throw new Error(saveBlocked ? 'Please fix validation errors before saving.' : 'No draft to save.');
    }
    await handleSaveRecord();
  };

  useEffect(() => {
    if (ocrDraft) {
      registerDirty(true, () => navSaveRef.current());
    } else {
      registerDirty(false, null);
    }
  }, [ocrDraft, registerDirty]);

  useEffect(() => {
    const handleBranchPaymentUpdated = () => {
      refreshData({ emitReceiptEvent: true });
    };

    window.addEventListener('branch-payment-updated', handleBranchPaymentUpdated);
    window.addEventListener('receipt-payment-updated', handleBranchPaymentUpdated);
    return () => {
      window.removeEventListener('branch-payment-updated', handleBranchPaymentUpdated);
      window.removeEventListener('receipt-payment-updated', handleBranchPaymentUpdated);
    };
  }, []);

  const normalizedActiveRequests = useMemo(() => dedupeRequestsById(requests), [requests]);

  const pendingRequests = useMemo(
    () => normalizedActiveRequests.filter((request) => {
      if (['Released', 'Completed'].includes(request.status)) return false;
      const paymentStatus = request.paymentStatus || (request.feePaid ? 'Pending Transaction' : 'Pending');
      return paymentStatus === 'Verified';
    }),
    [normalizedActiveRequests]
  );

  const onlineReceiptRequests = useMemo(
    () => pendingRequests
      .sort((left, right) => {
        const leftDate = new Date(left.createdAt || left.created_at || 0).getTime();
        const rightDate = new Date(right.createdAt || right.created_at || 0).getTime();
        return leftDate - rightDate;
      }),
    [pendingRequests]
  );

  const getPaymentStatusTone = (status) => {
    if (status === 'Verified') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (status === 'Rejected') return 'bg-rose-50 text-rose-700 ring-rose-200';
    return 'bg-amber-50 text-amber-700 ring-amber-200';
  };

  const getReleaseStatusTone = (status) => {
    if (status === 'Released') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (status === 'Ready for Release') return 'bg-blue-50 text-blue-700 ring-blue-200';
    return 'bg-slate-100 text-slate-700 ring-slate-200';
  };

  const referenceLabel = useMemo(() => {
    if ((ocrDraft?.category || selectedCategory) === 'RPT') {
      return 'RPT Number';
    }
    if ((ocrDraft?.category || selectedCategory) === 'BUSINESS') {
      return "Mayor's Permit";
    }
    if ((ocrDraft?.category || selectedCategory) === 'MARKET') {
      return 'Certificate Number';
    }
    return 'Reference Number';
  }, [ocrDraft?.category, selectedCategory]);

  const activeReceiptCategory = useMemo(
    () => normalizeReceiptCategory(ocrDraft?.category || selectedCategory),
    [ocrDraft?.category, selectedCategory]
  );
  const isCtcReceiptCategory = activeReceiptCategory === 'CTC';
  const showMarketCertificateNumber = activeReceiptCategory !== 'MARKET';

  const effectiveSelectedCategory = useMemo(
    () => normalizeReceiptCategory(ocrDraft?.selected_category || ocrDraft?.category || selectedCategory),
    [ocrDraft?.selected_category, ocrDraft?.category, selectedCategory]
  );

  const effectiveDetectedCategory = useMemo(() => {
    if (!ocrDraft) {
      return '';
    }

    const normalizedDetectedCategory = normalizeReceiptCategory(ocrDraft.detected_category || '');
    if (normalizedDetectedCategory && normalizedDetectedCategory !== 'UNKNOWN') {
      return normalizedDetectedCategory;
    }

    return detectReceiptCategoryFromDraft(ocrDraft, effectiveSelectedCategory);
  }, [ocrDraft, effectiveSelectedCategory]);

  const categoryMismatch = Boolean(
    ocrDraft &&
    effectiveDetectedCategory &&
    effectiveDetectedCategory !== effectiveSelectedCategory
  );
  const missingRequiredFields = useMemo(
    () => getMissingRequiredReceiptFields(ocrDraft, effectiveSelectedCategory),
    [ocrDraft, effectiveSelectedCategory]
  );
  const extractionWarning = buildExtractionWarningMessage(missingRequiredFields, effectiveSelectedCategory);
  const filenameMismatchBlocked = Boolean(
    ocrDraft?.taxpayer_name &&
    ocrDraft?.filename_matches_taxpayer === false &&
    !ocrDraft?.auto_rename_source_image
  );
  const amountInvalid = isAmountInvalid(ocrDraft?.amount);
  const saveBlocked = Boolean(
    categoryMismatch || ocrDraft?.duplicate_detected || filenameMismatchBlocked || missingRequiredFields.length || amountInvalid
  );
  const duplicateWarning = ocrDraft?.duplicate_warning || '';
  const activeProcessingModal = useMemo(() => {
    if (processingFeedback) {
      return processingFeedback;
    }

    if (saving) {
      return {
        status: 'loading',
        title: 'Verifying and Saving Receipt Record',
        message: 'Please wait while the receipt record is being processed.',
      };
    }

    if (uploading) {
      return {
        status: 'loading',
        title: 'Processing OCR',
        message: 'Extracting receipt data... Please wait.',
      };
    }

    if (releasing) {
      return {
        status: 'loading',
        title: 'Releasing Receipt Copy',
        message: 'Please wait while WARDS sends the receipt copy and completes the branch release process.',
      };
    }

    return null;
  }, [processingFeedback, releasing, saving, uploading]);

  useEffect(() => {
    if (!ocrDraft) {
      return;
    }

    if (categoryMismatch) {
      setError(
        `Please choose the correct file. You selected ${effectiveSelectedCategory}, but the uploaded receipt appears to be ${effectiveDetectedCategory}.`
      );
      setSuccessMessage('');
      return;
    }

    if (duplicateWarning) {
      setError(duplicateWarning);
      setSuccessMessage('');
      return;
    }

    if (extractionWarning) {
      setError(extractionWarning);
      setSuccessMessage('');
      return;
    }

    if (filenameMismatchBlocked) {
      setError(
        ocrDraft?.file_name_validation_message ||
        'The uploaded file name must match the extracted taxpayer name before it can be saved.'
      );
      setSuccessMessage('');
      return;
    }

    setError('');
  }, [ocrDraft, categoryMismatch, effectiveDetectedCategory, effectiveSelectedCategory, duplicateWarning, extractionWarning, filenameMismatchBlocked]);

  const normalizedRecords = useMemo(
    () =>
      records.map((record) => ({
        ...record,
        normalized_tax_type: (record.tax_type || '').trim().toUpperCase(),
      })),
    [records]
  );

  const filterRecordsByCategoryAndName = (categoryKey) => {
    const searchTerm = (recordSearch[categoryKey] || '').trim().toLowerCase();

    return normalizedRecords.filter((record) => {
      if (record.normalized_tax_type !== categoryKey) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      return (record.taxpayer_name || '').toLowerCase().includes(searchTerm);
    });
  };

  const rptRecords = useMemo(() => filterRecordsByCategoryAndName('RPT'), [normalizedRecords, recordSearch]);
  const businessTaxRecords = useMemo(() => filterRecordsByCategoryAndName('BUSINESS'), [normalizedRecords, recordSearch]);
  const miscRecords = useMemo(() => filterRecordsByCategoryAndName('MISC'), [normalizedRecords, recordSearch]);
  const ctcRecords = useMemo(() => filterRecordsByCategoryAndName('CTC'), [normalizedRecords, recordSearch]);
  const ptrRecords = useMemo(() => filterRecordsByCategoryAndName('PTR'), [normalizedRecords, recordSearch]);
  const marketRecords = useMemo(() => filterRecordsByCategoryAndName('MARKET'), [normalizedRecords, recordSearch]);

  const normalizedRequestHistory = useMemo(
    () =>
      dedupeRequestsById(requestHistory).map((request) => ({
        ...request,
        normalized_tax_type: normalizeReceiptCategory(request.taxType),
      })),
    [requestHistory]
  );

  const releasedRptRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.RPT.trim().toLowerCase();
          if (request.normalized_tax_type !== 'RPT') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.RPT]
  );

  const releasedBusinessRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.BUSINESS.trim().toLowerCase();
          if (request.normalized_tax_type !== 'BUSINESS') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.BUSINESS]
  );

  const releasedMiscRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.MISC.trim().toLowerCase();
          if (request.normalized_tax_type !== 'MISC') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.MISC]
  );

  const releasedCtcRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.CTC.trim().toLowerCase();
          if (request.normalized_tax_type !== 'CTC') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.CTC]
  );

  const releasedPtrRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.PTR.trim().toLowerCase();
          if (request.normalized_tax_type !== 'PTR') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.PTR]
  );

  const releasedMarketRequests = useMemo(
    () =>
      normalizedRequestHistory
        .filter((request) => {
          const searchTerm = historySearch.MARKET.trim().toLowerCase();
          if (request.normalized_tax_type !== 'MARKET') {
            return false;
          }
          return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
        })
        .sort((left, right) => {
          const leftDate = new Date(left.createdAt || left.created_at || left.archived_at || 0).getTime();
          const rightDate = new Date(right.createdAt || right.created_at || right.archived_at || 0).getTime();
          return leftDate - rightDate;
        }),
    [normalizedRequestHistory, historySearch.MARKET]
  );

  useEffect(() => {
    setSectionPages((current) => ({
      ...current,
      online: Math.min(current.online, Math.max(1, Math.ceil(onlineReceiptRequests.length / SECTION_PAGE_SIZE))),
      completedRPT: Math.min(current.completedRPT, Math.max(1, Math.ceil(releasedRptRequests.length / SECTION_PAGE_SIZE))),
      completedBUSINESS: Math.min(current.completedBUSINESS, Math.max(1, Math.ceil(releasedBusinessRequests.length / SECTION_PAGE_SIZE))),
      completedMISC: Math.min(current.completedMISC, Math.max(1, Math.ceil(releasedMiscRequests.length / SECTION_PAGE_SIZE))),
      completedCTC: Math.min(current.completedCTC, Math.max(1, Math.ceil(releasedCtcRequests.length / SECTION_PAGE_SIZE))),
      completedPTR: Math.min(current.completedPTR, Math.max(1, Math.ceil(releasedPtrRequests.length / SECTION_PAGE_SIZE))),
      completedMARKET: Math.min(current.completedMARKET, Math.max(1, Math.ceil(releasedMarketRequests.length / SECTION_PAGE_SIZE))),
      recordsRPT: Math.min(current.recordsRPT, Math.max(1, Math.ceil(rptRecords.length / SECTION_PAGE_SIZE))),
      recordsBUSINESS: Math.min(current.recordsBUSINESS, Math.max(1, Math.ceil(businessTaxRecords.length / SECTION_PAGE_SIZE))),
      recordsMISC: Math.min(current.recordsMISC, Math.max(1, Math.ceil(miscRecords.length / SECTION_PAGE_SIZE))),
      recordsCTC: Math.min(current.recordsCTC, Math.max(1, Math.ceil(ctcRecords.length / SECTION_PAGE_SIZE))),
      recordsPTR: Math.min(current.recordsPTR, Math.max(1, Math.ceil(ptrRecords.length / SECTION_PAGE_SIZE))),
      recordsMARKET: Math.min(current.recordsMARKET, Math.max(1, Math.ceil(marketRecords.length / SECTION_PAGE_SIZE))),
    }));
  }, [
    onlineReceiptRequests.length,
    releasedRptRequests.length,
    releasedBusinessRequests.length,
    releasedMiscRequests.length,
    releasedCtcRequests.length,
    releasedPtrRequests.length,
    releasedMarketRequests.length,
    rptRecords.length,
    businessTaxRecords.length,
    miscRecords.length,
    ctcRecords.length,
    ptrRecords.length,
    marketRecords.length,
  ]);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const ALLOWED_PREVIEW_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!ALLOWED_PREVIEW_TYPES.includes(file.type)) {
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(null);
      setOcrDraft(null);
      setError('Only PNG and JPEG files are allowed for preview.');
      setSuccessMessage('');
      event.target.value = '';
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setOcrDraft(null);
    setError('');
    setSuccessMessage('');
  };

  const handleUpload = async () => {
    if (!selectedFile || uploading || saving) {
      return;
    }

    setUploading(true);
    setProcessingFeedback({
      status: 'loading',
      title: 'Processing OCR',
      message: 'Extracting receipt data... Please wait.',
    });
    setError('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('category', selectedCategory);
      const response = await receiptAPI.uploadForOCR(formData);
      const resolvedCategory = normalizeReceiptCategory(response.data?.selected_category || response.data?.tax_type || response.data?.category || selectedCategory);
      const todayDate = getTodayDateInputValue();
      setOcrDraft(normalizeReceiptDraftReviewState({
        ...response.data,
        transaction_date: resolvedCategory === 'MARKET'
          ? todayDate
          : response.data?.transaction_date,
        ref_number: resolvedCategory === 'CTC' ? '' : response.data?.ref_number,
        taxpayer_name: resolvedCategory === 'CTC' ? '' : response.data?.taxpayer_name,
        amount: resolvedCategory === 'CTC' ? null : response.data?.amount,
      }));
      setProcessingFeedback({
        status: 'success',
        title: 'OCR Complete',
        message: 'Run OCR completed successfully. Receipt data is ready for review.',
      });
      await wait(PROCESSING_SUCCESS_DELAY_MS);
      setProcessingFeedback(null);
    } catch (err) {
      setProcessingFeedback(null);
      setError(err.response?.data?.detail || 'Failed to process receipt image.');
    } finally {
      setUploading(false);
    }
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setOcrDraft((current) => normalizeReceiptDraftReviewState({
      ...current,
      [name]: name === 'amount' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const handleMarketDateChange = (event) => {
    const { name, value } = event.target;
    if (name === 'transaction_date' && isMarketIssueDateInvalid(value)) {
      setError('Date of Issue must be today.');
      return;
    }
    if (name === 'market_valid_until' && isMarketValidUntilInvalid(value)) {
      setError('Valid Until cannot be in the past.');
      return;
    }
    setError('');
    handleDraftChange(event);
  };

  const handleSaveRecord = async () => {
    if (!ocrDraft || saving || uploading || saveBlocked) {
      return;
    }

    setSaving(true);
    setProcessingFeedback({
      status: 'loading',
      title: 'Verifying and Saving Receipt Record',
      message: 'Please wait while the receipt record is being processed.',
    });
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.saveRecord(normalizeReceiptDraftReviewState(ocrDraft));
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      setOcrDraft(null);
      await refreshData({ emitReceiptEvent: true });
      setProcessingFeedback({
        status: 'success',
        title: 'Receipt Record Saved',
        message: 'Verify and Save Receipt Record completed successfully.',
      });
      await wait(PROCESSING_SUCCESS_DELAY_MS);
      setProcessingFeedback(null);
    } catch (err) {
      setProcessingFeedback(null);
      const detail = err.response?.data?.detail;
      setError((typeof detail === 'object' ? detail?.message : detail) || 'Failed to save verified receipt record.');
    } finally {
      setSaving(false);
    }
  };

  const handleRelease = async (requestId) => {
    setReleasing(true);
    try {
      setError('');
      setSuccessMessage('');
      const response = await receiptAPI.releaseRequest(requestId);
      if (response.data?.emailSent) {
        setSuccessMessage(response.data.emailMessage || `Receipt copy sent to ${response.data.email}.`);
      } else if (response.data?.emailMessage) {
        setError(response.data.emailMessage);
      } else {
        setSuccessMessage('Receipt copy released successfully.');
      }
      await refreshData({ emitReceiptEvent: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to release receipt request.');
      if (err.response?.status === 404) {
        await refreshData({ emitReceiptEvent: true });
      }
    } finally {
      setReleasing(false);
    }
  };

  const handleReleaseClick = (request) => {
    setReleaseTarget(request);
  };

  const handleReleaseConfirm = async () => {
    if (!releaseTarget) {
      return;
    }

    const requestToRelease = releaseTarget;
    setReleaseTarget(null);
    await handleRelease(requestToRelease.requestId);
  };

  const handlePrintReleaseCopy = async (requestId) => {
    try {
      const response = await receiptAPI.downloadReleaseCopy(requestId);
      const contentType = response.headers?.['content-type'] || 'application/octet-stream';
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `release-copy-${requestId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to download finished receipt copy.');
    }
  };

  const handlePrintRecordImage = async (recordId) => {
    try {
      const response = await receiptAPI.downloadRecordImage(recordId);
      const contentType = response.headers?.['content-type'] || response.data?.type || 'image/png';
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageSrc = reader.result;
        const printWindow = window.open('', '_blank', 'width=900,height=1300');
        if (!printWindow) {
          setError('Allow pop-ups to print the receipt record.');
          return;
        }

        const doc = printWindow.document;
        doc.title = 'Receipt Record';

        const style = doc.createElement('style');
        style.textContent = `
          html, body { margin: 0; padding: 0; background: white; }
          body { display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
          .print-container { width: 100%; max-width: 100%; padding: 10mm; box-sizing: border-box; }
          img { display: block; width: auto; height: 95vh; max-width: 95vw; max-height: 95vh; object-fit: contain; margin: 0 auto; }
          @page { size: auto; margin: 10mm; }
          @media print {
            body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: flex-start; }
            .print-container { padding: 0; width: 100%; max-width: 100%; }
            img { width: auto; height: 95vh; max-width: 95vw; max-height: 95vh; page-break-inside: avoid; }
          }
        `;
        doc.head.appendChild(style);

        const container = doc.createElement('div');
        container.className = 'print-container';

        const receiptImage = doc.createElement('img');
        receiptImage.src = imageSrc;
        receiptImage.alt = 'Receipt record';

        container.appendChild(receiptImage);
        doc.body.appendChild(container);

        receiptImage.onload = () => {
          printWindow.focus();
          setTimeout(() => printWindow.print(), 150);
        };
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open receipt record image.');
    }
  };

  const handleDownloadRecordImage = async (recordId, taxpayerName) => {
    try {
      const response = await receiptAPI.downloadRecordImage(recordId);
      const contentType = response.headers?.['content-type'] || response.data?.type || 'image/png';
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });
      const extensionMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const extension = extensionMap[contentType.toLowerCase()] || 'png';
      const safeTaxpayerName = (taxpayerName || 'receipt')
        .trim()
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'receipt';
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${safeTaxpayerName}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to download receipt record image.');
    }
  };

  const clearReleaseUploadDraft = (requestId) => {
    setReleaseUploadDrafts((current) => {
      const draft = current[requestId];
      if (draft?.previewUrl) {
        URL.revokeObjectURL(draft.previewUrl);
      }

      const nextDrafts = { ...current };
      delete nextDrafts[requestId];
      return nextDrafts;
    });
  };

  const handleSelectReleaseCopy = (request, event) => {
    const requestId = request.requestId;
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!ALLOWED_RELEASE_IMAGE_TYPES.includes(file.type)) {
      setError('Only JPG, JPEG, PNG, and WEBP files are allowed for the release copy.');
      setSuccessMessage('');
      return;
    }

    if (file.size > MAX_RELEASE_IMAGE_SIZE) {
      setError('Release copy image must not exceed 5 MB.');
      setSuccessMessage('');
      return;
    }

    setError('');
    setSuccessMessage('');

    setReleaseUploadDrafts((current) => {
      const existingDraft = current[requestId];
      if (existingDraft?.previewUrl) {
        URL.revokeObjectURL(existingDraft.previewUrl);
      }

      const expectedTaxType = normalizeReceiptCategory(request.taxType);
      const expectedTaxpayerName = (request.taxpayerName || '').trim();
      const shouldValidateFileName = ['RPT', 'BUSINESS', 'MISC'].includes(expectedTaxType) && expectedTaxpayerName;
      const suggestedFilename = shouldValidateFileName ? buildSuggestedReceiptFilename(file.name, expectedTaxpayerName) : '';
      const filenameStem = (file.name || '').replace(/\.[^.]+$/, '');
      const suggestedStem = suggestedFilename.replace(/\.[^.]+$/, '');
      const filenameMatchesTaxpayer = shouldValidateFileName
        ? normalizeReceiptFilenameForCompare(filenameStem) === normalizeReceiptFilenameForCompare(suggestedStem)
        : true;

      return {
        ...current,
        [requestId]: {
          file,
          fileName: file.name,
          previewUrl: URL.createObjectURL(file),
          autoRename: false,
          validationMessage: shouldValidateFileName && !filenameMatchesTaxpayer
            ? `The uploaded file name must match the taxpayer name. Rename it to ${suggestedFilename} or use auto rename.`
            : '',
          suggestedFilename: shouldValidateFileName ? suggestedFilename : '',
          extractedTaxpayerName: shouldValidateFileName ? expectedTaxpayerName : '',
        },
      };
    });
  };

  const handleAutoRenameDraft = (requestId) => {
    setReleaseUploadDrafts((current) => {
      const draft = current[requestId];
      if (!draft) {
        return current;
      }

      return {
        ...current,
        [requestId]: {
          ...draft,
          autoRename: true,
          fileName: draft.suggestedFilename || draft.fileName,
          validationMessage: '',
        },
      };
    });
  };

  const handleSubmitReleaseCopy = async (requestId) => {
    const draft = releaseUploadDrafts[requestId];
    if (!draft?.file) {
      setError('Please choose an image before uploading.');
      setSuccessMessage('');
      return;
    }

    setUploadingReleaseId(requestId);
    setError('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', draft.file);
      formData.append('auto_rename', draft.autoRename ? 'true' : 'false');
      const response = await receiptAPI.uploadReleaseCopy(requestId, formData);
      clearReleaseUploadDraft(requestId);
      setSuccessMessage(
        response.data?.releaseCopyFilename
          ? `Release copy uploaded successfully: ${response.data.releaseCopyFilename}`
          : 'Release copy uploaded successfully.'
      );
      await refreshData({ emitReceiptEvent: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (detail?.code === 'receipt_filename_mismatch') {
        setReleaseUploadDrafts((current) => ({
          ...current,
          [requestId]: {
            ...(current[requestId] || {}),
            autoRename: false,
            validationMessage: detail.message,
            suggestedFilename: detail.suggested_filename || '',
            extractedTaxpayerName: detail.extracted_taxpayer_name || '',
          },
        }));
        setError(detail.message || 'The file name must match the taxpayer name before release.');
      } else {
        setError(detail || 'Failed to upload finished receipt copy.');
        if (err.response?.status === 404) {
          await refreshData({ emitReceiptEvent: true });
        }
      }
    } finally {
      setUploadingReleaseId(null);
    }
  };

  const handlePreviewUploadedReleaseCopy = async (requestId) => {
    try {
      setError('');
      const response = await receiptAPI.downloadReleaseCopy(requestId);
      const contentType = response.headers?.['content-type'] || 'image/png';
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });
      if (selectedReleaseCopyPreview?.imageUrl) {
        URL.revokeObjectURL(selectedReleaseCopyPreview.imageUrl);
      }

      const blobUrl = window.URL.createObjectURL(blob);
      setSelectedReleaseCopyPreview({
        requestId,
        imageUrl: blobUrl,
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open uploaded release copy.');
    }
  };

  const closeReleaseCopyPreview = () => {
    if (selectedReleaseCopyPreview?.imageUrl) {
      URL.revokeObjectURL(selectedReleaseCopyPreview.imageUrl);
    }
    setSelectedReleaseCopyPreview(null);
  };

  const handleDeleteRecord = async (recordId) => {
    setDeletingRecordId(recordId);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.deleteRecord(recordId);
      await refreshData({ emitReceiptEvent: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete receipt record.');
    } finally {
      setDeletingRecordId(null);
    }
  };

  const requestDeleteConfirmation = (target) => {
    setDeleteTarget(target);
  };

  const handleDeleteTarget = async () => {
    if (!deleteTarget) {
      return;
    }

    if (deleteTarget.type === 'record') {
      await handleDeleteRecord(deleteTarget.id);
    } else if (deleteTarget.type === 'request') {
      await handleDeleteRequest(deleteTarget.id);
    } else if (deleteTarget.type === 'history') {
      await handleDeleteHistoryRequest(deleteTarget.id);
    }

    setDeleteTarget(null);
  };

  const renderRequestWorkflowActions = (request, { compact = false } = {}) => {
    const releaseDraft = releaseUploadDrafts[request.requestId];
    const buttonClassName = compact
      ? 'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition'
      : 'rounded-lg px-3 py-1.5 font-semibold transition';
    const paymentStatus = request.paymentStatus || (request.feePaid ? 'Pending Transaction' : 'Pending');
    const canRelease = paymentStatus === 'Verified';

    return (
      <div className={`space-y-3 ${compact ? 'max-w-[24rem]' : ''}`}>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Release Copy</p>
              <input
                key={releaseDraft?.fileName ? `release-selected-${request.requestId}` : `release-empty-${request.requestId}`}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={(event) => handleSelectReleaseCopy(request, event)}
                className="mt-2 w-full cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[#0f2f5f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-blue-400 hover:bg-slate-50 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200 transition"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-slate-700">
                {releaseDraft?.fileName || request.releaseCopyFilename || 'No file selected'}
              </p>
              {request.hasReleaseCopy ? (
                <button
                  onClick={() => handlePreviewUploadedReleaseCopy(request.requestId)}
                  className={`bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 ${buttonClassName}`}
                >
                  View Image
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {releaseDraft ? (
            <>
              <button
                type="button"
                onClick={() => handleSubmitReleaseCopy(request.requestId)}
                disabled={uploadingReleaseId === request.requestId}
                className={`bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed ${buttonClassName}`}
              >
                {uploadingReleaseId === request.requestId ? 'Uploading...' : 'Submit Image'}
              </button>
              <button
                type="button"
                onClick={() => clearReleaseUploadDraft(request.requestId)}
                disabled={uploadingReleaseId === request.requestId}
                className={`bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-40 disabled:cursor-not-allowed ${buttonClassName}`}
              >
                Cancel
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => handleReleaseClick(request)}
            disabled={!request.hasReleaseCopy || !canRelease || releasing}
            className={`bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed ${buttonClassName}`}
          >
            Release Copy
          </button>
          <button
            type="button"
            onClick={() => requestDeleteConfirmation({
              type: 'request',
              id: request.requestId,
              title: 'Delete this active receipt request?',
              message: 'This will permanently remove the active receipt request and its temporary branch-side workflow record.',
              details: [
                { label: 'Request ID', value: request.requestId },
                { label: 'Taxpayer', value: request.taxpayerName || 'N/A' },
              ],
            })}
            disabled={deletingRequestId === request.requestId}
            className={`bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed ${buttonClassName}`}
          >
            {deletingRequestId === request.requestId ? 'Deleting...' : 'Delete'}
          </button>
        </div>
        <div className="basis-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Send to: {request.email || 'No requester email'}
        </div>
        {releaseDraft?.validationMessage ? (
          <div className="basis-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="font-semibold">File name needs correction</p>
            <p className="mt-1">{releaseDraft.validationMessage}</p>
            {releaseDraft.suggestedFilename ? (
              <p className="mt-1">Suggested file name: {releaseDraft.suggestedFilename}</p>
            ) : null}
            <button
              type="button"
              onClick={() => handleAutoRenameDraft(request.requestId)}
              className="mt-3 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white transition hover:bg-blue-700"
            >
              Use Extracted Taxpayer Name
            </button>
          </div>
        ) : null}
        {releaseDraft ? (
          <div className="basis-full rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-xs font-semibold text-slate-700">{releaseDraft.fileName}</p>
              <span className="text-[11px] text-slate-500">Ready to upload</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img
                src={releaseDraft.previewUrl}
                alt={`Release copy preview for ${request.requestId}`}
                className="h-40 w-full object-contain"
              />
            </div>
          </div>
        ) : null}
        <div className="basis-full text-xs text-slate-500">
          {!canRelease
            ? paymentStatus === 'Rejected'
              ? 'Receipt copy release is blocked because branch administration rejected the payment.'
              : paymentStatus === 'Pending Transaction'
                ? 'Receipt copy release stays locked until Branch Admin verifies the paid receipt request in Payment Management.'
                : 'Receipt copy release stays locked until Payment Management marks the request fee as verified.'
            : request.releaseStatus === 'Ready for Release'
              ? 'Payment is verified and the request is ready for branch release.'
              : 'Payment is verified. Upload the finished copy to continue the release flow.'}
        </div>
        <div className="basis-full text-xs text-slate-500">
          After release, this request is marked done and transferred to its completed table.
        </div>
      </div>
    );
  };

  const renderVerifiedRecordSection = ({
    title,
    categoryKey,
    referenceLabelText,
    rows,
    showReferenceColumn = true,
    showTaxpayerColumn = true,
    showAmountColumn = true,
    showActionColumn = true,
  }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{rows.length} saved record{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="w-full md:w-80">
          <input
            type="text"
            value={recordSearch[categoryKey]}
            onChange={(event) =>
              setRecordSearch((current) => ({
                ...current,
                [categoryKey]: event.target.value,
              }))
            }
            placeholder="Search taxpayer name"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-purple-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
        </div>
      </div>
      {(() => {
        const pageKey = `records${categoryKey}`;
        const totalPages = Math.max(1, Math.ceil(rows.length / SECTION_PAGE_SIZE));
        const visibleRows = paginateRows(rows, sectionPages[pageKey]);
        return (
          <>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                {showReferenceColumn ? (
                  <th className="whitespace-nowrap px-4 py-3.5 text-left w-[14%]">{referenceLabelText}</th>
                ) : null}
                {showTaxpayerColumn ? <th className="whitespace-nowrap px-4 py-3.5 text-left w-[24%]">Taxpayer</th> : null}
                {showAmountColumn ? <th className="whitespace-nowrap px-4 py-3.5 text-left w-[12%]">Amount</th> : null}
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[14%]">Saved By</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[16%]">Created</th>
                {showActionColumn ? <th className="whitespace-nowrap px-4 py-3.5 text-left w-[20%]">Action</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={[showReferenceColumn, showTaxpayerColumn, showAmountColumn, true, true, showActionColumn].filter(Boolean).length} className="px-4 py-10 text-center text-sm text-slate-500">
                    No verified records found for this category.
                  </td>
                </tr>
              ) : (
                visibleRows.map((record) => (
                  <tr key={record.id} className="transition hover:bg-slate-50">
                    {showReferenceColumn ? (
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">{record.ref_number || 'N/A'}</td>
                    ) : null}
                    {showTaxpayerColumn ? <td className="px-4 py-4 font-medium text-slate-900">{record.taxpayer_name || 'N/A'}</td> : null}
                    {showAmountColumn ? <td className="px-4 py-4">{record.amount != null ? `P${Number(record.amount).toFixed(2)}` : 'N/A'}</td> : null}
                    <td className="px-4 py-4">{record.uploaded_by || 'N/A'}</td>
                    <td className="px-4 py-4 text-slate-500">{record.created_at ? formatUtc8DateTime(record.created_at) : 'N/A'}</td>
                    {showActionColumn ? (
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownloadRecordImage(record.id, record.taxpayer_name)}
                            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handlePrintRecordImage(record.id)}
                            className="inline-flex items-center rounded-lg bg-purple-600 px-3 py-1.5 font-semibold text-white transition hover:bg-purple-700"
                          >
                            Print
                          </button>
                          <button
                            onClick={() => requestDeleteConfirmation({
                              type: 'record',
                              id: record.id,
                              title: 'Delete this receipt record?',
                              message: 'This will permanently remove the verified receipt record from the branch receipt list.',
                              details: [
                                { label: 'Taxpayer', value: record.taxpayer_name || 'N/A' },
                                { label: referenceLabelText || 'Reference', value: record.ref_number || 'N/A' },
                              ],
                            })}
                            disabled={deletingRecordId === record.id}
                            className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                          >
                            {deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <PaginationControls
        page={sectionPages[pageKey]}
        totalPages={totalPages}
        totalItems={rows.length}
        onPageChange={(nextPage) => setSectionPages((current) => ({ ...current, [pageKey]: nextPage }))}
      />
          </>
        );
      })()}
    </div>
  );

  const renderMarketVerifiedRecordSection = (rows) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">Verified Market Records</h2>
          <p className="text-sm text-slate-500">{rows.length} saved record{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="w-full md:w-80">
          <input
            type="text"
            value={recordSearch.MARKET}
            onChange={(event) =>
              setRecordSearch((current) => ({
                ...current,
                MARKET: event.target.value,
              }))
            }
            placeholder="Search taxpayer name"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-purple-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
        </div>
      </div>
      {(() => {
        const pageKey = 'recordsMARKET';
        const totalPages = Math.max(1, Math.ceil(rows.length / SECTION_PAGE_SIZE));
        const visibleRows = paginateRows(rows, sectionPages[pageKey]);
        return (
          <>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm text-slate-700">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Certificate No.</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[16%]">Name</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Date of Issue</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[14%]">Purpose of Renewal</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Valid Until</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Saved By</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[12%]">Created</th>
                      <th className="whitespace-nowrap px-4 py-3.5 text-left w-[18%]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                          No verified records found for this category.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((record) => (
                        <tr key={record.id} className="transition hover:bg-slate-50">
                          <td className="px-4 py-4 font-mono text-xs text-slate-600">{record.ref_number || record.receipt_number || 'N/A'}</td>
                          <td className="px-4 py-4 font-medium text-slate-900">{record.taxpayer_name || 'N/A'}</td>
                          <td className="px-4 py-4">{record.transaction_date || 'N/A'}</td>
                          <td className="px-4 py-4">{record.market_purpose_of_renewal || 'N/A'}</td>
                          <td className="px-4 py-4">{record.market_valid_until || 'N/A'}</td>
                          <td className="px-4 py-4">{record.uploaded_by || 'N/A'}</td>
                          <td className="px-4 py-4 text-slate-500">{record.created_at ? formatUtc8DateTime(record.created_at) : 'N/A'}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleDownloadRecordImage(record.id, record.taxpayer_name)}
                                className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700"
                              >
                                Download
                              </button>
                              <button
                                onClick={() => handlePrintRecordImage(record.id)}
                                className="inline-flex items-center rounded-lg bg-purple-600 px-3 py-1.5 font-semibold text-white transition hover:bg-purple-700"
                              >
                                Print
                              </button>
                              <button
                                onClick={() => requestDeleteConfirmation({
                                  type: 'record',
                                  id: record.id,
                                  title: 'Delete this market receipt record?',
                                  message: 'This will permanently remove the verified market record from the branch receipt list.',
                                  details: [
                                    { label: 'Name', value: record.taxpayer_name || 'N/A' },
                                    { label: 'Certificate No.', value: record.ref_number || record.receipt_number || 'N/A' },
                                  ],
                                })}
                                disabled={deletingRecordId === record.id}
                                className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                              >
                                {deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <PaginationControls
              page={sectionPages[pageKey]}
              totalPages={totalPages}
              totalItems={rows.length}
              onPageChange={(nextPage) => setSectionPages((current) => ({ ...current, [pageKey]: nextPage }))}
            />
          </>
        );
      })()}
    </div>
  );

  const handleDeleteRequest = async (requestId) => {
    setDeletingRequestId(requestId);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.deleteRequest(requestId);
      setSuccessMessage(`Receipt request ${requestId} deleted successfully.`);
      await refreshData({ emitReceiptEvent: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete receipt request.');
    } finally {
      setDeletingRequestId(null);
    }
  };

  const handleDeleteHistoryRequest = async (requestId) => {
    setDeletingHistoryId(requestId);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.deleteRequestHistory(requestId);
      setSuccessMessage(`Completed receipt request ${requestId} deleted successfully.`);
      await refreshData({ emitReceiptEvent: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete completed receipt request.');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const renderCompletedRequestSection = ({
    title,
    categoryKey,
    rows,
  }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{rows.length} completed request{rows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="w-full md:w-80">
          <input
            type="text"
            value={historySearch[categoryKey]}
            onChange={(event) =>
              setHistorySearch((current) => ({
                ...current,
                [categoryKey]: event.target.value,
              }))
            }
            placeholder="Search taxpayer name"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-purple-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
        </div>
      </div>
      {(() => {
        const pageKey = `completed${categoryKey}`;
        const totalPages = Math.max(1, Math.ceil(rows.length / SECTION_PAGE_SIZE));
        const visibleRows = paginateRows(rows, sectionPages[pageKey]);
        return (
          <>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Request ID</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[16%]">Taxpayer</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[12%]">Reason</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[12%]">Reference</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Status</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[12%]">Processed</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[10%]">Completed By</th>
                <th className="whitespace-nowrap px-4 py-3.5 text-left w-[18%]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No completed receipt requests found for this category.
                  </td>
                </tr>
              ) : (
                visibleRows.map((request) => (
                  <tr key={request.requestId} className="transition hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-900">{request.requestId}</td>
                    <td className="px-4 py-4 font-medium text-slate-900">{request.taxpayerName || 'N/A'}</td>
                    <td className="px-4 py-4">{request.requestReason === 'Other' ? (request.requestReasonOther || 'Other') : (request.requestReason || 'N/A')}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">{request.refNumber || 'N/A'}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {request.status || 'Done'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-500">{request.processedAt ? formatUtc8DateTime(request.processedAt) : 'N/A'}</td>
                    <td className="px-4 py-4">{request.completedBy || 'N/A'}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedCompletedRequest(request)}
                          className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => requestDeleteConfirmation({
                            type: 'history',
                            id: request.requestId,
                            title: 'Delete this completed receipt request?',
                            message: 'This will permanently remove the completed receipt request from branch history.',
                            details: [
                              { label: 'Request ID', value: request.requestId },
                              { label: 'Taxpayer', value: request.taxpayerName || 'N/A' },
                            ],
                          })}
                          disabled={deletingHistoryId === request.requestId}
                          className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                        >
                          {deletingHistoryId === request.requestId ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <PaginationControls
        page={sectionPages[pageKey]}
        totalPages={totalPages}
        totalItems={rows.length}
        onPageChange={(nextPage) => setSectionPages((current) => ({ ...current, [pageKey]: nextPage }))}
      />
          </>
        );
      })()}
    </div>
  );

  const handleCancelScan = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setOcrDraft(null);
    setError('');
    setSuccessMessage('');
  };

  if (loading) {
    return <p className="text-gray-600">Loading receipt management...</p>;
  }

  return (
    <div className="space-y-8">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Receipt Management"
        subtitle="Upload scanned receipts, review OCR results, save verified records, and release matched public requisitions."
      />

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Upload Receipt Image</h2>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">Receipt Category</label>
            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              disabled={uploading || saving}
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="RPT">RPT</option>
              <option value="BUSINESS">Business Tax</option>
              <option value="MISC">Miscellaneous</option>
              <option value="CTC">CTC</option>
              <option value="PTR">PTR</option>
              <option value="MARKET">MARKET</option>
            </select>
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={uploading || saving}
            className="mb-4 w-full cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[#0f2f5f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-blue-400 hover:bg-slate-50 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200 transition"
          />

          {previewUrl && (
            <div className="mb-4 border rounded-lg overflow-hidden">
              <img src={previewUrl} alt="Receipt preview" className="w-full h-auto" />
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || saving}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50"
          >
            {uploading ? (selectedCategory === 'CTC' ? 'Uploading...' : 'Running OCR...') : (selectedCategory === 'CTC' ? 'Upload File' : 'Run OCR')}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">OCR Review</h2>

          {!ocrDraft ? (
            <p className="text-gray-500">Upload a receipt image to review extracted data.</p>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                Category: {ocrDraft.category || selectedCategory}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                  <span className="font-semibold">Detected Category:</span> {effectiveDetectedCategory || 'Unknown'}
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
                  <span className="font-semibold">Selected Category:</span> {effectiveSelectedCategory}
                </div>
              </div>

              {categoryMismatch && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Category mismatch detected</p>
                  <p>
                    {ocrDraft.category_warning ||
                      'This looks like a Different recipt'}
                  </p>
                </div>
              )}

              {duplicateWarning && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <p className="font-semibold">Duplicate receipt warning</p>
                  <p>{duplicateWarning}</p>
                  {ocrDraft.duplicate_record ? (
                    <p className="mt-2">
                      Existing record: #{ocrDraft.duplicate_record.id}
                      {ocrDraft.duplicate_record.ref_number ? ` (${ocrDraft.duplicate_record.ref_number})` : ''}
                    </p>
                  ) : null}
                </div>
              )}
              {extractionWarning && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <p className="font-semibold">Unable to Extract Required Information</p>
                  <p className="mt-1">The following fields could not be automatically extracted from the uploaded receipt:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {missingRequiredFields.map((field) => (
                      <li key={field}>{getReceiptFieldLabel(field, effectiveSelectedCategory)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Please review and complete the highlighted fields before proceeding.</p>
                </div>
              )}
              {filenameMismatchBlocked && (
                <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <p className="font-semibold">File name needs correction</p>
                  <p>{ocrDraft.file_name_validation_message || 'The uploaded file name must match the extracted taxpayer name.'}</p>
                  {ocrDraft.source_image_suggested_filename ? (
                    <p className="mt-2">Suggested file name: {ocrDraft.source_image_suggested_filename}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOcrDraft((current) => normalizeReceiptDraftReviewState({
                      ...current,
                      auto_rename_source_image: true,
                      filename_matches_taxpayer: true,
                    }))}
                    className="mt-3 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white transition hover:bg-blue-700"
                  >
                    Use Extracted Taxpayer Name
                  </button>
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                {isCtcReceiptCategory ? (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input
                      name="transaction_date"
                      type="date"
                      min={getTodayDateInputValue()}
                      max={getTodayDateInputValue()}
                      value={formatDateInputValue(ocrDraft.transaction_date || getTodayDateInputValue())}
                      readOnly
                      className="w-full px-4 py-2 border rounded-lg bg-gray-50 text-gray-800"
                    />
                  </div>
                ) : (
                  <>
                    {showMarketCertificateNumber ? (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">{referenceLabel}</label>
                        <input
                          name="ref_number"
                          value={ocrDraft.ref_number || ''}
                          onChange={handleDraftChange}
                          aria-invalid={missingRequiredFields.includes('ref_number') ? 'true' : 'false'}
                          className={`w-full px-4 py-2 border rounded-lg ${
                            missingRequiredFields.includes('ref_number') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                        {missingRequiredFields.includes('ref_number') ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('ref_number', effectiveSelectedCategory)} could not be extracted. Please enter a value.</p>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">{activeReceiptCategory === 'MARKET' ? 'Name' : 'Taxpayer Name'}</label>
                      <input
                        name="taxpayer_name"
                        value={ocrDraft.taxpayer_name || ''}
                        onChange={handleDraftChange}
                        aria-invalid={missingRequiredFields.includes('taxpayer_name') ? 'true' : 'false'}
                        className={`w-full px-4 py-2 border rounded-lg ${
                          missingRequiredFields.includes('taxpayer_name') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                        }`}
                      />
                      {missingRequiredFields.includes('taxpayer_name') ? (
                        <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('taxpayer_name', effectiveSelectedCategory)} could not be extracted. Please enter a value.</p>
                      ) : null}
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">{activeReceiptCategory === 'MARKET' ? 'Date of Issue' : 'Transaction Date'}</label>
                      <input
                        name="transaction_date"
                        type={activeReceiptCategory === 'MARKET' ? 'date' : 'text'}
                        min={activeReceiptCategory === 'MARKET' ? getTodayDateInputValue() : undefined}
                        max={activeReceiptCategory === 'MARKET' ? getTodayDateInputValue() : undefined}
                        value={activeReceiptCategory === 'MARKET' ? formatDateInputValue(ocrDraft.transaction_date) : (ocrDraft.transaction_date || '')}
                        onChange={activeReceiptCategory === 'MARKET'
                          ? handleMarketDateChange
                          : handleDraftChange}
                        aria-invalid={missingRequiredFields.includes('transaction_date') ? 'true' : 'false'}
                        className={`w-full px-4 py-2 border rounded-lg ${
                          missingRequiredFields.includes('transaction_date') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                        }`}
                      />
                      {missingRequiredFields.includes('transaction_date') ? (
                        <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('transaction_date', effectiveSelectedCategory)} could not be extracted. Please enter a value.</p>
                      ) : null}
                    </div>
                    {activeReceiptCategory === 'MARKET' ? (
                      <>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose of Renewal</label>
                          <select
                            value={getMarketPurposeSelectValue(ocrDraft.market_purpose_of_renewal)}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setOcrDraft((current) => normalizeReceiptDraftReviewState({
                                ...current,
                                market_purpose_of_renewal: nextValue === 'Other' ? '' : nextValue,
                              }));
                            }}
                            aria-invalid={missingRequiredFields.includes('market_purpose_of_renewal') ? 'true' : 'false'}
                            className={`w-full px-4 py-2 border rounded-lg bg-white ${
                              missingRequiredFields.includes('market_purpose_of_renewal') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                            }`}
                          >
                            {MARKET_PURPOSE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                            <option value="Other">Other (please specify)</option>
                          </select>
                          {getMarketPurposeSelectValue(ocrDraft.market_purpose_of_renewal) === 'Other' ? (
                            <input
                              name="market_purpose_of_renewal"
                              value={ocrDraft.market_purpose_of_renewal || ''}
                              onChange={handleDraftChange}
                              placeholder="Type the purpose of renewal"
                              aria-invalid={missingRequiredFields.includes('market_purpose_of_renewal') ? 'true' : 'false'}
                              className={`mt-2 w-full px-4 py-2 border rounded-lg ${
                                missingRequiredFields.includes('market_purpose_of_renewal') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                              }`}
                            />
                          ) : null}
                        {missingRequiredFields.includes('market_purpose_of_renewal') ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('market_purpose_of_renewal', effectiveSelectedCategory)} could not be extracted. Please enter a value.</p>
                        ) : null}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Valid Until</label>
                          <input
                            name="market_valid_until"
                            type="date"
                            min={getTodayDateInputValue()}
                            value={formatDateInputValue(ocrDraft.market_valid_until)}
                            onChange={handleMarketDateChange}
                            aria-invalid={missingRequiredFields.includes('market_valid_until') ? 'true' : 'false'}
                            className={`w-full px-4 py-2 border rounded-lg ${
                              missingRequiredFields.includes('market_valid_until') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                            }`}
                          />
                          {missingRequiredFields.includes('market_valid_until') ? (
                            <p className="mt-1 text-xs font-semibold text-red-600">{getReceiptFieldLabel('market_valid_until', effectiveSelectedCategory)} could not be extracted. Please enter a value.</p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Amount</label>
                        <input
                          name="amount"
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={ocrDraft.amount || ''}
                          onChange={handleDraftChange}
                          aria-invalid={missingRequiredFields.includes('amount') || amountInvalid ? 'true' : 'false'}
                          className={`w-full px-4 py-2 border rounded-lg ${
                            missingRequiredFields.includes('amount') || amountInvalid ? 'border-red-500 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                        {missingRequiredFields.includes('amount') || amountInvalid ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">
                            {amountInvalid
                              ? 'Amount must be greater than zero.'
                              : `${getReceiptFieldLabel('amount', effectiveSelectedCategory)} could not be extracted. Please enter a value.`}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                Confidence: {ocrDraft.confidence || 0} | Engine: {ocrDraft.engine}
              </div>

              <button
                onClick={handleSaveRecord}
                disabled={saving || uploading || saveBlocked}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : saveBlocked ? 'Save Blocked - Review Warnings' : 'Verify and Save Receipt Record'}
              </button>
              <button
                onClick={handleCancelScan}
                disabled={saving || uploading}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">Online Receipt Request</h2>
            <p className="text-sm text-slate-500">{onlineReceiptRequests.length} active request{onlineReceiptRequests.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        {(() => {
          const totalPages = Math.max(1, Math.ceil(onlineReceiptRequests.length / SECTION_PAGE_SIZE));
          const visibleRows = paginateRows(onlineReceiptRequests, sectionPages.online);
          return (
            <>
        <div className="space-y-4">
          {visibleRows.map((request) => (
            <article key={request.requestId} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Request ID</p>
                      <p className="mt-1 break-words text-lg font-bold text-slate-900">{request.requestId}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${getPaymentStatusTone(request.paymentStatus || 'Pending')}`}>
                        {request.paymentStatus || 'Pending'}
                      </span>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${getReleaseStatusTone(request.releaseStatus)}`}>
                        {request.releaseStatus || 'Not Ready for Release'}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {[
                      ['Taxpayer', request.taxpayerName || 'N/A'],
                      ['Tax Type', getBranchTaxDisplayName(request.taxType)],
                      ['Reason', request.requestReason === 'Other' ? (request.requestReasonOther || 'Other') : (request.requestReason || 'N/A')],
                      ['Transaction Date', request.transactionDate || 'N/A'],
                      ['Reference', request.refNumber || 'N/A'],
                      ['Matched Record', request.hasReleaseCopy
                        ? `Uploaded: ${request.releaseCopyFilename || 'receipt copy'}`
                        : request.matchedReceipt
                          ? request.matchedReceipt.receipt_number || 'Matched'
                          : 'Waiting for receipt upload'],
                    ].map(([label, value]) => (
                      <div key={`${request.requestId}-${label}`} className="rounded-2xl border border-white bg-white px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="w-full xl:w-[26rem] xl:min-w-[26rem]">
                  {renderRequestWorkflowActions(request, { compact: true })}
                </div>
              </div>
            </article>
          ))}
          {onlineReceiptRequests.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">No online receipt requests for this branch.</div>
          )}
        </div>
        <PaginationControls
          page={sectionPages.online}
          totalPages={totalPages}
          totalItems={onlineReceiptRequests.length}
          onPageChange={(nextPage) => setSectionPages((current) => ({ ...current, online: nextPage }))}
        />
            </>
          );
        })()}
      </div>

      {renderCompletedRequestSection({
        title: 'Completed RPT Receipt Requests',
        categoryKey: 'RPT',
        rows: releasedRptRequests,
      })}

      {renderCompletedRequestSection({
        title: 'Completed BT Receipt Requests',
        categoryKey: 'BUSINESS',
        rows: releasedBusinessRequests,
      })}

      {renderCompletedRequestSection({
        title: 'Completed Misc Receipt Requests',
        categoryKey: 'MISC',
        rows: releasedMiscRequests,
      })}

      {renderCompletedRequestSection({
        title: 'Completed CTC Receipt Requests',
        categoryKey: 'CTC',
        rows: releasedCtcRequests,
      })}

      {renderCompletedRequestSection({
        title: 'Completed PTR Receipt Requests',
        categoryKey: 'PTR',
        rows: releasedPtrRequests,
      })}

      {renderCompletedRequestSection({
        title: 'Completed Market Receipt Requests',
        categoryKey: 'MARKET',
        rows: releasedMarketRequests,
      })}

      {renderVerifiedRecordSection({
        title: 'Verified RPT Records',
        categoryKey: 'RPT',
        referenceLabelText: 'RPT Number',
        rows: rptRecords,
        showReferenceColumn: true,
      })}

      {renderVerifiedRecordSection({
        title: 'Verified BT Records',
        categoryKey: 'BUSINESS',
        referenceLabelText: "Mayor's Permit",
        rows: businessTaxRecords,
        showReferenceColumn: true,
      })}

      {renderVerifiedRecordSection({
        title: 'Verified Misc Tax Records',
        categoryKey: 'MISC',
        referenceLabelText: 'Reference Number',
        rows: miscRecords,
        showReferenceColumn: true,
      })}

      {renderVerifiedRecordSection({
        title: 'Verified CTC Records',
        categoryKey: 'CTC',
        referenceLabelText: 'Reference Number',
        rows: ctcRecords,
        showReferenceColumn: true,
        showTaxpayerColumn: true,
        showAmountColumn: true,
        showActionColumn: true,
      })}

      {renderVerifiedRecordSection({
        title: 'Verified PTR Records',
        categoryKey: 'PTR',
        referenceLabelText: 'Reference Number',
        rows: ptrRecords,
        showReferenceColumn: true,
      })}

      {renderMarketVerifiedRecordSection(marketRecords)}

      <DeleteConfirmationModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title || 'Delete this item?'}
        message={deleteTarget?.message || 'This action cannot be undone.'}
        details={deleteTarget?.details || []}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTarget}
        isLoading={Boolean(deletingRecordId || deletingRequestId || deletingHistoryId)}
      />

      <DeleteConfirmationModal
        open={Boolean(releaseTarget)}
        title="Release this receipt copy?"
        message="This will send the finished receipt copy to the requester and move the request to the completed receipt table."
        details={releaseTarget ? [
          { label: 'Request ID', value: releaseTarget.requestId },
          { label: 'Taxpayer', value: releaseTarget.taxpayerName || 'N/A' },
          { label: 'Release Copy', value: releaseTarget.releaseCopyFilename || 'Uploaded copy' },
        ] : []}
        confirmLabel="Confirm Release"
        loadingLabel="Releasing..."
        cancelLabel="Cancel"
        onCancel={() => setReleaseTarget(null)}
        onConfirm={handleReleaseConfirm}
        isLoading={releasing}
      />

      <ProcessingModal
        show={Boolean(activeProcessingModal)}
        title={activeProcessingModal?.title || 'Processing'}
        message={activeProcessingModal?.message || 'Please wait.'}
        status={activeProcessingModal?.status || 'loading'}
      />

      {selectedReleaseCopyPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#0f2f5f] px-6 py-5 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Release Copy Preview</p>
                <h2 className="mt-1 text-2xl font-bold">{selectedReleaseCopyPreview.requestId}</h2>
              </div>
              <button
                onClick={closeReleaseCopyPreview}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <div className="bg-slate-100 p-6">
              <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
                <img
                  src={selectedReleaseCopyPreview.imageUrl}
                  alt={`Release copy for ${selectedReleaseCopyPreview.requestId}`}
                  className="max-h-[70vh] w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCompletedRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[#0f2f5f] px-6 py-5 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Completed Receipt Request</p>
                <h2 className="mt-1 text-2xl font-bold">{selectedCompletedRequest.requestId}</h2>
              </div>
              <button
                onClick={() => setSelectedCompletedRequest(null)}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
              {[
                ['Taxpayer', selectedCompletedRequest.taxpayerName],
                ['Tax Type', getBranchTaxDisplayName(selectedCompletedRequest.taxType)],
                ['Reason for Request', selectedCompletedRequest.requestReason === 'Other' ? (selectedCompletedRequest.requestReasonOther || 'Other') : selectedCompletedRequest.requestReason],
                ['Reference Number', selectedCompletedRequest.refNumber],
                ['Status', selectedCompletedRequest.status],
                ['Branch', selectedCompletedRequest.branchName],
                ['Payment Reference', selectedCompletedRequest.paymentRefNumber],
                ['Release Copy', selectedCompletedRequest.releaseCopyFilename],
                ['Created At', selectedCompletedRequest.createdAt ? formatUtc8DateTime(selectedCompletedRequest.createdAt) : 'N/A'],
                ['Processed At', selectedCompletedRequest.processedAt ? formatUtc8DateTime(selectedCompletedRequest.processedAt) : 'N/A'],
                ['Archived At', selectedCompletedRequest.archivedAt ? formatUtc8DateTime(selectedCompletedRequest.archivedAt) : 'N/A'],
                ['Completed By', selectedCompletedRequest.completedBy],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{value || 'N/A'}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Matched Receipt</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {selectedCompletedRequest.matchedReceipt?.receipt_number || selectedCompletedRequest.matchedReceipt?.ref_number || 'No matched receipt attached'}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ReceiptManagement;
