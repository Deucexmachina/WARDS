import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PaymentGatewayExperience from '../../components/PaymentGatewayExperience';
import { paymentAPI, taxpayerAccountAPI } from '../../services/api';
import { getStoredPublicUser } from '../../utils/publicSession';
import { formatTin } from '../../utils/validation';
import { appendLanguageParam, usePublicLanguage } from '../../utils/publicLanguage';

const API_ORIGIN = 'http://localhost:8000';
const SEARCH_OPTIONS = [
  { value: 'tracking_mp_no', label: 'Tracking/MP No.' },
  { value: 'mayors_permit_number', label: "Mayor's Permit Number" },
  { value: 'business_name', label: 'Business Name' },
  { value: 'owner_name', label: 'Owner Name' },
];
const CITIZEN_BT_REFRESH_INTERVAL_MS = 30000;
const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'VALIDATED', label: 'Validated' },
  { value: 'DOCUMENTS_UPLOADED', label: 'Documents Uploaded' },
  { value: 'PAYMENT_INITIATED', label: 'Payment Initiated' },
  { value: 'PENDING_TREASURY_VALIDATION', label: 'Pending Treasury Validation' },
  { value: 'RETURNED_FOR_CORRECTION', label: 'Returned For Correction' },
  { value: 'OR_GENERATED', label: 'Official Receipt Generated' },
];

const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildApiAssetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
};

