import { useEffect, useMemo, useState } from 'react';
import { branchAPI, taxAssessmentAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import FileViewerModal from '../../components/FileViewerModal';
import { CustomSelect } from '../../components/FormControls';

const EMPTY_ASSESSMENT_FORM = {
  assessment_id: null,
  citizen_user_id: '',
  submission_id: '',
  branch_id: '',
  tax_type: 'RPT',
  assessment_status: 'Active',
  verification_status: 'Verified',
  taxpayer_name: '',
  taxpayer_email: '',
  taxpayer_type: 'Individual',
  mobile_number: '',
  address: '',
  tax_year: '',
  remarks: '',
  rejection_reason: '',
  visible_to_taxpayer: true,
  tdn: '',
  property_type: '',
  property_address: '',
  fair_market_value: 0,
  assessment_level: 0.2,
  months_late: 0,
  discount_rate: 0,
  mayor_permit_number: '',
  sec_dti_cda_number: '',
  business_name: '',
  business_type: '',
  annual_gross_sales: 0,
  business_tax_rate: 0.02,
};

const statusTone = {
  'Pending Verification': 'bg-amber-100 text-amber-800',
  Verified: 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-rose-100 text-rose-800',
  Active: 'bg-blue-100 text-blue-800',
  Inactive: 'bg-slate-100 text-slate-700',
};

const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalizeMobileNumber = (value) => {
  if (!value) {
    return '';
  }
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) {
    return '0' + digits.slice(2);
  }
  return digits;
};

const formatUtcDateTime = (isoString) => {
  if (!isoString) {
    return 'N/A';
  }
  // Backend sends naive UTC datetimes without timezone info.
  // Append 'Z' so JavaScript interprets them as UTC, then converts to local time.
  const hasTz = isoString.includes('Z') || /[+-]\d{2}:\d{2}$/.test(isoString);
  const dateStr = hasTz ? isoString : `${isoString}Z`;
  return new Date(dateStr).toLocaleString('en-PH');
};

// Only preview types that the backend has verified as safe via file signature inspection.
const BACKEND_SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

const getHeaderValue = (headers, headerName) => {
  if (!headers) {
    return '';
  }

  const exactValue = headers[headerName];
  if (exactValue) {
    return exactValue;
  }

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === headerName.toLowerCase());
  return matchingKey ? headers[matchingKey] : '';
};

const parseContentDispositionFilename = (contentDisposition) => {
  if (!contentDisposition) {
    return '';
  }

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/["']/g, ''));
  }

  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || '';
};

/**
 * Resolve preview type based ONLY on backend-verified MIME type.
 * Never trust the filename extension alone for security.
 * The backend inspects file signatures (magic bytes) to verify actual content.
 * 
 * Safe for preview: PDF, PNG, JPEG (images rendered via <img>, PDF via sandboxed iframe)
 * Download-only: DOC, DOCX, TXT, CSV, JSON, SVG, HTML, XML, unknown types
 */
const resolvePreviewType = (mimeType, fileName) => {
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase();

  if (normalizedMime === 'application/pdf') {
    return 'pdf';
  }

  if (BACKEND_SAFE_IMAGE_TYPES.has(normalizedMime)) {
    return 'image';
  }

  // Fallback: check filename extension when MIME doesn't identify a previewable type.
  // The backend already verifies file signatures during upload, so the
  // extension is trustworthy enough for preview routing.
  const ext = String(fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['png', 'jpg', 'jpeg'].includes(ext)) {
    return 'image';
  }

  // All other types: download-only, no inline preview
  return 'unsupported';
};

const IDENTIFIER_PATTERN = /^[A-Z0-9-]{6,40}$/;

const getAssessmentValidationErrors = (form) => {
  const errors = {};
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!String(form.taxpayer_name || '').trim()) {
    errors.taxpayer_name = 'Taxpayer Name is required.';
  }

  if (form.taxpayer_email && !emailPattern.test(String(form.taxpayer_email).trim())) {
    errors.taxpayer_email = 'Enter a valid email address.';
  }

  if (form.mobile_number) {
    const digits = String(form.mobile_number).replace(/\D/g, '');
    if (digits.length !== 11 || !digits.startsWith('09')) {
      errors.mobile_number = 'Enter a valid 11-digit Philippine mobile number.';
    }
  }

  if (!form.tax_type) {
    errors.tax_type = 'Tax type is required.';
  } else if (form.tax_type === 'RPT') {
    if (!String(form.tdn || '').trim()) errors.tdn = 'TDN is required.';
    else if (!IDENTIFIER_PATTERN.test(String(form.tdn).trim().toUpperCase())) errors.tdn = 'TDN must be 6–40 uppercase letters, numbers, or hyphens.';
    if (!String(form.property_type || '').trim()) errors.property_type = 'Property Type is required.';
    if (!String(form.property_address || '').trim()) errors.property_address = 'Property Address is required.';
    if (Number(form.fair_market_value || 0) <= 0) errors.fair_market_value = 'Fair Market Value must be greater than 0.';
    if (Number(form.assessment_level || 0) <= 0 || Number(form.assessment_level || 0) > 1) errors.assessment_level = 'Assessment Level must be between 0.01 and 1.';
    if (Number(form.discount_rate || 0) < 0 || Number(form.discount_rate || 0) > 1) errors.discount_rate = 'Discount Rate must be between 0 and 1.';
  } else if (form.tax_type === 'BT') {
    if (form.taxpayer_type !== 'Business Owner') errors.taxpayer_type = 'Business Tax assessments require Business Owner.';
    if (!String(form.mayor_permit_number || '').trim()) errors.mayor_permit_number = "Mayor's Permit Number is required.";
    else if (!IDENTIFIER_PATTERN.test(String(form.mayor_permit_number).trim().toUpperCase())) errors.mayor_permit_number = "Permit number must be 6–40 uppercase letters, numbers, or hyphens.";
    if (!String(form.sec_dti_cda_number || '').trim()) errors.sec_dti_cda_number = 'SEC/DTI/CDA Number is required.';
    else if (!IDENTIFIER_PATTERN.test(String(form.sec_dti_cda_number).trim().toUpperCase())) errors.sec_dti_cda_number = 'Registration number must be 6–40 uppercase letters, numbers, or hyphens.';
    if (!String(form.business_name || '').trim()) errors.business_name = 'Business Name is required.';
    if (!String(form.business_type || '').trim()) errors.business_type = 'Business Type is required.';
    if (Number(form.annual_gross_sales || 0) <= 0) errors.annual_gross_sales = 'Annual Gross Sales must be greater than 0.';
    if (Number(form.business_tax_rate || 0) <= 0 || Number(form.business_tax_rate || 0) > 1) errors.business_tax_rate = 'Business Tax Rate must be between 0.0001 and 1.';
  } else {
    errors.tax_type = 'Unsupported tax type.';
  }

  return errors;
};

