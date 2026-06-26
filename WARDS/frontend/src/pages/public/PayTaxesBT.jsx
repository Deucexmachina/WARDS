import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PaymentGatewayExperience from '../../components/PaymentGatewayExperience';
import { paymentAPI, taxpayerAccountAPI } from '../../services/api';
import { getStoredPublicUser } from '../../utils/publicSession';
import { formatTin } from '../../utils/validation';
import { appendLanguageParam, usePublicLanguage } from '../../utils/publicLanguage';
import { safeOpen } from '../../utils/urlValidator';

import { API_HOST } from '../../services/api';
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
  return `${API_HOST}${path.startsWith('/') ? path : `/${path}`}`;
};

const getApplicationStatusLabel = (status, language) => {
  const normalized = (status || '').toUpperCase().replace(/\s+/g, '_');
  const statusMap = {
    ALL: language === 'en' ? 'All' : 'Lahat',
    VALIDATED: language === 'en' ? 'Validated' : 'Na-validate',
    DOCUMENTS_UPLOADED: language === 'en' ? 'Documents Uploaded' : 'Na-upload ang mga dokumento',
    PAYMENT_INITIATED: language === 'en' ? 'Payment Initiated' : 'Sinimulan ang bayad',
    PENDING_TREASURY_VALIDATION: language === 'en' ? 'Pending Treasury Validation' : 'Naghihintay ng beripikasyon ng treasury',
    RETURNED_FOR_CORRECTION: language === 'en' ? 'Returned For Correction' : 'Ibinalik para itama',
    OR_GENERATED: language === 'en' ? 'Official Receipt Generated' : 'Nabuo ang Official Receipt',
    PAYMENT_SUBMITTED: language === 'en' ? 'Payment Submitted' : 'Naipasa ang bayad',
    PAYMENT_VERIFIED: language === 'en' ? 'Payment Verified' : 'Na-verify ang bayad',
    COMPLETED: language === 'en' ? 'Completed' : 'Nakumpleto',
  };

  return statusMap[normalized] || normalized.replace(/_/g, ' ');
};

const getLocalizedBTMessage = (message, language) => {
  const pairs = [
    {
      en: 'Business registry record validated successfully. You can now continue with the Business Tax assessment workflow.',
      tl: 'Ang iyong Business Registry Record ay matagumpay na na-validate. Maaari ka nang magpatuloy sa Business Tax Assessment process.',
    },
  ];

  for (const pair of pairs) {
    if (message === pair.en) return language === 'en' ? pair.en : pair.tl;
    if (message === pair.tl) return language === 'en' ? pair.en : pair.tl;
  }

  return message;
};