const PayTaxesBT = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const publicUser = getStoredPublicUser();
  const [language] = usePublicLanguage();

  const [loading, setLoading] = useState(true);
  const [submittingValidation, setSubmittingValidation] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [generatingReference, setGeneratingReference] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [applications, setApplications] = useState([]);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchField, setSearchField] = useState('tracking_mp_no');
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [validationSearchStats, setValidationSearchStats] = useState(null);
  const [validationForm, setValidationForm] = useState({
    mayorPermitNumber: '',
    secDtiCdaNumber: '',
  });
  const [documentFiles, setDocumentFiles] = useState({
    salesDeclaration: null,
    financialStatements: null,
    supportingDocuments: null,
  });
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const [selectedBank, setSelectedBank] = useState('');
  const [paymentCustomer, setPaymentCustomer] = useState({
    name: publicUser?.full_name || '',
    email: publicUser?.email || '',
    mobile: publicUser?.contact_number || '',
  });
  const [linkedAssessments, setLinkedAssessments] = useState([]);

  const trackingFromQuery = searchParams.get('tracking') || '';
  const currentView = searchParams.get('view') || 'list';
  const isDashboardView = currentView === 'dashboard';

  const refreshLinkedAssessments = async () => {
    try {
      const response = await taxpayerAccountAPI.getAssessments({ tax_type: 'BT' });
      setLinkedAssessments(response.data?.items || []);
    } catch {
      // Leave the current linked assessment state unchanged on refresh failure.
    }
  };

  const fetchApplications = async (nextFilters = {}) => {
    const params = {
      searchField: nextFilters.searchField ?? searchField,
      searchTerm: nextFilters.searchTerm ?? searchTerm,
      applicationStatus: nextFilters.statusFilter ?? statusFilter,
    };

    try {
      const response = await paymentAPI.listBusinessTaxApplications(params);
      const items = response.data?.items || [];
      setApplications(items);

      const selectedTracking = nextFilters.selectedTracking ?? trackingFromQuery;
      if (selectedTracking && (nextFilters.keepSelectedDashboard ?? isDashboardView)) {
        const matched = items.find((item) => item.tracking_number === selectedTracking);
        if (matched) {
          setSelectedApplication(matched);
          return;
        }

        try {
          const selectedResponse = await paymentAPI.getBusinessTaxApplication(selectedTracking);
          setSelectedApplication(selectedResponse.data);
          return;
        } catch {
          setSelectedApplication(null);
        }
      }

      if (selectedApplication) {
        const refreshed = items.find((item) => item.tracking_number === selectedApplication.tracking_number);
        if (refreshed) {
          setSelectedApplication(refreshed);
        } else if (!(nextFilters.keepSelectedDashboard ?? isDashboardView)) {
          setSelectedApplication(null);
        }
      }
    } catch (fetchError) {
      setError(fetchError.response?.data?.detail || 'Failed to load Business Tax applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications({ keepSelectedDashboard: true });
    refreshLinkedAssessments();
  }, []);

  useEffect(() => {
    const refreshAll = () => {
      fetchApplications({ selectedTracking: trackingFromQuery || selectedApplication?.tracking_number || '', keepSelectedDashboard: true });
      refreshLinkedAssessments();
    };

    const refreshOnFocus = () => {
      refreshAll();
    };

    const intervalId = window.setInterval(refreshAll, CITIZEN_BT_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [trackingFromQuery, selectedApplication?.tracking_number, searchField, searchTerm, statusFilter, isDashboardView]);

  useEffect(() => {
    if (!trackingFromQuery || !applications.length) return;
    const matched = applications.find((item) => item.tracking_number === trackingFromQuery);
    if (matched) {
      setSelectedApplication(matched);
    }
  }, [trackingFromQuery, applications]);

  const selectedApplicationStatus = useMemo(
    () => (selectedApplication?.application_status || '').replace(/_/g, ' '),
    [selectedApplication],
  );
  const shouldShowPaymentPanels = useMemo(() => {
    if (!selectedApplication) return false;
    return !['VALIDATED'].includes(selectedApplication.application_status || '');
  }, [selectedApplication]);
  const shouldShowUploadPanel = useMemo(() => {
    if (!selectedApplication) return false;
    return ['VALIDATED', 'RETURNED_FOR_CORRECTION'].includes(selectedApplication.application_status || '');
  }, [selectedApplication]);
  const shouldShowReceiptOutcome = useMemo(() => {
    if (!selectedApplication) return false;
    return [
      'PENDING_TREASURY_VALIDATION',
      'PAYMENT_SUBMITTED',
      'PAYMENT_VERIFIED',
      'OR_GENERATED',
      'COMPLETED',
    ].includes(selectedApplication.application_status || '');
  }, [selectedApplication]);

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    await fetchApplications({
      searchField,
      searchTerm,
      statusFilter,
      selectedTracking: selectedApplication?.tracking_number || '',
    });
  };

  const handleValidateBusiness = async () => {
    setSubmittingValidation(true);
    setError('');
    setMessage('');
    try {
      const response = await paymentAPI.validateBusinessTaxRecord(validationForm);
      const nextApplication = response.data?.application;
      setValidationSearchStats({
        searchesRemaining: response.data?.searchesRemaining,
        searchesUsed: response.data?.searchesUsed,
        searchLimit: response.data?.searchLimit,
      });
      setShowValidationModal(false);
      setValidationForm({ mayorPermitNumber: '', secDtiCdaNumber: '' });
      setMessage('Business registry record validated successfully. You can now continue with the Business Tax assessment workflow.');
      if (nextApplication?.tracking_number) {
        setSearchParams({ tracking: nextApplication.tracking_number, view: 'dashboard' });
      }
      await fetchApplications({
        selectedTracking: nextApplication?.tracking_number || '',
      });
    } catch (validationError) {
      const detail = validationError.response?.data?.detail;
      if (typeof detail === 'object' && detail?.message) {
        setError(detail.message);
        setValidationSearchStats({
          searchesRemaining: detail.searchesRemaining,
          searchesUsed: detail.searchesUsed,
          searchLimit: detail.searchLimit,
        });
      } else {
        setError(detail || 'Failed to validate the business registry record.');
      }
    } finally {
      setSubmittingValidation(false);
    }
  };

  const handleUploadDocuments = async () => {
    if (!selectedApplication?.tracking_number) return;

    const formData = new FormData();
    if (documentFiles.salesDeclaration) formData.append('sales_declaration', documentFiles.salesDeclaration);
    if (documentFiles.financialStatements) formData.append('financial_statements', documentFiles.financialStatements);
    if (documentFiles.supportingDocuments) formData.append('supporting_documents', documentFiles.supportingDocuments);

    if (![documentFiles.salesDeclaration, documentFiles.financialStatements, documentFiles.supportingDocuments].some(Boolean)) {
      setError('Select at least one Business Tax document to upload.');
      return;
    }

    setUploadingDocs(true);
    setError('');
    setMessage('');
    try {
      const response = await paymentAPI.uploadBusinessTaxDocuments(selectedApplication.tracking_number, formData);
      setSelectedApplication(response.data);
      setDocumentFiles({ salesDeclaration: null, financialStatements: null, supportingDocuments: null });
      setMessage('Business Tax documents uploaded successfully.');
      await fetchApplications({ selectedTracking: selectedApplication.tracking_number });
    } catch (uploadError) {
      setError(uploadError.response?.data?.detail || 'Failed to upload Business Tax documents.');
    } finally {
      setUploadingDocs(false);
    }
  };

  const handleGenerateReference = async () => {
    if (!selectedApplication?.tracking_number) return;
    setGeneratingReference(true);
    setError('');
    setMessage('');
    try {
      const response = await paymentAPI.generateBusinessTaxReference(selectedApplication.tracking_number, {
        trackingNumber: selectedApplication.tracking_number,
        taxpayerName: paymentCustomer.name || publicUser?.full_name || '',
        email: paymentCustomer.email || publicUser?.email || '',
        contactNumber: paymentCustomer.mobile || publicUser?.contact_number || '',
        paymentMethod,
        bankCode: paymentMethod === 'banking' ? selectedBank : undefined,
      });
      setMessage(`Payment reference ${response.data?.refNumber} generated. Continue to PayMongo gateway when ready.`);
      await fetchApplications({ selectedTracking: selectedApplication.tracking_number });
    } catch (referenceError) {
      const detail = referenceError.response?.data?.detail;
      setError(typeof detail === 'object' ? detail?.message || 'Failed to generate Business Tax payment reference.' : detail || 'Failed to generate Business Tax payment reference.');
    } finally {
      setGeneratingReference(false);
    }
  };

  const handleProceedToPayment = async () => {
    if (!selectedApplication?.payment_ref_number) {
      setError('Generate a Business Tax payment reference first.');
      return;
    }

    setProcessingPayment(true);
    setError('');
    try {
      const response = await paymentAPI.processPayment({
        refNumber: selectedApplication.payment_ref_number,
        paymentMethod,
        bankCode: paymentMethod === 'banking' ? selectedBank : undefined,
      });

      if (response.data?.checkoutUrl) {
        window.open(response.data.checkoutUrl, 'wardsBusinessTaxCheckout');
        navigate(appendLanguageParam(`/payment/status?ref=${encodeURIComponent(selectedApplication.payment_ref_number)}`, language));
      }
    } catch (paymentError) {
      setError(paymentError.response?.data?.detail || 'Failed to open PayMongo checkout for Business Tax.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleOpenDashboard = (application) => {
    setSelectedApplication(application);
    setSearchParams({ tracking: application.tracking_number, view: 'dashboard' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToList = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', 'list');
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="min-h-screen bg-[linear-gradient(180deg,#eef4fb_0%,#f8fbff_38%,#edf3fa_100%)] py-14">
      <div className="mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[36px] border border-[#d8e4f5] bg-white shadow-[0_28px_70px_rgba(15,52,108,0.10)]">
          <div className="relative border-b border-slate-200 bg-[linear-gradient(135deg,#0f2f5f_0%,#18437f_52%,#2d69b3_100%)] px-8 py-10 text-white sm:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(255,255,255,0.14),transparent_24%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.10),transparent_20%),linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.06)_50%,transparent_100%)]" />
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-blue-100">2026 Business Tax Payment</p>
              <div className="mt-5 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-3xl">
                  <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-[2.4rem]">
                  {isDashboardView ? 'Business Tax Assessment Dashboard' : '2026 Business Tax Payment'}
                  </h1>
                  <p className="mt-3 text-sm leading-7 text-blue-100/95 sm:text-[15px]">
                    {isDashboardView
                      ? 'Review the validated business record, complete the document submission step, and continue through the same treasury-assisted payment architecture used by the RPT module.'
                      : 'Search your Business Tax applications, validate a Mayor&apos;s Permit Number with its SEC/DTI/CDA Number, and continue to the separate assessment dashboard when ready.'}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setMessage('');
                      setShowValidationModal(true);
                    }}
                    className="rounded-full bg-white px-7 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#123f8f] shadow-[0_10px_24px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.18)]"
                  >
                    Submit Online Sales Declaration
                  </button>
                  {isDashboardView ? (
                    <button
                      type="button"
                      onClick={handleBackToList}
                      className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white/18"
                    >
                      Back To Application List
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate('/pay-taxes/bt')}
                    className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white/18"
                  >
                    Back To Business Tax Gateway
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-10">
            {message ? (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">{message}</div>
            ) : null}
            {error ? (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
            ) : null}

            {!isDashboardView ? (
              <>
                {linkedAssessments.length ? (
                  <div className="mb-6 rounded-[28px] border border-[#d6e5ef] bg-[#f7fbfe] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#123f8f]">Verified BT Assessments On Your Account</p>
                        <p className="mt-2 text-sm text-slate-500">These business identifiers were prepared by Main Admin. Click one to prefill the validation modal fields.</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{linkedAssessments.length} linked record{linkedAssessments.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {linkedAssessments.map((assessment) => (
                        <button
                          key={assessment.id}
                          type="button"
                          onClick={() => {
                            setValidationForm({
                              mayorPermitNumber: assessment.mayor_permit_number || '',
                              secDtiCdaNumber: assessment.sec_dti_cda_number || '',
                            });
                            setShowValidationModal(true);
                            setError('');
                            setMessage('');
                          }}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-[#123f8f] hover:bg-[#fbfdff]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{assessment.business_name || assessment.mayor_permit_number}</p>
                              <p className="mt-1 text-xs text-slate-500">Mayor&apos;s Permit: {assessment.mayor_permit_number}</p>
                              <p className="mt-1 text-xs text-slate-500">SEC/DTI/CDA: {assessment.sec_dti_cda_number}</p>
                            </div>
                            <p className="text-xs font-semibold text-[#123f8f]">{formatCurrency(assessment.amount_due)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-[260px,240px,minmax(0,1fr),160px]">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Application Status</label>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Search By</label>
                    <select
                      value={searchField}
                      onChange={(event) => setSearchField(event.target.value)}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    >
                      {SEARCH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Search</label>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search your submitted Business Tax applications"
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleSearch}
                      className="w-full rounded-2xl bg-[#123f8f] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0f2f5f]"
                    >
                      Search
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-[28px] border border-slate-200">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-[#123f8f] text-white">
                      <tr>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Tracking/Mayor&apos;s Permit Number</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Business Name</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Business Owner</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Application Status</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Application Date</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {!loading && !applications.length ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-12 text-center text-slate-500">No Business Tax applications found for your account.</td>
                        </tr>
                      ) : null}
                      {applications.map((application) => (
                        <tr key={application.tracking_number} className="hover:bg-slate-50">
                          <td className="px-5 py-4 align-top">
                            <p className="font-semibold text-[#123f8f]">{application.tracking_number}</p>
                            <p className="mt-1 text-xs text-slate-500">{application.mayor_permit_number}</p>
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">{application.business_name}</td>
                          <td className="px-5 py-4 align-top text-slate-700">{application.owner_name}</td>
                          <td className="px-5 py-4 align-top">
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-[#123f8f]">
                              {(application.application_status || 'VALIDATED').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">{new Date(application.created_at).toLocaleDateString('en-PH')}</td>
                          <td className="px-5 py-4 align-top">
                            <button
                              type="button"
                              onClick={() => handleOpenDashboard(application)}
                              className="rounded-full bg-[#0f2f5f] px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-white transition hover:bg-[#123f8f]"
                            >
                              Open Dashboard
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {isDashboardView && selectedApplication ? (
              <div className={`mt-8 grid gap-7 ${shouldShowPaymentPanels ? '' : 'max-w-[860px] mx-auto'}`}>
                <div className="space-y-6">
                  <div className="rounded-[30px] border border-[#d9e7f9] bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] p-7 shadow-[0_12px_28px_rgba(15,52,108,0.05)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Business Tax Assessment Dashboard</p>
                        <h2 className="mt-2 text-[2rem] font-bold tracking-[-0.02em] text-[#0f2f5f]">{selectedApplication.business_name}</h2>
                        <p className="mt-2 text-sm text-slate-600">Tracking No. {selectedApplication.tracking_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Status</p>
                        <p className="mt-2 text-base font-bold text-[#123f8f]">{selectedApplicationStatus}</p>
                      </div>
                    </div>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mayor&apos;s Permit Number</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.mayor_permit_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">SEC/DTI/CDA Number</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.sec_dti_cda_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Branch Assigned</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.branch_name}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Business Type</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.business_type}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Registered Owner</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.owner_name}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Taxpayer TIN</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.tin || formatTin(publicUser?.tin || '') || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  {shouldShowUploadPanel ? (
                    <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-[1.15rem] font-bold text-slate-900">Required Document Uploads</h3>
                          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">Upload the Financial Statements, Sales Declaration, Proof of Payment, and supporting documents for this Business Tax transaction.</p>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Sales Declaration File</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={(event) => setDocumentFiles((current) => ({ ...current, salesDeclaration: event.target.files?.[0] || null }))} className="w-full rounded-[18px] border border-slate-300 px-4 py-3 text-sm shadow-sm" />
                          {selectedApplication.sales_declaration_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.sales_declaration_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              View current file: {selectedApplication.sales_declaration_name}
                            </a>
                          ) : null}
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Financial Statements</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={(event) => setDocumentFiles((current) => ({ ...current, financialStatements: event.target.files?.[0] || null }))} className="w-full rounded-[18px] border border-slate-300 px-4 py-3 text-sm shadow-sm" />
                          {selectedApplication.financial_statements_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.financial_statements_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              View current file: {selectedApplication.financial_statements_name}
                            </a>
                          ) : null}
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Supporting Documents</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={(event) => setDocumentFiles((current) => ({ ...current, supportingDocuments: event.target.files?.[0] || null }))} className="w-full rounded-[18px] border border-slate-300 px-4 py-3 text-sm shadow-sm" />
                          {selectedApplication.supporting_documents_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.supporting_documents_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              View current file: {selectedApplication.supporting_documents_name}
                            </a>
                          ) : null}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleUploadDocuments}
                        disabled={uploadingDocs}
                        className="mt-6 rounded-full bg-[linear-gradient(135deg,#123f8f_0%,#0f2f5f_100%)] px-7 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(15,52,108,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(15,52,108,0.22)] disabled:opacity-60"
                      >
                        {uploadingDocs ? 'Uploading Documents...' : 'Upload Business Tax Documents'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {shouldShowPaymentPanels ? (
                  <div className="space-y-6">
                      <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                        <h3 className="text-[1.15rem] font-bold text-slate-900">Tax Computation</h3>
                        <p className="mt-2 text-sm leading-7 text-slate-500">This capstone build computes the amount due from the simulated Business Registry record associated with your Mayor&apos;s Permit Number.</p>
                        <div className="mt-6 rounded-[26px] bg-[linear-gradient(135deg,#0f2f5f_0%,#123f8f_100%)] p-6 text-white shadow-[0_14px_32px_rgba(15,52,108,0.18)]">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100">Business Tax Due</p>
                          <p className="mt-3 text-[2.3rem] font-bold tracking-[-0.02em]">{formatCurrency(selectedApplication.amount_due)}</p>
                          <p className="mt-3 text-sm text-blue-100">Branch: {selectedApplication.branch_name}</p>
                        </div>
                      </div>

                      <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                        <h3 className="text-[1.15rem] font-bold text-slate-900">Payment And Treasury Verification</h3>
                        <p className="mt-2 text-sm leading-7 text-slate-500">WARDS validates the selected payment details first. PayMongo is used as the final hosted gateway for transaction processing and success or failed status validation.</p>

                        <div className="mt-6 space-y-4">
                          <PaymentGatewayExperience
                            amount={selectedApplication.amount_due}
                            bankCode={selectedBank}
                            customer={paymentCustomer}
                            method={paymentMethod}
                            onBankChange={setSelectedBank}
                            onCustomerChange={setPaymentCustomer}
                            onMethodChange={(value) => {
                              setPaymentMethod(value);
                              setSelectedBank('');
                            }}
                            onContinue={selectedApplication.payment_ref_number ? handleProceedToPayment : handleGenerateReference}
                            processing={generatingReference || processingPayment}
                            referenceNumber={selectedApplication.payment_ref_number}
                            title={language === 'en' ? 'Business Tax Checkout' : 'Checkout ng Business Tax'}
                            language={language}
                          />
                        </div>
                      </div>

                      {shouldShowReceiptOutcome ? (
                        <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                        <h3 className="text-[1.15rem] font-bold text-slate-900">Receipt And Branch Outcome</h3>
                        <div className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
                          <p>Proof of payment upload is completed through the payment status page after PayMongo gateway processing.</p>
                          <p>Branch treasury personnel can verify, approve, reject, or return your submission for correction inside the Branch Admin portal.</p>
                          <p>Once verified, your Business Tax Official Receipt will appear here.</p>
                        </div>

                        {selectedApplication.proof_of_payment_name ? (
                          <a href={buildApiAssetUrl(selectedApplication.proof_of_payment_download_url)} target="_blank" rel="noreferrer" className="mt-5 inline-block text-sm font-semibold text-[#123f8f] underline underline-offset-4">
                            Download uploaded proof of payment: {selectedApplication.proof_of_payment_name}
                          </a>
                        ) : null}
                        {selectedApplication.official_receipt_number ? (
                          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                            <p className="font-semibold text-emerald-900">Official Receipt Ready</p>
                            <p className="mt-1 text-sm text-emerald-800">{selectedApplication.official_receipt_number}</p>
                            <a href={buildApiAssetUrl(selectedApplication.official_receipt_download_url)} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-white">
                              Download Business Tax OR
                            </a>
                          </div>
                        ) : null}
                        {selectedApplication.verifier_remarks ? (
                          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                            <span className="font-semibold">Branch Remarks:</span> {selectedApplication.verifier_remarks}
                          </div>
                        ) : null}
                        </div>
                      ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showValidationModal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[34px] bg-white p-8 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <h2 className="text-center text-3xl font-bold text-slate-900">2026 Business Tax Payment</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-[220px,minmax(0,1fr)] md:items-start">
              <div className="space-y-4 text-sm leading-7 text-slate-600">
                <p>Validate your Business Tax record using the simulated WARDS Business Registry.</p>
                <p>The system checks if the Mayor&apos;s Permit Number exists, if the SEC/DTI/CDA Number exists, and whether both belong to the same active registered business.</p>
                {validationSearchStats ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    Searches used today: {validationSearchStats.searchesUsed} / {validationSearchStats.searchLimit}
                    <br />
                    Searches remaining: {validationSearchStats.searchesRemaining}
                  </div>
                ) : null}
              </div>
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Mayor&apos;s Permit Number</label>
                  <input
                    type="text"
                    value={validationForm.mayorPermitNumber}
                    onChange={(event) => setValidationForm((current) => ({ ...current, mayorPermitNumber: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    placeholder="BP-2026-000145"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">SEC/DTI/CDA Number</label>
                  <input
                    type="text"
                    value={validationForm.secDtiCdaNumber}
                    onChange={(event) => setValidationForm((current) => ({ ...current, secDtiCdaNumber: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    placeholder="DTI-2026-483921"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowValidationModal(false)}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleValidateBusiness}
                disabled={submittingValidation}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {submittingValidation ? 'Validating...' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default PayTaxesBT;