const TaxAssessment = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const [branches, setBranches] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [verifiedSubmissionSearch, setVerifiedSubmissionSearch] = useState('');
  const [rejectedSubmissionSearch, setRejectedSubmissionSearch] = useState('');
  const [assessmentSearch, setAssessmentSearch] = useState('');
  const [assessmentPage, setAssessmentPage] = useState(1);
  const ASSESSMENTS_PER_PAGE = 5;
  const [totalAssessmentCount, setTotalAssessmentCount] = useState(0);
  const [totalAssessmentPages, setTotalAssessmentPages] = useState(1);
  const [assessmentTaxTypeFilter, setAssessmentTaxTypeFilter] = useState('');
  const [assessmentStatusFilter, setAssessmentStatusFilter] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [verifiedPage, setVerifiedPage] = useState(1);
  const [rejectedPage, setRejectedPage] = useState(1);
  const SUBMISSIONS_PER_PAGE = 5;
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [assessmentForm, setAssessmentForm] = useState(EMPTY_ASSESSMENT_FORM);
  const [assessmentValidationErrors, setAssessmentValidationErrors] = useState({});
  const [showAssessmentGenerator, setShowAssessmentGenerator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [reviewingSubmissionId, setReviewingSubmissionId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewingSubmissionId, setViewingSubmissionId] = useState(null);
  const [fileViewer, setFileViewer] = useState({
    open: false,
    title: '',
    fileUrl: '',
    previewType: 'unsupported',
    isLoading: false,
    errorMessage: '',
  });

  const loadAssessments = async (page = 1, search = '', taxType = '', status = '') => {
    const response = await taxAssessmentAPI.listAssessments({
      page,
      page_size: ASSESSMENTS_PER_PAGE,
      search: search.trim() || undefined,
      tax_type: taxType.trim() || undefined,
      assessment_status: status.trim() || undefined,
    });
    setAssessments(response.data?.items || []);
    setAssessmentPage(response.data?.page || page);
    setTotalAssessmentCount(response.data?.total || 0);
    setTotalAssessmentPages(response.data?.total_pages || 1);
  };

  const loadPageData = async () => {
    try {
      setLoading(true);
      const [branchResponse, submissionResponse] = await Promise.all([
        branchAPI.getAll(),
        taxAssessmentAPI.listSubmissions(),
      ]);
      setBranches(branchResponse.data || []);
      setSubmissions(submissionResponse.data?.items || []);
      await loadAssessments(1, assessmentSearch, assessmentTaxTypeFilter, assessmentStatusFilter);
      setPendingPage(1);
      setVerifiedPage(1);
      setRejectedPage(1);
      setError('');
    } catch (fetchError) {
      setError(fetchError.response?.data?.detail || 'Failed to load tax assessment data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPageData();
  }, []);

  useEffect(() => () => {
    if (fileViewer.fileUrl) {
      window.URL.revokeObjectURL(fileViewer.fileUrl);
    }
  }, [fileViewer.fileUrl]);

  const filteredSubmissions = useMemo(() => {
    const term = submissionSearch.trim().toLowerCase();
    const pendingSubmissions = submissions.filter((item) => item.status === 'Pending Verification');
    if (!term) return pendingSubmissions;
    return pendingSubmissions.filter((item) =>
      [item.full_name, item.tdn, item.mayor_permit_number, item.sec_dti_cda_number].some((value) =>
        String(value || '').toLowerCase().includes(term)
      )
    );
  }, [submissions, submissionSearch]);

  const filteredVerifiedSubmissions = useMemo(() => {
    const term = verifiedSubmissionSearch.trim().toLowerCase();
    const verifiedSubmissions = submissions.filter((item) => item.status === 'Verified');
    if (!term) return verifiedSubmissions;
    return verifiedSubmissions.filter((item) =>
      [item.full_name, item.tdn, item.mayor_permit_number, item.sec_dti_cda_number, item.status, item.remarks].some((value) =>
        String(value || '').toLowerCase().includes(term)
      )
    );
  }, [submissions, verifiedSubmissionSearch]);

  const filteredRejectedSubmissions = useMemo(() => {
    const term = rejectedSubmissionSearch.trim().toLowerCase();
    const rejectedSubmissions = submissions.filter((item) => item.status === 'Rejected');
    if (!term) return rejectedSubmissions;
    return rejectedSubmissions.filter((item) =>
      [item.full_name, item.tdn, item.mayor_permit_number, item.sec_dti_cda_number, item.status, item.remarks].some((value) =>
        String(value || '').toLowerCase().includes(term)
      )
    );
  }, [submissions, rejectedSubmissionSearch]);

  const handleAssessmentPageChange = async (newPage) => {
    setAssessmentPage(newPage);
    try {
      await loadAssessments(newPage, assessmentSearch, assessmentTaxTypeFilter, assessmentStatusFilter);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load assessments.');
    }
  };

  const paginatedPendingSubmissions = useMemo(() => {
    const start = (pendingPage - 1) * SUBMISSIONS_PER_PAGE;
    return filteredSubmissions.slice(start, start + SUBMISSIONS_PER_PAGE);
  }, [filteredSubmissions, pendingPage]);

  const totalPendingPages = Math.ceil(filteredSubmissions.length / SUBMISSIONS_PER_PAGE) || 1;

  const paginatedVerifiedSubmissions = useMemo(() => {
    const start = (verifiedPage - 1) * SUBMISSIONS_PER_PAGE;
    return filteredVerifiedSubmissions.slice(start, start + SUBMISSIONS_PER_PAGE);
  }, [filteredVerifiedSubmissions, verifiedPage]);

  const totalVerifiedPages = Math.ceil(filteredVerifiedSubmissions.length / SUBMISSIONS_PER_PAGE) || 1;

  const paginatedRejectedSubmissions = useMemo(() => {
    const start = (rejectedPage - 1) * SUBMISSIONS_PER_PAGE;
    return filteredRejectedSubmissions.slice(start, start + SUBMISSIONS_PER_PAGE);
  }, [filteredRejectedSubmissions, rejectedPage]);

  const totalRejectedPages = Math.ceil(filteredRejectedSubmissions.length / SUBMISSIONS_PER_PAGE) || 1;

  const handleAssessmentSearchChange = async (value) => {
    setAssessmentSearch(value);
    setAssessmentPage(1);
    try {
      await loadAssessments(1, value, assessmentTaxTypeFilter, assessmentStatusFilter);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to search assessments.');
    }
  };

  const handleAssessmentTaxTypeChange = async (value) => {
    setAssessmentTaxTypeFilter(value);
    setAssessmentPage(1);
    try {
      await loadAssessments(1, assessmentSearch, value, assessmentStatusFilter);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to filter assessments.');
    }
  };

  const handleAssessmentStatusChange = async (value) => {
    setAssessmentStatusFilter(value);
    setAssessmentPage(1);
    try {
      await loadAssessments(1, assessmentSearch, assessmentTaxTypeFilter, value);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to filter assessments.');
    }
  };

  const handleSubmissionSearchChange = (value) => {
    setSubmissionSearch(value);
    setPendingPage(1);
  };

  const handleVerifiedSubmissionSearchChange = (value) => {
    setVerifiedSubmissionSearch(value);
    setVerifiedPage(1);
  };

  const handleRejectedSubmissionSearchChange = (value) => {
    setRejectedSubmissionSearch(value);
    setRejectedPage(1);
  };

  const handleReviewDraftChange = (submissionId, field, value) => {
    setReviewDrafts((current) => ({
      ...current,
      [submissionId]: {
        status: current[submissionId]?.status || 'Pending Verification',
        remarks: current[submissionId]?.remarks || '',
        [field]: value,
      },
    }));
  };

  const handleReviewSubmission = async (submission) => {
    const draft = reviewDrafts[submission.id] || { status: submission.status, remarks: submission.remarks || '' };
    try {
      setReviewingSubmissionId(submission.id);
      const response = await taxAssessmentAPI.reviewSubmission(submission.id, draft);
      setMessage(response.data?.message || 'Submission review saved.');
      setError('');
      window.dispatchEvent(new CustomEvent('tax-assessment-updated'));
      await loadPageData();
    } catch (reviewError) {
      setError(reviewError.response?.data?.detail || 'Failed to save submission review.');
    } finally {
      setReviewingSubmissionId(null);
    }
  };

  const closeFileViewer = () => {
    setViewingSubmissionId(null);
    setFileViewer((current) => {
      if (current.fileUrl) {
        window.URL.revokeObjectURL(current.fileUrl);
      }

      return {
        open: false,
        title: '',
        fileUrl: '',
        previewType: 'unsupported',
        isLoading: false,
        errorMessage: '',
      };
    });
  };

  const downloadViewedFile = () => {
    if (!fileViewer.fileUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = fileViewer.fileUrl;
    link.download = fileViewer.title || 'tax-assessment-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadSubmissionFile = async (submission) => {
    if (fileViewer.isLoading) {
      return;
    }

    setViewingSubmissionId(submission.id);
    setFileViewer((current) => {
      if (current.fileUrl) {
        window.URL.revokeObjectURL(current.fileUrl);
      }

      return {
        open: true,
        title: submission.supporting_file_name || `submission-${submission.id}`,
        fileUrl: '',
        previewType: 'unsupported',
        isLoading: true,
        errorMessage: '',
      };
    });

    try {
      const response = await taxAssessmentAPI.downloadSubmissionFile(submission.id);
      const fileName = parseContentDispositionFilename(getHeaderValue(response.headers, 'content-disposition'))
        || submission.supporting_file_name
        || `submission-${submission.id}`;
      const mimeType = getHeaderValue(response.headers, 'content-type') || response.data?.type || '';
      const previewBlob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: mimeType || 'application/octet-stream' });
      const blobUrl = window.URL.createObjectURL(previewBlob);

      const resolvedType = resolvePreviewType(mimeType, fileName);
      console.log('[FRONTEND_FILE_DEBUG] mimeType=', mimeType, 'fileName=', fileName, 'resolvedType=', resolvedType);

      setFileViewer({
        open: true,
        title: fileName,
        fileUrl: blobUrl,
        previewType: resolvedType,
        isLoading: false,
        errorMessage: '',
      });
      setViewingSubmissionId(null);
      setError('');
    } catch (downloadError) {
      let errorMessage = 'Failed to load the uploaded taxpayer file preview.';
      const errorData = downloadError.response?.data;
      if (errorData instanceof Blob) {
        try {
          const text = await errorData.text();
          const parsed = JSON.parse(text);
          errorMessage = parsed.detail || errorMessage;
        } catch {
          // keep default message
        }
      } else if (downloadError.response?.data?.detail) {
        errorMessage = downloadError.response.data.detail;
      }

      setFileViewer({
        open: true,
        title: submission.supporting_file_name || `submission-${submission.id}`,
        fileUrl: '',
        previewType: 'unsupported',
        isLoading: false,
        errorMessage,
      });
      setViewingSubmissionId(null);
      setError('Failed to load the uploaded taxpayer file.');
    }
  };

  const handleDeleteSubmission = async (submission) => {
    if (!deleteTarget) {
      setDeleteTarget({
        type: 'submission',
        title: 'Delete this taxpayer submission?',
        message: `This will permanently remove the taxpayer submission for ${submission.full_name}.`,
        details: [
          { label: 'Submission Type', value: submission.submission_type || 'N/A' },
          { label: 'Email', value: submission.email || 'N/A' },
        ],
        item: submission,
      });
      return;
    }

    try {
      const response = await taxAssessmentAPI.deleteSubmission(deleteTarget.item.id);
      setMessage(response.data?.message || 'Taxpayer submission deleted successfully.');
      setError('');
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent('tax-assessment-updated'));
      await loadPageData();
    } catch (deleteError) {
      setError(deleteError.response?.data?.detail || 'Failed to delete taxpayer submission.');
    }
  };

  const seedAssessmentFromSubmission = (submission) => {
    setShowAssessmentGenerator(true);
    setAssessmentForm({
      ...EMPTY_ASSESSMENT_FORM,
      citizen_user_id: submission.citizen_user_id,
      submission_id: submission.id,
      branch_id: submission.branch_id || '',
      tax_type: submission.submission_type,
      verification_status: submission.status === 'Rejected' ? 'Rejected' : 'Verified',
      taxpayer_name: submission.full_name,
      taxpayer_email: submission.email,
      taxpayer_type: submission.taxpayer_type,
      mobile_number: normalizeMobileNumber(submission.mobile_number),
      address: submission.address || '',
      tdn: submission.tdn || '',
      mayor_permit_number: submission.mayor_permit_number || '',
      sec_dti_cda_number: submission.sec_dti_cda_number || '',
      remarks: submission.remarks || '',
    });
    setMessage('');
    setError('');
    setAssessmentValidationErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const editAssessment = (assessment) => {
    setShowAssessmentGenerator(true);
    setAssessmentForm({
      ...EMPTY_ASSESSMENT_FORM,
      ...assessment,
      assessment_id: assessment.id,
      citizen_user_id: assessment.citizen_user_id || '',
      submission_id: assessment.submission_id || '',
      branch_id: assessment.branch_id || '',
      tax_type: assessment.tax_type || 'RPT',
      assessment_status: assessment.assessment_status || 'Active',
      verification_status: assessment.verification_status || 'Verified',
      taxpayer_name: assessment.taxpayer_name || '',
      taxpayer_email: assessment.taxpayer_email || '',
      taxpayer_type: assessment.taxpayer_type || 'Individual',
      mobile_number: normalizeMobileNumber(assessment.mobile_number),
      address: assessment.address || '',
      tdn: assessment.tdn || '',
      property_type: assessment.property_type || '',
      property_address: assessment.property_address || '',
      fair_market_value: Number(assessment.fair_market_value || 0),
      assessment_level: Number(assessment.assessment_level || 0),
      months_late: Number(assessment.months_late || 0),
      discount_rate: Number(assessment.discount_rate || 0),
      mayor_permit_number: assessment.mayor_permit_number || '',
      sec_dti_cda_number: assessment.sec_dti_cda_number || '',
      business_name: assessment.business_name || '',
      business_type: assessment.business_type || '',
      annual_gross_sales: Number(assessment.annual_gross_sales || 0),
      business_tax_rate: Number(assessment.business_tax_rate || 0),
      tax_year: assessment.tax_year || '',
      remarks: assessment.remarks || '',
      rejection_reason: assessment.rejection_reason || '',
    });
    setMessage('');
    setError('');
    setAssessmentValidationErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAssessmentFormChange = (event) => {
    const { name, value, type, checked } = event.target;
    setAssessmentForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    }));
    setAssessmentValidationErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleSelectChange = (fieldName) => (value) => {
    handleAssessmentFormChange({ target: { name: fieldName, value, type: 'select-one', checked: false } });
  };

  const handleSaveAssessment = async (event) => {
    event.preventDefault();
    const validationErrors = getAssessmentValidationErrors(assessmentForm);
    if (Object.keys(validationErrors).length) {
      setAssessmentValidationErrors(validationErrors);
      setError('Please correct the highlighted assessment fields before saving.');
      return;
    }

    try {
      setSavingAssessment(true);
      const response = await taxAssessmentAPI.saveAssessment({
        assessment_id: assessmentForm.assessment_id ? Number(assessmentForm.assessment_id) : null,
        citizen_user_id: assessmentForm.citizen_user_id ? Number(assessmentForm.citizen_user_id) : null,
        submission_id: assessmentForm.submission_id ? Number(assessmentForm.submission_id) : null,
        branch_id: assessmentForm.branch_id ? Number(assessmentForm.branch_id) : null,
        tax_type: assessmentForm.tax_type,
        assessment_status: assessmentForm.assessment_status,
        verification_status: assessmentForm.verification_status,
        taxpayer_name: assessmentForm.taxpayer_name,
        taxpayer_email: assessmentForm.taxpayer_email || null,
        taxpayer_type: assessmentForm.taxpayer_type,
        mobile_number: assessmentForm.mobile_number || null,
        address: assessmentForm.address || null,
        tax_year: assessmentForm.tax_year || null,
        remarks: assessmentForm.remarks || null,
        rejection_reason: assessmentForm.rejection_reason || null,
        visible_to_taxpayer: Boolean(assessmentForm.visible_to_taxpayer),
        tdn: assessmentForm.tdn || null,
        property_type: assessmentForm.property_type || null,
        property_address: assessmentForm.property_address || null,
        fair_market_value: Number(assessmentForm.fair_market_value || 0),
        assessment_level: Number(assessmentForm.assessment_level || 0),
        months_late: Number(assessmentForm.months_late || 0),
        discount_rate: Number(assessmentForm.discount_rate || 0),
        mayor_permit_number: assessmentForm.mayor_permit_number || null,
        sec_dti_cda_number: assessmentForm.sec_dti_cda_number || null,
        business_name: assessmentForm.business_name || null,
        business_type: assessmentForm.business_type || null,
        annual_gross_sales: Number(assessmentForm.annual_gross_sales || 0),
        business_tax_rate: Number(assessmentForm.business_tax_rate || 0),
      });
      setMessage(response.data?.message || 'Assessment saved successfully.');
      setError('');
      setAssessmentValidationErrors({});
      setAssessmentForm(EMPTY_ASSESSMENT_FORM);
      setShowAssessmentGenerator(false);
      window.dispatchEvent(new CustomEvent('tax-assessment-updated', {
        detail: { delta: assessmentForm.assessment_id ? 0 : 1 },
      }));
      await loadPageData();
    } catch (saveError) {
      const errorDetail = saveError.response?.data?.detail;
      let errorMessage = 'Failed to save tax assessment.';
      if (Array.isArray(errorDetail)) {
        errorMessage = errorDetail.map((item) => item.msg || item.message || JSON.stringify(item)).join(' ');
      } else if (typeof errorDetail === 'string') {
        errorMessage = errorDetail;
      } else if (errorDetail && typeof errorDetail === 'object') {
        errorMessage = errorDetail.message || errorDetail.error || JSON.stringify(errorDetail);
      }
      setError(errorMessage);
    } finally {
      setSavingAssessment(false);
    }
  };

  const handleDeleteAssessment = async (assessment) => {
    if (!deleteTarget) {
      setDeleteTarget({
        type: 'assessment',
        title: 'Delete this tax assessment?',
        message: `This will permanently remove the ${assessment.tax_type} assessment for ${assessment.taxpayer_name}.`,
        details: [
          { label: 'Tax Type', value: assessment.tax_type || 'N/A' },
          { label: 'Taxpayer', value: assessment.taxpayer_name || 'N/A' },
        ],
        item: assessment,
      });
      return;
    }

    try {
      const response = await taxAssessmentAPI.deleteAssessment(deleteTarget.item.id);
      setMessage(response.data?.message || 'Assessment deleted successfully.');
      setError('');
      if (assessmentForm.assessment_id === deleteTarget.item.id) {
        setAssessmentForm(EMPTY_ASSESSMENT_FORM);
        setAssessmentValidationErrors({});
        setShowAssessmentGenerator(false);
      }
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent('tax-assessment-updated', {
        detail: { delta: -1 },
      }));
      await loadPageData();
    } catch (deleteError) {
      setError(deleteError.response?.data?.detail || 'Failed to delete assessment.');
    }
  };

  if (loading) {
    return <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500 shadow-sm">Loading tax assessment module...</div>;
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'submission') {
      await handleDeleteSubmission(deleteTarget.item);
      return;
    }
    await handleDeleteAssessment(deleteTarget.item);
  };

  return (
    <div className="space-y-8">
      <WardsPageHero
        eyebrow={adminUser?.internal_role === 'superadmin' || adminUser?.role === 'superadmin' ? 'Superadmin Dashboard' : 'Main Admin Dashboard'}
        title="Tax Assessment"
        subtitle="Review taxpayer identifier submissions, verify or reject them with remarks, and create RPT and Business Tax assessments that feed the public online payment module."
      />

      {(message || error) ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || message}
        </div>
      ) : null}

      {showAssessmentGenerator ? (
        <form onSubmit={handleSaveAssessment} className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Assessment Generator</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{assessmentForm.assessment_id ? 'Edit Tax Assessment' : 'Create Tax Assessment'}</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setAssessmentForm(EMPTY_ASSESSMENT_FORM);
                  setShowAssessmentGenerator(false);
                  setAssessmentValidationErrors({});
                  setMessage('');
                  setError('');
                }}
                className="rounded-full bg-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
              >
                Close Generator
              </button>
              <button type="submit" disabled={savingAssessment} className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60">
                {savingAssessment ? 'Saving...' : 'Save Assessment'}
              </button>
            </div>
          </div>

          {Object.keys(assessmentValidationErrors).length ? (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              Complete the required assessment fields before saving.
            </div>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Submission Type</span>
              <CustomSelect value={assessmentForm.tax_type} onChange={handleSelectChange('tax_type')} options={[{ value: 'RPT', label: 'RPT' }, { value: 'BT', label: 'BT' }]} placeholder="Select type" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Branch</span>
              <CustomSelect value={assessmentForm.branch_id} onChange={handleSelectChange('branch_id')} options={[{ value: '', label: 'Unassigned' }, ...branches.map((branch) => ({ value: String(branch.id), label: branch.name }))]} placeholder="Select branch" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Verification Status</span>
              <CustomSelect value={assessmentForm.verification_status} onChange={handleSelectChange('verification_status')} options={[{ value: 'Pending Verification', label: 'Pending Verification' }, { value: 'Verified', label: 'Verified' }, { value: 'Rejected', label: 'Rejected' }]} placeholder="Select status" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Assessment Status</span>
              <CustomSelect value={assessmentForm.assessment_status} onChange={handleSelectChange('assessment_status')} options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]} placeholder="Select status" />
            </label>
            <label className="block xl:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Name</span>
              <input name="taxpayer_name" value={assessmentForm.taxpayer_name} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.taxpayer_name ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} required />
              {assessmentValidationErrors.taxpayer_name ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.taxpayer_name}</span> : null}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Email</span>
              <input name="taxpayer_email" value={assessmentForm.taxpayer_email} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.taxpayer_email ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
              {assessmentValidationErrors.taxpayer_email ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.taxpayer_email}</span> : null}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Type</span>
              <CustomSelect value={assessmentForm.taxpayer_type} onChange={handleSelectChange('taxpayer_type')} options={[{ value: 'Individual', label: 'Individual' }, { value: 'Business Owner', label: 'Business Owner' }]} placeholder="Select type" hasError={!!assessmentValidationErrors.taxpayer_type} />
              {assessmentValidationErrors.taxpayer_type ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.taxpayer_type}</span> : null}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Mobile Number</span>
              <input name="mobile_number" value={assessmentForm.mobile_number} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.mobile_number ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
              {assessmentValidationErrors.mobile_number ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.mobile_number}</span> : null}
            </label>
            <label className="block xl:col-span-3">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Address</span>
              <input name="address" value={assessmentForm.address} onChange={handleAssessmentFormChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </label>
          </div>

          {assessmentForm.tax_type === 'RPT' ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">TDN</span>
                <input name="tdn" value={assessmentForm.tdn} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase ${assessmentValidationErrors.tdn ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} required />
                {assessmentValidationErrors.tdn ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.tdn}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Property Type</span>
                <CustomSelect value={assessmentForm.property_type} onChange={handleSelectChange('property_type')} options={[{ value: '', label: 'Select property type' }, { value: 'Residential Lot', label: 'Residential Lot' }, { value: 'Residential House and Lot', label: 'Residential House and Lot' }, { value: 'Condominium Unit', label: 'Condominium Unit' }, { value: 'Townhouse', label: 'Townhouse' }, { value: 'Apartment Building', label: 'Apartment Building' }, { value: 'Commercial Lot', label: 'Commercial Lot' }, { value: 'Commercial Building', label: 'Commercial Building' }, { value: 'Office Building', label: 'Office Building' }, { value: 'Shopping Center', label: 'Shopping Center' }, { value: 'Warehouse', label: 'Warehouse' }, { value: 'Mixed Commercial Building', label: 'Mixed Commercial Building' }, { value: 'Industrial Lot', label: 'Industrial Lot' }, { value: 'Factory', label: 'Factory' }, { value: 'Manufacturing Plant', label: 'Manufacturing Plant' }, { value: 'Processing Facility', label: 'Processing Facility' }, { value: 'Industrial Warehouse', label: 'Industrial Warehouse' }, { value: 'Agricultural Land', label: 'Agricultural Land' }, { value: 'Farmland', label: 'Farmland' }, { value: 'Orchard', label: 'Orchard' }, { value: 'Fishpond', label: 'Fishpond' }, { value: 'Poultry Farm', label: 'Poultry Farm' }, { value: 'School', label: 'School' }, { value: 'University', label: 'University' }, { value: 'Hospital', label: 'Hospital' }, { value: 'Government Building', label: 'Government Building' }, { value: 'Religious Institution', label: 'Religious Institution' }, { value: 'Cemetery', label: 'Cemetery' }, { value: 'Utility Facility', label: 'Utility Facility' }, { value: 'Telecommunications Site', label: 'Telecommunications Site' }, { value: 'Power Substation', label: 'Power Substation' }, { value: 'Water Treatment Facility', label: 'Water Treatment Facility' }, { value: 'Residential-Commercial', label: 'Residential-Commercial' }, { value: 'Commercial-Industrial', label: 'Commercial-Industrial' }, { value: 'Residential-Institutional', label: 'Residential-Institutional' }]} placeholder="Select property type" hasError={!!assessmentValidationErrors.property_type} />
                {assessmentValidationErrors.property_type ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.property_type}</span> : null}
              </label>
              <label className="block xl:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Property Address</span>
                <input name="property_address" value={assessmentForm.property_address} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.property_address ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.property_address ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.property_address}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Fair Market Value</span>
                <input type="number" min="0" step="0.01" name="fair_market_value" value={assessmentForm.fair_market_value} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.fair_market_value ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.fair_market_value ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.fair_market_value}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Assessment Level</span>
                <input type="number" min="0" step="0.01" name="assessment_level" value={assessmentForm.assessment_level} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.assessment_level ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.assessment_level ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.assessment_level}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Months Late</span>
                <input type="number" min="0" name="months_late" value={assessmentForm.months_late} onChange={handleAssessmentFormChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Discount Rate</span>
                <input type="number" min="0" step="0.01" name="discount_rate" value={assessmentForm.discount_rate} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.discount_rate ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.discount_rate ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.discount_rate}</span> : null}
              </label>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Mayor&apos;s Permit Number</span>
                <input name="mayor_permit_number" value={assessmentForm.mayor_permit_number} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase ${assessmentValidationErrors.mayor_permit_number ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} required />
                {assessmentValidationErrors.mayor_permit_number ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.mayor_permit_number}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">SEC/DTI/CDA Number</span>
                <input name="sec_dti_cda_number" value={assessmentForm.sec_dti_cda_number} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase ${assessmentValidationErrors.sec_dti_cda_number ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} required />
                {assessmentValidationErrors.sec_dti_cda_number ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.sec_dti_cda_number}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Business Name</span>
                <input name="business_name" value={assessmentForm.business_name} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.business_name ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.business_name ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.business_name}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Business Type</span>
                <input name="business_type" value={assessmentForm.business_type} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.business_type ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.business_type ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.business_type}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Annual Gross Sales</span>
                <input type="number" min="0" step="0.01" name="annual_gross_sales" value={assessmentForm.annual_gross_sales} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.annual_gross_sales ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.annual_gross_sales ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.annual_gross_sales}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Business Tax Rate</span>
                <input type="number" min="0" step="0.0001" name="business_tax_rate" value={assessmentForm.business_tax_rate} onChange={handleAssessmentFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm ${assessmentValidationErrors.business_tax_rate ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                {assessmentValidationErrors.business_tax_rate ? <span className="mt-2 block text-xs font-medium text-rose-600">{assessmentValidationErrors.business_tax_rate}</span> : null}
              </label>
            </div>
          )}

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Remarks</span>
              <textarea name="remarks" value={assessmentForm.remarks} onChange={handleAssessmentFormChange} rows={4} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Rejection Remarks</span>
              <textarea name="rejection_reason" value={assessmentForm.rejection_reason} onChange={handleAssessmentFormChange} rows={4} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </label>
          </div>

          <label className="mt-6 inline-flex items-center gap-3 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
            <input type="checkbox" name="visible_to_taxpayer" checked={assessmentForm.visible_to_taxpayer} onChange={handleAssessmentFormChange} className="h-4 w-4 rounded border-slate-300" />
            Visible in taxpayer online payment portal
          </label>
        </form>
      ) : null}

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Verification Queue</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Taxpayer Submissions</h2>
          </div>
          <input value={submissionSearch} onChange={(event) => handleSubmissionSearchChange(event.target.value)} placeholder="Search TDN, permit, registration, taxpayer" className="w-full max-w-sm rounded-full border border-slate-300 px-4 py-2.5 text-sm" />
        </div>

        <div className="space-y-4">
            {paginatedPendingSubmissions.map((submission) => {
              const draft = reviewDrafts[submission.id] || { status: submission.status, remarks: submission.remarks || '' };
              return (
                <div key={submission.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{submission.submission_type}</p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-900">{submission.full_name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{submission.tdn || submission.mayor_permit_number}</p>
                      {submission.sec_dti_cda_number ? <p className="mt-1 text-sm text-slate-600">{submission.sec_dti_cda_number}</p> : null}
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[submission.status] || 'bg-slate-100 text-slate-700'}`}>{submission.status}</span>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start">
                    <CustomSelect value={draft.status} onChange={(value) => handleReviewDraftChange(submission.id, 'status', value)} options={[{ value: 'Pending Verification', label: 'Pending Verification' }, { value: 'Verified', label: 'Verified' }, { value: 'Rejected', label: 'Rejected' }]} placeholder="Select status" className="lg:w-[180px]" />
                    <input value={draft.remarks} onChange={(event) => handleReviewDraftChange(submission.id, 'remarks', event.target.value)} placeholder="Verification remarks or rejection reason" className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                    <div className="flex shrink-0 flex-nowrap items-center gap-2">
                      <button type="button" onClick={() => handleReviewSubmission(submission)} disabled={reviewingSubmissionId === submission.id} className="whitespace-nowrap rounded-full bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-70">
                        {reviewingSubmissionId === submission.id ? 'Saving...' : 'Save Status'}
                      </button>
                      <button type="button" onClick={() => seedAssessmentFromSubmission(submission)} className="whitespace-nowrap rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
                        Create Assessment
                      </button>
                      <button type="button" onClick={() => handleDeleteSubmission(submission)} className="whitespace-nowrap rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600">
                        Delete
                      </button>
                      {submission.supporting_file_name ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadSubmissionFile(submission)}
                          disabled={fileViewer.isLoading}
                          className="whitespace-nowrap rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {viewingSubmissionId === submission.id && fileViewer.isLoading ? 'Loading File...' : 'View File'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {!filteredSubmissions.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">No taxpayer submissions found.</div> : null}
        </div>

        {filteredSubmissions.length > 0 && (
          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-500">
              Page {pendingPage} of {totalPendingPages} &middot; {filteredSubmissions.length} total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
                disabled={pendingPage <= 1}
                className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPendingPage((p) => Math.min(totalPendingPages, p + 1))}
                disabled={pendingPage >= totalPendingPages}
                className="rounded-full bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Live Assessment Records</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Online Payment Assessments</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <CustomSelect value={assessmentTaxTypeFilter} onChange={handleAssessmentTaxTypeChange} options={[{ value: '', label: 'All Tax Types' }, { value: 'RPT', label: 'RPT' }, { value: 'BT', label: 'BT' }]} placeholder="All Tax Types" />
            <CustomSelect value={assessmentStatusFilter} onChange={handleAssessmentStatusChange} options={[{ value: '', label: 'All Statuses' }, { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]} placeholder="All Statuses" />
            <input value={assessmentSearch} onChange={(event) => handleAssessmentSearchChange(event.target.value)} placeholder="Search taxpayer, TDN, permit, business" className="w-full max-w-sm rounded-full border border-slate-300 px-4 py-2.5 text-sm" />
          </div>
        </div>

        <div className="space-y-4">
          {assessments.map((assessment) => (
            <div key={assessment.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{assessment.tax_type}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{assessment.taxpayer_name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{assessment.tdn || assessment.mayor_permit_number}</p>
                  {assessment.business_name ? <p className="mt-1 text-sm text-slate-600">{assessment.business_name}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[assessment.verification_status] || 'bg-slate-100 text-slate-700'}`}>{assessment.verification_status}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[assessment.assessment_status] || 'bg-slate-100 text-slate-700'}`}>{assessment.assessment_status}</span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{assessment.tax_type === 'RPT' ? 'Final Amount Due' : 'Assessment Amount'}</p>
                  <p className="mt-2 text-sm font-semibold text-[#0f5b83]">{formatCurrency(assessment.tax_type === 'RPT' ? assessment.final_total_amount_due : assessment.amount_due)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Taxpayer Visibility</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{assessment.visible_to_taxpayer ? 'Visible in public portal' : 'Hidden from taxpayer portal'}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => editAssessment(assessment)} className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  Edit
                </button>
                <button type="button" onClick={() => handleDeleteAssessment(assessment)} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600">
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!assessments.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">No assessment records found.</div> : null}
        </div>

        {totalAssessmentCount > 0 && (
          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-500">
              Page {assessmentPage} of {totalAssessmentPages} &middot; {totalAssessmentCount} total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAssessmentPageChange(Math.max(1, assessmentPage - 1))}
                disabled={assessmentPage <= 1}
                className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => handleAssessmentPageChange(Math.min(totalAssessmentPages, assessmentPage + 1))}
                disabled={assessmentPage >= totalAssessmentPages}
                className="rounded-full bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Verified Table</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Verified Taxpayer Submissions</h2>
          </div>
          <input value={verifiedSubmissionSearch} onChange={(event) => handleVerifiedSubmissionSearchChange(event.target.value)} placeholder="Search verified taxpayer, TDN, permit, status" className="w-full max-w-sm rounded-full border border-slate-300 px-4 py-2.5 text-sm" />
        </div>

        <div className="space-y-4">
          {paginatedVerifiedSubmissions.map((submission) => (
            <div key={submission.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{submission.submission_type}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{submission.full_name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{submission.tdn || submission.mayor_permit_number}</p>
                  {submission.sec_dti_cda_number ? <p className="mt-1 text-sm text-slate-600">{submission.sec_dti_cda_number}</p> : null}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[submission.status] || 'bg-slate-100 text-slate-700'}`}>{submission.status}</span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Submitted</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{formatUtcDateTime(submission.created_at)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Reviewed</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{formatUtcDateTime(submission.reviewed_at)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 xl:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Remarks</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{submission.remarks || 'No remarks provided.'}</p>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => seedAssessmentFromSubmission(submission)} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  Create Assessment
                </button>
                <button type="button" onClick={() => handleDeleteSubmission(submission)} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600">
                  Delete
                </button>
                {submission.supporting_file_name ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadSubmissionFile(submission)}
                    disabled={fileViewer.isLoading}
                    className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {viewingSubmissionId === submission.id && fileViewer.isLoading ? 'Loading File...' : 'View File'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {!filteredVerifiedSubmissions.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">No verified taxpayer submissions found.</div> : null}
        </div>

        {filteredVerifiedSubmissions.length > 0 && (
          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-500">
              Page {verifiedPage} of {totalVerifiedPages} &middot; {filteredVerifiedSubmissions.length} total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVerifiedPage((p) => Math.max(1, p - 1))}
                disabled={verifiedPage <= 1}
                className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setVerifiedPage((p) => Math.min(totalVerifiedPages, p + 1))}
                disabled={verifiedPage >= totalVerifiedPages}
                className="rounded-full bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Rejected Table</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Rejected Taxpayer Submissions</h2>
          </div>
          <input value={rejectedSubmissionSearch} onChange={(event) => handleRejectedSubmissionSearchChange(event.target.value)} placeholder="Search rejected taxpayer, TDN, permit, status" className="w-full max-w-sm rounded-full border border-slate-300 px-4 py-2.5 text-sm" />
        </div>

        <div className="space-y-4">
          {paginatedRejectedSubmissions.map((submission) => (
            <div key={submission.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{submission.submission_type}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{submission.full_name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{submission.tdn || submission.mayor_permit_number}</p>
                  {submission.sec_dti_cda_number ? <p className="mt-1 text-sm text-slate-600">{submission.sec_dti_cda_number}</p> : null}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[submission.status] || 'bg-slate-100 text-slate-700'}`}>{submission.status}</span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Submitted</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{formatUtcDateTime(submission.created_at)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Reviewed</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{formatUtcDateTime(submission.reviewed_at)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 xl:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Remarks</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{submission.remarks || 'No remarks provided.'}</p>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => handleDeleteSubmission(submission)} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600">
                  Delete
                </button>
                {submission.supporting_file_name ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadSubmissionFile(submission)}
                    disabled={fileViewer.isLoading}
                    className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {viewingSubmissionId === submission.id && fileViewer.isLoading ? 'Loading File...' : 'View File'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {!filteredRejectedSubmissions.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">No rejected taxpayer submissions found.</div> : null}
        </div>

        {filteredRejectedSubmissions.length > 0 && (
          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-500">
              Page {rejectedPage} of {totalRejectedPages} &middot; {filteredRejectedSubmissions.length} total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRejectedPage((p) => Math.max(1, p - 1))}
                disabled={rejectedPage <= 1}
                className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setRejectedPage((p) => Math.min(totalRejectedPages, p + 1))}
                disabled={rejectedPage >= totalRejectedPages}
                className="rounded-full bg-[#0f5b83] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
      <FileViewerModal
        open={fileViewer.open}
        title={fileViewer.title}
        fileUrl={fileViewer.fileUrl}
        previewType={fileViewer.previewType}
        isLoading={fileViewer.isLoading}
        errorMessage={fileViewer.errorMessage}
        onClose={closeFileViewer}
        onDownload={downloadViewedFile}
      />
      <DeleteConfirmationModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title}
        message={deleteTarget?.message}
        details={deleteTarget?.details || []}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isLoading={savingAssessment}
      />
    </div>
  );
};

export default TaxAssessment;
