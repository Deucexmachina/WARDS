import { useEffect, useMemo, useState } from 'react';

import { receiptAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const normalizeReceiptCategory = (value) => {
  const normalized = (value || '').trim().toUpperCase();
  const aliases = {
    BT: 'BUSINESS',
    'BUSINESS TAX': 'BUSINESS',
    "MAYOR'S PERMIT": 'BUSINESS',
    'MAYORS PERMIT': 'BUSINESS',
    MISCELLANEOUS: 'MISC',
  };

  return aliases[normalized] || normalized || 'RPT';
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

  if (businessScore > rptScore && businessScore > miscScore) {
    return 'BUSINESS';
  }
  if (rptScore > businessScore && rptScore > miscScore) {
    return 'RPT';
  }
  if (miscScore > 0) {
    return 'MISC';
  }

  return normalizeReceiptCategory(draft?.detected_category || fallbackCategory || draft?.tax_type || 'RPT');
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
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [recordSearch, setRecordSearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
  });
  const [historySearch, setHistorySearch] = useState({
    RPT: '',
    BUSINESS: '',
    MISC: '',
  });

  const refreshData = async () => {
    try {
      const [recordsResponse, requestsResponse, historyResponse] = await Promise.all([
        receiptAPI.listRecords(),
        receiptAPI.listRequests(),
        receiptAPI.listRequestHistory(),
      ]);
      setRecords(recordsResponse.data);
      setRequests(requestsResponse.data);
      setRequestHistory(historyResponse.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load receipt management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    const handleBranchPaymentUpdated = () => {
      refreshData();
    };

    window.addEventListener('branch-payment-updated', handleBranchPaymentUpdated);
    return () => {
      window.removeEventListener('branch-payment-updated', handleBranchPaymentUpdated);
    };
  }, []);

  const pendingRequests = useMemo(
    () => requests.filter((request) => !['Released', 'Completed'].includes(request.status)),
    [requests]
  );

  const immediateRequests = useMemo(
    () => pendingRequests.filter((request) => (request.requestType || 'Immediate') !== 'Appointment'),
    [pendingRequests]
  );

  const appointmentRequests = useMemo(
    () => pendingRequests.filter((request) => (request.requestType || '') === 'Appointment'),
    [pendingRequests]
  );

  const referenceLabel = useMemo(() => {
    if ((ocrDraft?.category || selectedCategory) === 'RPT') {
      return 'RPT Number';
    }
    if ((ocrDraft?.category || selectedCategory) === 'BUSINESS') {
      return "Mayor's Permit";
    }
    return 'Reference Number';
  }, [ocrDraft?.category, selectedCategory]);

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
  const saveBlocked = Boolean(ocrDraft?.save_blocked || categoryMismatch || ocrDraft?.duplicate_detected);
  const duplicateWarning = ocrDraft?.duplicate_warning || '';

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
  }, [ocrDraft, categoryMismatch, effectiveDetectedCategory, effectiveSelectedCategory, duplicateWarning]);

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

  const normalizedRequestHistory = useMemo(
    () =>
      requestHistory.map((request) => ({
        ...request,
        normalized_tax_type: normalizeReceiptCategory(request.taxType),
      })),
    [requestHistory]
  );

  const releasedRptRequests = useMemo(
    () =>
      normalizedRequestHistory.filter((request) => {
        const searchTerm = historySearch.RPT.trim().toLowerCase();
        if (request.normalized_tax_type !== 'RPT') {
          return false;
        }
        return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
      }),
    [normalizedRequestHistory, historySearch.RPT]
  );

  const releasedBusinessRequests = useMemo(
    () =>
      normalizedRequestHistory.filter((request) => {
        const searchTerm = historySearch.BUSINESS.trim().toLowerCase();
        if (request.normalized_tax_type !== 'BUSINESS') {
          return false;
        }
        return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
      }),
    [normalizedRequestHistory, historySearch.BUSINESS]
  );

  const releasedMiscRequests = useMemo(
    () =>
      normalizedRequestHistory.filter((request) => {
        const searchTerm = historySearch.MISC.trim().toLowerCase();
        if (request.normalized_tax_type !== 'MISC') {
          return false;
        }
        return !searchTerm || (request.taxpayerName || '').toLowerCase().includes(searchTerm);
      }),
    [normalizedRequestHistory, historySearch.MISC]
  );

  const formatAppointmentSchedule = (appointmentTime) => {
    if (!appointmentTime) {
      return 'N/A';
    }

    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(appointmentTime));
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setOcrDraft(null);
    setError('');
    setSuccessMessage('');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      return;
    }

    setUploading(true);
    setError('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('category', selectedCategory);
      const response = await receiptAPI.uploadForOCR(formData);
      setOcrDraft(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to process receipt image.');
    } finally {
      setUploading(false);
    }
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setOcrDraft((current) => ({
      ...current,
      [name]: name === 'amount' ? Number(value) : value,
    }));
  };

  const handleSaveRecord = async () => {
    if (!ocrDraft) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.saveRecord(ocrDraft);
      setSelectedFile(null);
      setPreviewUrl(null);
      setOcrDraft(null);
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save verified receipt record.');
    } finally {
      setSaving(false);
    }
  };

  const handleRelease = async (requestId) => {
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
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to release receipt request.');
    }
  };

  const handleCompleteAppointment = async (requestId) => {
    try {
      setError('');
      setSuccessMessage('');
      const response = await receiptAPI.completeAppointmentRequest(requestId);
      setSuccessMessage(response.data?.message || 'Appointment request completed successfully.');
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to complete appointment request.');
    }
  };

  const handlePrintReleaseCopy = async (requestId) => {
    try {
      const response = await receiptAPI.downloadReleaseCopy(requestId);
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      window.open(blobUrl, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open finished receipt copy.');
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
        const iframe = document.createElement('iframe');
        iframe.setAttribute('title', 'Receipt Print Frame');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';

        const cleanup = () => {
          setTimeout(() => {
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
          }, 1000);
        };

        document.body.appendChild(iframe);

        const iframeDocument = iframe.contentWindow?.document;
        if (!iframeDocument) {
          cleanup();
          setError('Failed to prepare print preview.');
          return;
        }

        iframeDocument.open();
        iframeDocument.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Print Receipt</title>
              <style>
                html, body {
                  margin: 0;
                  padding: 0;
                  background: white;
                }
                body {
                  display: flex;
                  justify-content: center;
                  align-items: flex-start;
                }
                img {
                  display: block;
                  width: 100%;
                  max-width: 100%;
                  height: auto;
                  object-fit: contain;
                }
                @page {
                  margin: 12mm;
                }
              </style>
            </head>
            <body>
              <img id="receipt-image" src="${imageSrc}" alt="Receipt record" />
            </body>
          </html>
        `);
        iframeDocument.close();

        const receiptImage = iframeDocument.getElementById('receipt-image');
        if (!receiptImage) {
          cleanup();
          setError('Failed to prepare receipt image for printing.');
          return;
        }

        receiptImage.onload = () => {
          const frameWindow = iframe.contentWindow;
          if (!frameWindow) {
            cleanup();
            setError('Failed to open print preview.');
            return;
          }

          frameWindow.onafterprint = cleanup;
          frameWindow.focus();
          setTimeout(() => {
            frameWindow.print();
          }, 150);
        };
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open receipt record image.');
    }
  };

  const handleUploadReleaseCopy = async (requestId, event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadingReleaseId(requestId);
    setError('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      await receiptAPI.uploadReleaseCopy(requestId, formData);
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to upload finished receipt copy.');
    } finally {
      setUploadingReleaseId(null);
      event.target.value = '';
    }
  };

  const handleDeleteRecord = async (recordId) => {
    setDeletingRecordId(recordId);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.deleteRecord(recordId);
      await refreshData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete receipt record.');
    } finally {
      setDeletingRecordId(null);
    }
  };

  const renderVerifiedRecordSection = ({
    title,
    categoryKey,
    referenceLabelText,
    rows,
    showReferenceColumn = true,
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
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                {showReferenceColumn ? (
                  <th className="px-4 py-3.5 text-left">{referenceLabelText}</th>
                ) : null}
                <th className="px-4 py-3.5 text-left">Taxpayer</th>
                <th className="px-4 py-3.5 text-left">Amount</th>
                <th className="px-4 py-3.5 text-left">Saved By</th>
                <th className="px-4 py-3.5 text-left">Created</th>
                <th className="px-4 py-3.5 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((record) => (
                <tr key={record.id} className="transition hover:bg-slate-50">
                  {showReferenceColumn ? (
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">{record.ref_number || 'N/A'}</td>
                  ) : null}
                  <td className="px-4 py-4 font-medium text-slate-900">{record.taxpayer_name || 'N/A'}</td>
                  <td className="px-4 py-4">{record.amount != null ? `P${Number(record.amount).toFixed(2)}` : 'N/A'}</td>
                  <td className="px-4 py-4">{record.uploaded_by || 'N/A'}</td>
                  <td className="px-4 py-4 text-slate-500">{record.created_at ? formatUtc8DateTime(record.created_at) : 'N/A'}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handlePrintRecordImage(record.id)}
                        className="rounded-lg bg-purple-600 px-3 py-1.5 font-semibold text-white transition hover:bg-purple-700"
                      >
                        Print
                      </button>
                      <button
                        onClick={() => handleDeleteRecord(record.id)}
                        disabled={deletingRecordId === record.id}
                        className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                      >
                        {deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="border-t border-slate-100 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
            No verified records found for this category.
          </div>
        )}
      </div>
    </div>
  );

  const handleDeleteRequest = async (requestId) => {
    setDeletingRequestId(requestId);
    setError('');
    setSuccessMessage('');

    try {
      await receiptAPI.deleteRequest(requestId);
      setSuccessMessage(`Receipt request ${requestId} deleted successfully.`);
      await refreshData();
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
      await refreshData();
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
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3.5 text-left">Request ID</th>
                <th className="px-4 py-3.5 text-left">Taxpayer</th>
                <th className="px-4 py-3.5 text-left">Request Type</th>
                <th className="px-4 py-3.5 text-left">Reference</th>
                <th className="px-4 py-3.5 text-left">Status</th>
                <th className="px-4 py-3.5 text-left">Processed</th>
                <th className="px-4 py-3.5 text-left">Completed By</th>
                <th className="px-4 py-3.5 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((request) => (
                <tr key={request.requestId} className="transition hover:bg-slate-50">
                  <td className="px-4 py-4 font-semibold text-slate-900">{request.requestId}</td>
                  <td className="px-4 py-4 font-medium text-slate-900">{request.taxpayerName || 'N/A'}</td>
                  <td className="px-4 py-4">{request.requestType || 'Immediate'}</td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-600">{request.refNumber || 'N/A'}</td>
                  <td className="px-4 py-4">
                    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      {request.status || 'Done'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-500">{request.processedAt ? formatUtc8DateTime(request.processedAt) : 'N/A'}</td>
                  <td className="px-4 py-4">{request.completedBy || 'N/A'}</td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => handleDeleteHistoryRequest(request.requestId)}
                      disabled={deletingHistoryId === request.requestId}
                      className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                    >
                      {deletingHistoryId === request.requestId ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="border-t border-slate-100 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
            No completed receipt requests found for this category.
          </div>
        )}
      </div>
    </div>
  );

  const handleCancelScan = () => {
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
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="RPT">RPT</option>
              <option value="BUSINESS">Business Tax</option>
              <option value="MISC">Miscellaneous</option>
            </select>
          </div>
          <input type="file" accept="image/*" onChange={handleFileSelect} className="mb-4" />

          {previewUrl && (
            <div className="mb-4 border rounded-lg overflow-hidden">
              <img src={previewUrl} alt="Receipt preview" className="w-full h-auto" />
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50"
          >
            {uploading ? 'Running OCR...' : 'Run OCR'}
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
                      `The uploaded receipt looks like a ${effectiveDetectedCategory} receipt, but ${effectiveSelectedCategory} was selected.`}
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
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{referenceLabel}</label>
                  <input name="ref_number" value={ocrDraft.ref_number || ''} onChange={handleDraftChange} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Taxpayer Name</label>
                  <input name="taxpayer_name" value={ocrDraft.taxpayer_name || ''} onChange={handleDraftChange} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Transaction Date</label>
                  <input name="transaction_date" value={ocrDraft.transaction_date || ''} onChange={handleDraftChange} className="w-full px-4 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount</label>
                  <input name="amount" type="number" step="0.01" value={ocrDraft.amount || ''} onChange={handleDraftChange} className="w-full px-4 py-2 border rounded-lg" />
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                Confidence: {ocrDraft.confidence || 0} | Engine: {ocrDraft.engine}
              </div>

              <button
                onClick={handleSaveRecord}
                disabled={saving || saveBlocked}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : saveBlocked ? 'Save Blocked - Review Warnings' : 'Verify and Save Receipt Record'}
              </button>
              <button
                onClick={handleCancelScan}
                disabled={saving}
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
            <h2 className="text-xl font-bold text-slate-900">Immediate Receipt Requests</h2>
            <p className="text-sm text-slate-500">{immediateRequests.length} active request{immediateRequests.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3.5 text-left">Request ID</th>
                  <th className="px-4 py-3.5 text-left">Taxpayer</th>
                  <th className="px-4 py-3.5 text-left">Tax Type</th>
                  <th className="px-4 py-3.5 text-left">Request Type</th>
                  <th className="px-4 py-3.5 text-left">Transaction Date</th>
                  <th className="px-4 py-3.5 text-left">Reference</th>
                  <th className="px-4 py-3.5 text-left">Status</th>
                  <th className="px-4 py-3.5 text-left">Matched Record</th>
                  <th className="px-4 py-3.5 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {immediateRequests.map((request) => (
                  <tr key={request.requestId} className="align-top transition hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-900">{request.requestId}</td>
                    <td className="px-4 py-4 font-medium text-slate-900">{request.taxpayerName}</td>
                    <td className="px-4 py-4">{request.taxType || 'N/A'}</td>
                    <td className="px-4 py-4">{request.requestType || 'Immediate'}</td>
                    <td className="px-4 py-4">{request.transactionDate || 'N/A'}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">{request.refNumber}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        {request.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {request.hasReleaseCopy
                        ? `Uploaded: ${request.releaseCopyFilename || 'receipt copy'}`
                        : request.matchedReceipt
                          ? request.matchedReceipt.receipt_number || 'Matched'
                          : 'Waiting for receipt upload'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <label className="cursor-pointer rounded-lg bg-slate-700 px-3 py-1.5 font-semibold text-white transition hover:bg-slate-800">
                          {uploadingReleaseId === request.requestId
                            ? 'Uploading...'
                            : request.hasReleaseCopy
                              ? 'Replace Image'
                              : 'Upload Image'}
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={(event) => handleUploadReleaseCopy(request.requestId, event)}
                          />
                        </label>
                        <button
                          onClick={() => handleRelease(request.requestId)}
                          disabled={!request.hasReleaseCopy}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                        >
                          Release Copy
                        </button>
                        <button
                          onClick={() => handleDeleteRequest(request.requestId)}
                          disabled={deletingRequestId === request.requestId}
                          className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
                        >
                          {deletingRequestId === request.requestId ? 'Deleting...' : 'Delete'}
                        </button>
                        <div className="basis-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          Send to: {request.email || 'No requester email'}
                        </div>
                        <div className="basis-full text-xs text-slate-500">
                          {request.status === 'Payment Required'
                            ? 'Citizen payment is still pending. Releasing now will show the payment-required message.'
                            : request.status === 'Pending Branch Review'
                              ? 'Citizen payment is complete. Upload the finished copy, then release it.'
                              : request.status === 'Ready for Release'
                                ? 'Ready to email the finished receipt copy to the citizen.'
                                : null}
                        </div>
                        <div className="basis-full text-xs text-slate-500">
                          After release, this request is marked done and transferred to its completed table.
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {immediateRequests.length === 0 && (
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">No immediate receipt requests for this branch.</div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">Appointment Receipt Requests</h2>
            <p className="text-sm text-slate-500">{appointmentRequests.length} scheduled request{appointmentRequests.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3.5 text-left">Request ID</th>
                  <th className="px-4 py-3.5 text-left">Taxpayer</th>
                  <th className="px-4 py-3.5 text-left">Tax Type</th>
                  <th className="px-4 py-3.5 text-left">Transaction Date</th>
                  <th className="px-4 py-3.5 text-left">Appointment Time</th>
                  <th className="px-4 py-3.5 text-left">Reference</th>
                  <th className="px-4 py-3.5 text-left">Status</th>
                  <th className="px-4 py-3.5 text-left">Payment</th>
                  <th className="px-4 py-3.5 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {appointmentRequests.map((request) => (
                  <tr key={request.requestId} className="align-top transition hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-900">{request.requestId}</td>
                    <td className="px-4 py-4 font-medium text-slate-900">{request.taxpayerName}</td>
                    <td className="px-4 py-4">{request.taxType || 'N/A'}</td>
                    <td className="px-4 py-4">{request.transactionDate || 'N/A'}</td>
                    <td className="px-4 py-4">{formatAppointmentSchedule(request.appointmentTime)}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">{request.refNumber}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        {request.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">{request.feePaid ? 'Paid' : 'Waiting for payment'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleCompleteAppointment(request.requestId)}
                          disabled={!request.feePaid}
                          className="rounded-lg bg-green-600 px-3 py-1.5 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
                        >
                          Complete
                        </button>
                        <div className="basis-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          Auto-removes this request after completion.
                        </div>
                        <div className="basis-full text-xs text-slate-500">
                          After completion, this request is marked done and transferred to its completed table.
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {appointmentRequests.length === 0 && (
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">No appointment receipt requests for this branch.</div>
          )}
        </div>
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
        referenceLabelText: '',
        rows: miscRecords,
        showReferenceColumn: false,
      })}
    </div>
  );
};

export default ReceiptManagement;