const Dropdown = ({ value, onChange, options, placeholder }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);

  const selectedLabel = options.find((o) => String(o.value) === String(value))?.label || '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 text-sm text-left transition outline-none
          bg-white border-slate-300 text-slate-800 hover:border-[#123f8f] focus:border-[#123f8f] focus:ring-2 focus:ring-[#123f8f]/30
          ${open ? 'border-[#123f8f] ring-2 ring-[#123f8f]/30' : ''}`}
      >
        <span className={selectedLabel ? 'text-slate-800' : 'text-slate-400'}>
          {selectedLabel || placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">{placeholder}</div>
            ) : (
              options.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => { onChange(option.value); setOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[#123f8f]/10 hover:text-[#123f8f] transition
                    ${String(option.value) === String(value) ? 'bg-[#123f8f]/10 text-[#123f8f] font-semibold' : 'text-slate-700'}`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
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

  const text = {
    headerTitle: language === 'en' ? '2026 Business Tax Payment' : '2026 Bayad sa Business Tax',
    backToGateway: language === 'en' ? 'Back To Business Tax Gateway' : 'Bumalik sa Business Tax Gateway',
    backToList: language === 'en' ? 'Back To Application List' : 'Bumalik sa Listahan ng Application',
    submitDeclaration: language === 'en' ? 'Submit Online Sales Declaration' : 'Isumite ang Online Sales Declaration',
    verifiedAssessments: language === 'en' ? 'Verified BT Assessments On Your Account' : 'Mga Na-verify na BT Assessment sa Iyong Account',
    verifiedAssessmentsDesc: language === 'en'
      ? 'These business identifiers were prepared by Main Admin. Click one to prefill the validation modal fields.'
      : 'Ang mga business identifier na ito ay inihanda ng Main Admin. I-click ang isa upang awtomatikong mapunan ang mga field ng validation modal.',
    applicationStatus: 'Application Status',
    searchBy: language === 'en' ? 'Search By' : 'Hanapin Ayon Sa',
    searchLabel: language === 'en' ? 'Search' : 'Hanapin',
    trackingLabel: language === 'en' ? 'Tracking/MP No.' : 'Tracking/MP No.',
    businessName: language === 'en' ? 'Business Name' : 'Pangalan ng Negosyo',
    ownerName: language === 'en' ? 'Owner Name' : 'Pangalan ng May-ari',
    dashboardViewLabel: language === 'en' ? 'Business Tax Assessment Dashboard' : 'Dashboard ng Business Tax Assessment',
    dashboardTitle: isDashboardView
      ? (language === 'en' ? 'Business Tax Assessment Dashboard' : 'Dashboard ng Business Tax Assessment')
      : (language === 'en' ? '2026 Business Tax Payment' : '2026 Bayad sa Business Tax'),
    dashboardDescription: isDashboardView
      ? (language === 'en'
        ? "Review your business information, upload the required documents, and proceed with your payment through the City Treasurer's Office online payment process."
        : "Suriin ang impormasyon ng iyong negosyo, i-upload ang mga kinakailangang dokumento, at magpatuloy sa pagbabayad gamit ang online payment process ng City Treasurer's Office.")
      : (language === 'en'
        ? 'Search your Business Tax applications, validate a Mayor\'s Permit Number with its SEC/DTI/CDA Number, and continue to the separate assessment dashboard when ready.'
        : 'Hanapin ang iyong Business Tax applications, i-validate ang Mayor\'s Permit Number kasama ang SEC/DTI/CDA Number, at magpatuloy sa hiwalay na assessment dashboard kapag handa na.'),
    headerTag: language === 'en' ? '2026 Business Tax Payment' : '2026 Bayad sa Business Tax',
    searchStatus: language === 'en' ? 'Application Status' : 'Application Status',
    searchField: language === 'en' ? 'Search By' : 'Hanapin Ayon Sa',
    searchInput: language === 'en' ? 'Search your submitted Business Tax applications' : 'Hanapin ang iyong naisumiteng Business Tax applications',
    searchButton: language === 'en' ? 'Search' : 'Hanapin',
    statusAll: language === 'en' ? 'All' : 'Lahat',
    statusValidated: language === 'en' ? 'Validated' : 'Na-validate',
    statusDocumentsUploaded: language === 'en' ? 'Documents Uploaded' : 'Na-upload ang mga dokumento',
    statusPaymentInitiated: language === 'en' ? 'Payment Initiated' : 'Sinimulan ang bayad',
    statusPendingTreasuryValidation: language === 'en' ? 'Pending Treasury Validation' : 'Naghihintay ng beripikasyon ng treasury',
    statusReturnedForCorrection: language === 'en' ? 'Returned For Correction' : 'Ibinalik para itama',
    statusOfficialReceiptGenerated: language === 'en' ? 'Official Receipt Generated' : 'Nabuo ang Official Receipt',
    statusPaymentSubmitted: language === 'en' ? 'Payment Submitted' : 'Naipasa ang bayad',
    statusPaymentVerified: language === 'en' ? 'Payment Verified' : 'Na-verify ang bayad',
    statusCompleted: language === 'en' ? 'Completed' : 'Nakumpleto',
    tableTracking: language === 'en' ? "Tracking/Mayor's Permit Number" : "Tracking/Numero ng Mayor's Permit",
    tableBusinessName: language === 'en' ? 'Business Name' : 'Pangalan ng Negosyo',
    tableBusinessOwner: language === 'en' ? 'Business Owner' : 'May-ari ng Negosyo',
    tableApplicationStatus: 'Application Status',
    tableApplicationDate: language === 'en' ? 'Application Date' : 'Petsa ng Application',
    tableAction: language === 'en' ? 'Action' : 'Aksyon',
    emptyState: language === 'en' ? 'No Business Tax applications found for your account.' : 'Walang nahanap na Business Tax applications para sa iyong account.',
    openDashboard: language === 'en' ? 'Open Dashboard' : 'Buksan ang Dashboard',
    currentStatus: language === 'en' ? 'Current Status' : 'Kasalukuyang Katayuan',
    dashboardTracking: language === 'en' ? 'Tracking No.' : 'Tracking No.',
    requiredDocumentsTitle: language === 'en' ? 'Required Document Uploads' : 'Mga Kailangan na Dokumento',
    requiredDocumentsBody: language === 'en' ? 'Upload the Financial Statements, Sales Declaration, Proof of Payment, and supporting documents for this Business Tax transaction.' : 'I-upload ang Financial Statements, Sales Declaration, Proof of Payment, at mga sumusuportang dokumento para sa Business Tax transaction na ito.',
    salesDeclarationFile: language === 'en' ? 'Sales Declaration File' : 'File ng Sales Declaration',
    financialStatements: language === 'en' ? 'Financial Statements' : 'Financial Statements',
    supportingDocuments: language === 'en' ? 'Supporting Documents' : 'Mga Sumusuportang Dokumento',
    viewCurrentFile: language === 'en' ? 'View current file:' : 'Tingnan ang kasalukuyang file:',
    documentRequiredNote: language === 'en' ? 'This capstone build computes the amount due from the simulated Business Registry record associated with your Mayor\'s Permit Number.' : 'Ang capstone build na ito ay nagkakuwenta ng halagang dapat bayaran mula sa simulated Business Registry record na kaugnay ng iyong Mayor\'s Permit Number.',
    uploadDocumentsButton: language === 'en' ? 'Upload Business Tax Documents' : 'I-upload ang mga Dokumento ng Business Tax',
    uploadingDocuments: language === 'en' ? 'Uploading Documents...' : 'Ina-upload ang mga Dokumento...',
    taxComputation: language === 'en' ? 'Tax Computation' : 'Kuwentahan ng Buwis',
    businessTaxDue: language === 'en' ? 'Business Tax Due' : 'Halagang Dapat Bayaran sa Business Tax',
    branchLabel: language === 'en' ? 'Branch:' : 'Sangay:',
    paymentTreasuryVerification: language === 'en' ? 'Payment And Treasury Verification' : 'Pagbabayad at Beripikasyon ng Treasury',
    paymentTreasuryBody: language === 'en'
      ? 'WARDS validates the selected payment details first. PayMongo is used as the final hosted gateway for transaction processing and success or failed status validation.'
      : 'Bineberipika muna ng WARDS ang napiling detalye ng bayad. Ginagamit ang PayMongo bilang huling hosted gateway para sa pagproseso ng transaksyon at beripikasyon ng successful o failed na status.',
    receiptOutcome: language === 'en' ? 'Receipt And Branch Outcome' : 'Resibo at Resulta ng Sangay',
    proofPaymentCompleted: language === 'en' ? 'Proof of payment upload is completed through the payment status page after PayMongo gateway processing.' : 'Nakukumpleto ang pag-upload ng proof of payment sa pamamagitan ng payment status page pagkatapos ng pagproseso sa PayMongo gateway.',
    branchTreasuryVerify: language === 'en' ? 'Branch treasury personnel can verify, approve, reject, or return your submission for correction inside the Branch Admin portal.' : 'Maaaring i-verify, aprubahan, tanggihan, o ibalik ng branch treasury personnel ang iyong isinumite para sa pagwawasto sa loob ng Branch Admin portal.',
    onceVerified: language === 'en' ? 'Once verified, your Business Tax Official Receipt will appear here.' : 'Kapag na-verify na, lilitaw dito ang iyong Business Tax Official Receipt.',
    downloadUploadedProof: language === 'en' ? 'Download uploaded proof of payment:' : 'I-download ang na-upload na proof of payment:',
    officialReceiptReady: language === 'en' ? 'Official Receipt Ready' : 'Handa na ang Official Receipt',
    downloadBusinessTaxOR: language === 'en' ? 'Download Business Tax OR' : 'I-download ang Business Tax OR',
    branchRemarks: language === 'en' ? 'Branch Remarks:' : 'Mga Komento ng Sangay:',
    validateRecord: language === 'en' ? 'Validate your Business Tax record using the simulated WARDS Business Registry.' : 'I-validate ang iyong Business Tax record gamit ang simulated WARDS Business Registry.',
    validationExplanation: language === 'en'
      ? 'The system checks if the Mayor\'s Permit Number exists, if the SEC/DTI/CDA Number exists, and whether both belong to the same active registered business.'
      : 'Tinitingnan ng system kung umiiral ang Mayor\'s Permit Number, kung umiiral ang SEC/DTI/CDA Number, at kung pareho bang kabilang sa iisang aktibong nakarehistrong negosyo.',
    searchesUsed: language === 'en' ? 'Searches used today:' : 'Mga paghahanap na nagamit ngayon:',
    searchesRemaining: language === 'en' ? 'Searches remaining:' : 'Natitirang paghahanap:',
    mayorPermitLabel: language === 'en' ? "Mayor's Permit Number" : "Numero ng Mayor's Permit",
    secNumberLabel: language === 'en' ? 'SEC/DTI/CDA Number' : 'Numero ng SEC/DTI/CDA',
    backButton: language === 'en' ? 'Back' : 'Bumalik',
    nextButton: language === 'en' ? 'Next' : 'Sunod',
    validating: language === 'en' ? 'Validating...' : 'Bineberipika...',
    dashboardLabel: language === 'en' ? 'Business Tax Assessment Dashboard' : 'Dashboard ng Business Tax Assessment',
    mayorPermitDisplayLabel: language === 'en' ? "Mayor's Permit Number" : "Numero ng Mayor's Permit",
    secNumberDisplayLabel: language === 'en' ? 'SEC/DTI/CDA Number' : 'Numero ng SEC/DTI/CDA',
    businessTaxCheckoutTitle: language === 'en' ? 'Business Tax Checkout' : 'Checkout ng Business Tax',
    loadingApplications: language === 'en' ? 'Failed to load Business Tax applications.' : 'Nabigong i-load ang Business Tax applications.',
    documentsUploadedSuccess: language === 'en' ? 'Business Tax documents uploaded successfully.' : 'Matagumpay na na-upload ang mga dokumento ng Business Tax.',
    documentsUploadFailed: language === 'en' ? 'Failed to upload Business Tax documents.' : 'Nabigong i-upload ang mga dokumento ng Business Tax.',
    validationSuccess: language === 'en'
      ? 'Business registry record validated successfully. You can now continue with the Business Tax assessment workflow.'
      : 'Ang iyong Business Registry Record ay matagumpay na na-validate. Maaari ka nang magpatuloy sa Business Tax Assessment process.',
    paymentReferenceGenerated: (refNumber) => (language === 'en'
      ? `Payment reference ${refNumber} generated. Continue to PayMongo gateway when ready.`
      : `Nabuo ang payment reference ${refNumber}. Magpatuloy sa PayMongo gateway kapag handa na.`),
    paymentReferenceFailed: language === 'en' ? 'Failed to generate Business Tax payment reference.' : 'Nabigong bumuo ng Business Tax payment reference.',
    generateReferenceFirst: language === 'en' ? 'Generate a Business Tax payment reference first.' : 'Bumuo muna ng Business Tax payment reference.',
    openCheckoutFailed: language === 'en' ? 'Failed to open PayMongo checkout for Business Tax.' : 'Nabigong buksan ang PayMongo checkout para sa Business Tax.',
  };

  const localizedStatusOptions = [
    { value: 'ALL', label: text.statusAll },
    { value: 'VALIDATED', label: text.statusValidated },
    { value: 'DOCUMENTS_UPLOADED', label: text.statusDocumentsUploaded },
    { value: 'PAYMENT_INITIATED', label: text.statusPaymentInitiated },
    { value: 'PENDING_TREASURY_VALIDATION', label: text.statusPendingTreasuryValidation },
    { value: 'RETURNED_FOR_CORRECTION', label: text.statusReturnedForCorrection },
    { value: 'OR_GENERATED', label: text.statusOfficialReceiptGenerated },
    { value: 'PAYMENT_SUBMITTED', label: text.statusPaymentSubmitted },
    { value: 'PAYMENT_VERIFIED', label: text.statusPaymentVerified },
    { value: 'COMPLETED', label: text.statusCompleted },
  ];

  const localizedSearchOptions = [
    { value: 'tracking_mp_no', label: text.trackingLabel },
    { value: 'mayors_permit_number', label: text.mayorPermitLabel },
    { value: 'business_name', label: text.businessName },
    { value: 'owner_name', label: text.ownerName },
  ];

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
      setError(fetchError.response?.data?.detail || text.loadingApplications);
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
      setMessage(text.validationSuccess);
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
      setMessage(text.documentsUploadedSuccess);
      await fetchApplications({ selectedTracking: selectedApplication.tracking_number });
    } catch (uploadError) {
      setError(uploadError.response?.data?.detail || text.documentsUploadFailed);
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
      const refNumber = response.data?.refNumber || '';
      const accessToken = response.data?.publicAccessToken || '';
      if (refNumber && accessToken && typeof window !== 'undefined') {
        window.sessionStorage.setItem(`wards_payment_token_${refNumber}`, accessToken);
      }
      setMessage(text.paymentReferenceGenerated(response.data?.refNumber));
      await fetchApplications({ selectedTracking: selectedApplication.tracking_number });
    } catch (referenceError) {
      const detail = referenceError.response?.data?.detail;
      setError(typeof detail === 'object' ? detail?.message || text.paymentReferenceFailed : detail || text.paymentReferenceFailed);
    } finally {
      setGeneratingReference(false);
    }
  };

  const handleProceedToPayment = async () => {
    if (!selectedApplication?.payment_ref_number) {
      setError(text.generateReferenceFirst);
      return;
    }

    setProcessingPayment(true);
    setError('');
    try {
      const storedToken = typeof window !== 'undefined' ? window.sessionStorage.getItem(`wards_payment_token_${selectedApplication.payment_ref_number}`) : '';
      const response = await paymentAPI.processPayment({
        refNumber: selectedApplication.payment_ref_number,
        paymentMethod,
        bankCode: paymentMethod === 'banking' ? selectedBank : undefined,
        token: storedToken,
      });

      if (response.data?.checkoutUrl) {
        const safeCheckoutUrl = safeOpen(response.data.checkoutUrl, 'wardsBusinessTaxCheckout', 'noopener,noreferrer');
        if (!safeCheckoutUrl) {
          console.error('Blocked unsafe checkout URL:', response.data.checkoutUrl);
          setError(text.openCheckoutFailed);
          return;
        }
        const tokenParam = storedToken ? `&token=${encodeURIComponent(storedToken)}` : '';
        navigate(appendLanguageParam(`/payment/status?ref=${encodeURIComponent(selectedApplication.payment_ref_number)}${tokenParam}`, language));
      }
    } catch (paymentError) {
      setError(paymentError.response?.data?.detail || text.openCheckoutFailed);
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
          <div className="relative border-b border-slate-200 bg-[#203e63] px-8 py-10 text-white sm:px-10">
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-blue-100">{text.headerTag}</p>
              <div className="mt-5 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-3xl">
                  <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-[2.4rem]">
                  {text.dashboardTitle}
                  </h1>
                  <p className="mt-3 text-sm leading-7 text-blue-100/95 sm:text-[15px]">
                    {text.dashboardDescription}
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
                    {text.submitDeclaration}
                  </button>
                  {isDashboardView ? (
                    <button
                      type="button"
                      onClick={handleBackToList}
                      className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white/18"
                    >
                      {text.backToList}
                    </button>
                  ) : null}
                  {!isDashboardView ? (
                    <button
                      type="button"
                      onClick={() => navigate('/pay-taxes/bt')}
                      className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white/18"
                    >
                      {text.backToGateway}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-10">
            {message ? (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">{getLocalizedBTMessage(message, language)}</div>
            ) : null}
            {error ? (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
            ) : null}

            {!isDashboardView ? (
              <>
                {linkedAssessments.length ? (
                  <div className="mb-6 rounded-[28px] border border-[#203e63] bg-[#203e63] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white">{text.verifiedAssessments}</p>
                        <p className="mt-2 text-sm text-blue-100">{text.verifiedAssessmentsDesc}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#203e63]">{linkedAssessments.length} linked record{linkedAssessments.length === 1 ? '' : 's'}</span>
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
                              <p className="mt-1 text-xs text-slate-500">{language === 'en' ? "Mayor's Permit:" : 'Mayor\'s Permit:'} {assessment.mayor_permit_number}</p>
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
                    <label className="mb-2 block text-sm font-semibold text-slate-700">{text.searchStatus}</label>
                    <Dropdown
                      value={statusFilter}
                      onChange={(value) => setStatusFilter(value)}
                      options={localizedStatusOptions}
                      placeholder={text.searchStatus}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">{text.searchField}</label>
                    <Dropdown
                      value={searchField}
                      onChange={(value) => setSearchField(value)}
                      options={localizedSearchOptions}
                      placeholder={text.searchField}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">{text.searchLabel}</label>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder={text.searchInput}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleSearch}
                      className="w-full rounded-2xl bg-[#203e63] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#13315c]"
                    >
                      {text.searchButton}
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-[28px] border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full table-auto text-sm">
                    <thead className="bg-[#203e63] text-white">
                      <tr>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableTracking}</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableBusinessName}</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableBusinessOwner}</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableApplicationStatus}</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableApplicationDate}</th>
                        <th className="px-5 py-4 text-left font-semibold uppercase tracking-[0.12em]">{text.tableAction}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {!loading && !applications.length ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-12 text-center text-slate-500">{text.emptyState}</td>
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
                              {getApplicationStatusLabel(application.application_status || 'VALIDATED', language)}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top text-slate-700">{new Date(application.created_at).toLocaleDateString('en-PH')}</td>
                          <td className="px-5 py-4 align-top">
                            <button
                              type="button"
                              onClick={() => handleOpenDashboard(application)}
                              className="rounded-full bg-[#0f2f5f] px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-white transition hover:bg-[#123f8f]"
                            >
                              {text.openDashboard}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </>
            ) : null}

            {isDashboardView && selectedApplication ? (
              <div className={`mt-8 grid gap-7 ${shouldShowPaymentPanels ? '' : 'max-w-[860px] mx-auto'}`}>
                <div className="space-y-6">
                  <div className="rounded-[30px] border border-[#d9e7f9] bg-white p-7 shadow-[0_12px_28px_rgba(15,52,108,0.05)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{text.dashboardViewLabel}</p>
                        <h2 className="mt-2 text-[2rem] font-bold tracking-[-0.02em] text-[#0f2f5f]">{selectedApplication.business_name}</h2>
                        <p className="mt-2 text-sm text-slate-600">{text.dashboardTracking} {selectedApplication.tracking_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{text.currentStatus}</p>
                        <p className="mt-2 text-base font-bold text-[#123f8f]">{getApplicationStatusLabel(selectedApplicationStatus, language)}</p>
                      </div>
                    </div>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{text.mayorPermitDisplayLabel}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.mayor_permit_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{text.secNumberDisplayLabel}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.sec_dti_cda_number}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{language === 'en' ? 'Branch Assigned' : 'Nakatalagang Sangay'}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.branch_name}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{language === 'en' ? 'Business Type' : 'Uri ng Negosyo'}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.business_type}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{language === 'en' ? 'Registered Owner' : 'Nakatala na May-ari'}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.owner_name}</p>
                      </div>
                      <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{language === 'en' ? 'Taxpayer TIN' : 'TIN ng Nagbabayad'}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedApplication.tin || formatTin(publicUser?.tin || '') || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  {shouldShowUploadPanel ? (
                    <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-[1.15rem] font-bold text-slate-900">{text.requiredDocumentsTitle}</h3>
                          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">{text.requiredDocumentsBody}</p>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">{text.salesDeclarationFile}</label>
                          <div className="flex items-center gap-3 rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-3 shadow-sm">
                            <label className="shrink-0 cursor-pointer rounded-2xl bg-[#203e63] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a3352]">
                              Choose File
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(event) => setDocumentFiles((current) => ({ ...current, salesDeclaration: event.target.files?.[0] || null }))}
                                className="hidden"
                              />
                            </label>
                            <span className="truncate text-sm text-slate-600">
                              {documentFiles.salesDeclaration ? documentFiles.salesDeclaration.name : 'No file chosen'}
                            </span>
                          </div>
                          {selectedApplication.sales_declaration_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.sales_declaration_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              {text.viewCurrentFile} {selectedApplication.sales_declaration_name}
                            </a>
                          ) : null}
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">{text.financialStatements}</label>
                          <div className="flex items-center gap-3 rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-3 shadow-sm">
                            <label className="shrink-0 cursor-pointer rounded-2xl bg-[#203e63] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a3352]">
                              Choose File
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(event) => setDocumentFiles((current) => ({ ...current, financialStatements: event.target.files?.[0] || null }))}
                                className="hidden"
                              />
                            </label>
                            <span className="truncate text-sm text-slate-600">
                              {documentFiles.financialStatements ? documentFiles.financialStatements.name : 'No file chosen'}
                            </span>
                          </div>
                          {selectedApplication.financial_statements_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.financial_statements_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              {text.viewCurrentFile} {selectedApplication.financial_statements_name}
                            </a>
                          ) : null}
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">{text.supportingDocuments}</label>
                          <div className="flex items-center gap-3 rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-3 shadow-sm">
                            <label className="shrink-0 cursor-pointer rounded-2xl bg-[#203e63] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a3352]">
                              Choose File
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(event) => setDocumentFiles((current) => ({ ...current, supportingDocuments: event.target.files?.[0] || null }))}
                                className="hidden"
                              />
                            </label>
                            <span className="truncate text-sm text-slate-600">
                              {documentFiles.supportingDocuments ? documentFiles.supportingDocuments.name : 'No file chosen'}
                            </span>
                          </div>
                          {selectedApplication.supporting_documents_name ? (
                            <a href={buildApiAssetUrl(selectedApplication.supporting_documents_download_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#123f8f] underline underline-offset-4">
                              {text.viewCurrentFile} {selectedApplication.supporting_documents_name}
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
                        {uploadingDocs ? text.uploadingDocuments : text.uploadDocumentsButton}
                      </button>
                    </div>
                  ) : null}
                </div>

                {shouldShowPaymentPanels ? (
                  <div className="space-y-6">
                      <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
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
                            readOnlyCustomer
                            referenceNumber={selectedApplication.payment_ref_number}
                            title={text.businessTaxCheckoutTitle}
                            language={language}
                          />
                        </div>
                      </div>

                      {shouldShowReceiptOutcome ? (
                        <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                        <h3 className="text-[1.15rem] font-bold text-slate-900">{text.receiptOutcome}</h3>
                        <div className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
                          <p>{text.proofPaymentCompleted}</p>
                          <p>{text.branchTreasuryVerify}</p>
                          <p>{text.onceVerified}</p>
                        </div>

                        {selectedApplication.proof_of_payment_name ? (
                          <a href={buildApiAssetUrl(selectedApplication.proof_of_payment_download_url)} target="_blank" rel="noreferrer" className="mt-5 inline-block text-sm font-semibold text-[#123f8f] underline underline-offset-4">
                            {text.downloadUploadedProof} {selectedApplication.proof_of_payment_name}
                          </a>
                        ) : null}
                        {selectedApplication.official_receipt_number ? (
                          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                            <p className="font-semibold text-emerald-900">{text.officialReceiptReady}</p>
                            <p className="mt-1 text-sm text-emerald-800">{selectedApplication.official_receipt_number}</p>
                            <a href={buildApiAssetUrl(selectedApplication.official_receipt_download_url)} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] text-white">
                              {text.downloadBusinessTaxOR}
                            </a>
                          </div>
                        ) : null}
                        {selectedApplication.verifier_remarks ? (
                          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                            <span className="font-semibold">{text.branchRemarks}</span> {selectedApplication.verifier_remarks}
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
            <h2 className="text-center text-3xl font-bold text-slate-900">{text.headerTag}</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-[220px,minmax(0,1fr)] md:items-start">
              <div className="space-y-4 text-sm leading-7 text-slate-600">
                <p>{text.validateRecord}</p>
                <p>{text.validationExplanation}</p>
                {validationSearchStats ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    {text.searchesUsed} {validationSearchStats.searchesUsed} / {validationSearchStats.searchLimit}
                    <br />
                    {text.searchesRemaining} {validationSearchStats.searchesRemaining}
                  </div>
                ) : null}
              </div>
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">{text.mayorPermitLabel}</label>
                  <input
                    type="text"
                    value={validationForm.mayorPermitNumber}
                    onChange={(event) => setValidationForm((current) => ({ ...current, mayorPermitNumber: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#123f8f] focus:outline-none"
                    placeholder="BP-2026-000145"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">{text.secNumberLabel}</label>
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
                {text.backButton}
              </button>
              <button
                type="button"
                onClick={handleValidateBusiness}
                disabled={submittingValidation}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {submittingValidation ? `${text.validating}` : text.nextButton}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default PayTaxesBT;
