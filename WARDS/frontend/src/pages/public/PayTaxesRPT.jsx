import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReCAPTCHA from 'react-google-recaptcha';
import PaymentGatewayExperience from '../../components/PaymentGatewayExperience';
import { paymentAPI, taxpayerAccountAPI } from '../../services/api';
import { getStoredPublicUser } from '../../utils/publicSession';
import { getEmailValidationMessage } from '../../utils/validation';
import { appendLanguageParam, usePublicLanguage } from '../../utils/publicLanguage';
import { openCheckoutPopupShell } from '../../utils/checkoutPopup';
import { safeReplace, safeNavigate } from '../../utils/urlValidator';

const API_BASE_URL = 'http://localhost:8000/api';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';
const RPT_SEARCH_GUARD_STORAGE_KEY = 'wards-rpt-search-guard';
const RPT_FAILED_SEARCH_THRESHOLD = 3;
const RPT_LOCKOUT_DURATION_MS = 120 * 1000;
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const PH_MOBILE_PATTERN = /^(?:\+63|63|0)9\d{9}$/;
const RPT_FINAL_CLEAR_STATUSES = new Set(['PAYMENT_VERIFIED', 'OR_GENERATED', 'COMPLETED']);
const CITIZEN_RPT_REFRESH_INTERVAL_MS = 30000;

const normalizeIdentityName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const formatCurrency = (amount) =>
  `PHP ${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercentage = (value) => `${(Number(value || 0) * 100).toFixed(0)}%`;

const getStoredSearchLockoutUntil = () => {
  const storedValue = Number(sessionStorage.getItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:lockout`) || 0);
  if (!storedValue) return 0;

  const now = Date.now();
  return storedValue > now + RPT_LOCKOUT_DURATION_MS ? now + RPT_LOCKOUT_DURATION_MS : storedValue;
};

const emptyPropertySearch = {
  tdn: '',
  taxpayer_name: '',
  property_address: '',
  fair_market_value: 0,
  assessment_level: 0,
  assessed_value: 0,
  basic_tax_due: 0,
  sef_tax: 0,
  penalties: 0,
  discounts: 0,
  final_total_amount_due: 0,
};

const RPT_COPY = {
  en: {
    pageEyebrow: 'QC Treasury Online Services',
    pageTitle: 'Real Property Tax Search',
    pageDescription: 'WARDS serves as a treasury-assisted online payment and validation workflow.',
    guideButton: 'Click here for a step-by-step guide',
    backToServiceChooser: 'Back to Choose Your Tax Service',
    goToSummary: 'Go to my Transaction Summary',
    cartButton: 'My Cart',
    loading: 'Loading RPT online payment workflow...',
    pendingTitle: 'Pending RPT Transaction',
    pendingDescription: 'You already have an RPT online payment awaiting branch treasury action.',
    pendingButton: 'View Pending Transaction',
    searchCardTitle: 'Search Property',
    selectedBranch: 'Selected Branch',
    selectBranch: 'Select Branch',
    dailyAllocationTitle: 'Daily Search Allocation',
    dailyAllocationBody: (remaining, limit) => `You have ${remaining} of ${limit} searches remaining for today.`,
    verifiedAssessmentsTitle: 'Verified RPT Assessments On Your Account',
    verifiedAssessmentsBody: 'Click a TDN below to auto-fill the search field with an admin-generated assessment record.',
    linkedRecords: (count) => `${count} linked record${count === 1 ? '' : 's'}`,
    tdnLabel: 'Enter Tax Declaration Number',
    tdnPlaceholder: '[ A-XXX-XXXXX ]',
    searching: 'Searching...',
    search: 'Search',
    recaptchaPrompt: 'Complete the reCAPTCHA challenge to continue searching.',
    recaptchaBlockedPrompt: 'Search attempts are temporarily paused because the reCAPTCHA challenge is required again.',
    searchLockout: (seconds) => `Too many failed search attempts. Please try again in ${seconds} seconds.`,
    branchRequired: 'Please select a branch before searching for a property.',
    tdnRequired: 'Please enter a Tax Declaration Number before searching.',
    searchFailed: 'Failed to search property record.',
    reviewTdnMismatch: 'Please review the Tax Declaration Number and search again if the owner details do not match.',
    goBackToSearch: 'Go Back to Search',
    selectedTdnCount: 'Selected TDN:',
    paymentOptionPrompt: 'Go to Payment Option',
    editSelected: 'Edit Selected TDN',
    proceed: 'Proceed',
    instructions: 'Instructions',
    guideTitle: 'Online Payment of Real Property Tax',
    closeGuide: 'Close guide',
    previousGuide: 'Previous guide slide',
    nextGuide: 'Next guide slide',
    stepLabel: 'Step',
    guideSlides: [
      {
        title: 'Step 1: Select Branch',
        steps: [
          'Choose the branch where the property is recorded.',
          'Make sure the selected branch matches the property record.',
          'Continue only after the correct branch is selected.',
        ],
      },
      {
        title: 'Step 2: Enter Tax Declaration Number',
        steps: [
          'Type the Tax Declaration Number exactly as shown on the record.',
          'Use uppercase letters and hyphens when needed.',
          'Review the entry before searching.',
        ],
      },
      {
        title: 'Step 3: Search Property Record',
        steps: [
          'Click Search to look up the property record.',
          'Complete the reCAPTCHA challenge again if prompted by the system.',
          'If the record is not found, review the branch and TDN before trying again.',
        ],
      },
      {
        title: 'Step 4: Review Property Details',
        steps: [
          'Check the owner name, location, and property details carefully.',
          'Confirm that the returned record matches the correct property.',
          'If it does not match, go back and search again with the correct information.',
        ],
      },
      {
        title: 'Step 5: Proceed to Payment',
        steps: [
          'Select the TDN you want to pay.',
          'Choose a payment option that fits the property schedule.',
          'Continue to the transaction summary when you are ready.',
        ],
      },
      {
        title: 'Step 6: Payment Validation',
        steps: [
          'Review the amount before generating the payment reference.',
          'Complete the payment details and proceed through PayMongo.',
          'Follow the prompts carefully until the payment is validated.',
        ],
      },
      {
        title: 'Step 7: Receipt / Confirmation',
        steps: [
          'Wait for the payment confirmation and receipt status updates.',
          'Use the payment status page if you need to check progress.',
          'Keep the reference number for future confirmation or support.',
        ],
      },
    ],
    topHome: 'Back to Choose Your Tax Service',
    languageButton: 'Tagalog',
  },
  tl: {
    pageEyebrow: 'QC Treasury Online Services',
    pageTitle: 'Paghahanap ng Real Property Tax',
    pageDescription: 'Ang WARDS ay isang online payment at validation workflow na pinangangasiwaan ng treasury.',
    guideButton: 'Mag-click para sa step-by-step guide',
    backToServiceChooser: 'Bumalik at Piliin ang Iyong Serbisyong Buwis',
    goToSummary: 'Pumunta sa Aking Transaction Summary',
    cartButton: 'Aking Cart',
    loading: 'Naglo-load ng RPT online payment workflow...',
    pendingTitle: 'Naka-Pending na RPT Transaction',
    pendingDescription: 'Mayroon ka nang RPT online payment na naghihintay ng aksyon ng branch treasury.',
    pendingButton: 'Tingnan ang Pending na Transaksyon',
    searchCardTitle: 'Maghanap ng Property',
    selectedBranch: 'Napiling Sangay ng Opisina',
    selectBranch: 'Pumili ng Sangay ng Opisina',
    dailyAllocationTitle: 'Daily Search Allocation',
    dailyAllocationBody: (remaining, limit) => `May ${remaining} sa ${limit} search na natitira para sa araw na ito.`,
    verifiedAssessmentsTitle: 'Na-verify na RPT Assessments sa Iyong Account',
    verifiedAssessmentsBody: 'I-click ang isang TDN sa ibaba upang awtomatikong punan ang search field gamit ang record na ginawa ng admin.',
    linkedRecords: (count) => `${count} naka-link na record${count === 1 ? '' : 's'}`,
    tdnLabel: 'Ilagay ang Tax Declaration Number',
    tdnPlaceholder: '[ A-XXX-XXXXX ]',
    searching: 'Naghahanap...',
    search: 'Hanapin',
    recaptchaPrompt: 'Kumpletuhin ang reCAPTCHA upang makapagpatuloy sa paghahanap.',
    recaptchaBlockedPrompt: 'Pansamantalang naka-pause ang paghahanap dahil kailangan ulit ang reCAPTCHA.',
    searchLockout: (seconds) => `Masyadong maraming failed search attempts. Pakisubukan muli pagkatapos ng ${seconds} segundo.`,
    branchRequired: 'Mangyaring pumili ng sangay ng opisina bago maghanap ng property.',
    tdnRequired: 'Mangyaring ilagay ang Tax Declaration Number bago maghanap.',
    searchFailed: 'Hindi mahanap ang property record.',
    reviewTdnMismatch: 'Pakisuri ang Tax Declaration Number at maghanap muli kung hindi tumutugma ang detalye ng may-ari.',
    goBackToSearch: 'Bumalik sa Search',
    selectedTdnCount: 'Napiling TDN:',
    paymentOptionPrompt: 'Pumunta sa Payment Option',
    editSelected: 'I-edit ang Napiling TDN',
    proceed: 'Magpatuloy',
    instructions: 'Mga Instruksiyon',
    guideTitle: 'Online Payment ng Real Property Tax',
    closeGuide: 'Isara ang guide',
    previousGuide: 'Nakaraang guide slide',
    nextGuide: 'Susunod na guide slide',
    stepLabel: 'Hakbang',
    guideSlides: [
      {
        title: 'Hakbang 1: Pumili ng Sangay',
        steps: [
          'Piliin ang sangay ng opisina kung saan nakarehistro ang property.',
          'Siguraduhing tumutugma ang napiling sangay ng opisina sa record ng property.',
          'Magpatuloy lamang kapag tama na ang napiling sangay ng opisina.',
        ],
      },
      {
        title: 'Hakbang 2: Ilagay ang Tax Declaration Number',
        steps: [
          'I-type ang Tax Declaration Number nang eksakto tulad ng nasa record.',
          'Gumamit ng malalaking titik at gitling kung kailangan.',
          'Suriing mabuti ang inilagay bago maghanap.',
        ],
      },
      {
        title: 'Hakbang 3: Hanapin ang Property Record',
        steps: [
          'I-click ang Search upang hanapin ang property record.',
          'Kumpletuhin muli ang reCAPTCHA  kung hihingin ito ng system.',
          'Kung hindi makita ang record, suriin ang sangay ng opisina at TDN bago subukan muli.',
        ],
      },
      {
        title: 'Hakbang 4: Suriin ang Detalye ng Property',
        steps: [
          'Tingnan nang maigi ang pangalan ng may-ari, lokasyon, at detalye ng property.',
          'Kumpirmahin na tumutugma ang natagpuang record sa tamang property.',
          'Kung hindi tumutugma, bumalik at maghanap muli gamit ang tamang impormasyon.',
        ],
      },
      {
        title: 'Hakbang 5: Magpatuloy sa Payment',
        steps: [
          'Piliin ang TDN na gusto mong bayaran.',
          'Pumili ng payment option na akma sa iskedyul ng property.',
          'Magpatuloy sa transaction summary kapag handa ka na.',
        ],
      },
      {
        title: 'Hakbang 6: Payment Validation',
        steps: [
          'Suriin ang halaga bago gumawa ng payment reference.',
          'Kumpletuhin ang payment details at magpatuloy sa PayMongo.',
          'Sundin nang maigi ang mga kailangan hanggang ma-validate ang payment.',
        ],
      },
      {
        title: 'Hakbang 7: Resibo / Kumpirmasyon',
        steps: [
          'Hintayin ang payment confirmation at mga update sa receipt status.',
          'Gamitin ang payment status page kung kailangan mong i-check ang progreso.',
          'Itago ang reference number para sa susunod na kumpirmasyon o suporta.',
        ],
      },
    ],
    topHome: 'Bumalik sa Piliin ang Iyong Serbisyong Buwis',
    languageButton: 'English',
  },
};

const OutlineCard = ({ title, children, className = '' }) => (
  <div className={`rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_36px_rgba(15,23,42,0.06)] ${className}`}>
    <h3 className="mb-5 text-sm font-bold uppercase tracking-[0.24em] text-[#0f5b83]">{title}</h3>
    {children}
  </div>
);

const DetailStat = ({ label, value, tone = 'default' }) => (
  <div className="flex h-full min-h-[96px] flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3">
    <p className="min-h-[2.5rem] text-[11px] font-semibold uppercase leading-5 tracking-[0.16em] text-slate-400">{label}</p>
    <p className={`mt-auto pt-2 text-sm font-semibold ${tone === 'success' ? 'text-emerald-700' : tone === 'primary' ? 'text-[#0f5b83]' : 'text-slate-900'}`}>{value}</p>
  </div>
);

const getQuarterlyAmount = (property) => {
  const quarterlyBase = (Number(property?.basic_tax_due || 0) + Number(property?.sef_tax || 0)) / 4;
  const total = quarterlyBase + Number(property?.penalties || 0) - Number(property?.discounts || 0);
  return Math.max(total, 0);
};

const buildCartItemFromProperty = (property, branch, paymentOption) => {
  const normalizedOption = paymentOption === 'quarterly' ? 'Quarterly' : 'Full';
  const optionAmount = paymentOption === 'quarterly' ? getQuarterlyAmount(property) : Number(property?.final_total_amount_due || 0);
  const billCoverage = paymentOption === 'quarterly' ? 'Current Quarter' : 'Full Year';

  return {
    ...property,
    branch_name: branch?.name || property?.branch_name || '',
    payment_option: normalizedOption,
    payment_option_value: paymentOption === 'quarterly' ? 'quarterly' : 'full',
    bill_coverage: billCoverage,
    original_total_amount_due: Number(property?.final_total_amount_due || 0),
    final_total_amount_due: optionAmount,
  };
};

const BranchDropdown = ({ value, onChange, disabled, options, placeholder, error }) => {
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 text-sm text-left transition outline-none
          ${disabled ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white border-slate-300 text-slate-800 hover:border-[#0f5b83] focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/30'}
          ${open && !disabled ? 'border-[#0f5b83] ring-2 ring-[#0f5b83]/30' : ''}
          ${error && !disabled ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30' : ''}`}
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

      {open && !disabled && (
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
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[#0f5b83]/10 hover:text-[#0f5b83] transition
                    ${String(option.value) === String(value) ? 'bg-[#0f5b83]/10 text-[#0f5b83] font-semibold' : 'text-slate-700'}`}
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

const PayTaxesRPT = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const transactionSummaryRef = useRef(null);
  const recaptchaRef = useRef(null);
  const publicUser = getStoredPublicUser();
  const [language] = usePublicLanguage();
  const [branches, setBranches] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [tdnInput, setTdnInput] = useState('');
  const [searchingProperty, setSearchingProperty] = useState(false);
  const [searchStats, setSearchStats] = useState({ searchesRemaining: 50, searchLimit: 50, searchesUsed: 0 });
  const [linkedAssessments, setLinkedAssessments] = useState([]);
  const [searchedProperty, setSearchedProperty] = useState(emptyPropertySearch);
  const [cartItems, setCartItems] = useState([]);
  const [formData, setFormData] = useState({
    taxpayerName: publicUser?.full_name || '',
    email: publicUser?.email || '',
    contactNumber: publicUser?.contact_number || '',
  });
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('gcash');
  const [selectedBank, setSelectedBank] = useState('');
  const [generatingReference, setGeneratingReference] = useState(false);
  const [paymentReference, setPaymentReference] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [ownerConfirmationOpen, setOwnerConfirmationOpen] = useState(false);
  const [pendingProperty, setPendingProperty] = useState(null);
  const [addToCartConfirmationOpen, setAddToCartConfirmationOpen] = useState(false);
  const [paymentConfirmationOpen, setPaymentConfirmationOpen] = useState(false);
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState([]);
  const [selectionConfirmationOpen, setSelectionConfirmationOpen] = useState(false);
  const [showPaymentOptionStage, setShowPaymentOptionStage] = useState(false);
  const [paymentOptionModalOpen, setPaymentOptionModalOpen] = useState(false);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState('');
  const [stagedPaymentOption, setStagedPaymentOption] = useState('full');
  const [addToCartSuccessOpen, setAddToCartSuccessOpen] = useState(false);
  const [removeFromCartConfirmationOpen, setRemoveFromCartConfirmationOpen] = useState(false);
  const [pendingRemovalTdn, setPendingRemovalTdn] = useState('');
  const [activePendingPayment, setActivePendingPayment] = useState(null);
  const [failedSearchAttempts, setFailedSearchAttempts] = useState(() => Number(sessionStorage.getItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:failed`) || 0));
  const [requiresRecaptcha, setRequiresRecaptcha] = useState(() => sessionStorage.getItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:requires`) === 'true');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [lockoutUntil, setLockoutUntil] = useState(() => getStoredSearchLockoutUntil());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    sessionStorage.setItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:failed`, String(failedSearchAttempts));
  }, [failedSearchAttempts]);

  useEffect(() => {
    sessionStorage.setItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:requires`, String(requiresRecaptcha));
  }, [requiresRecaptcha]);

  useEffect(() => {
    sessionStorage.setItem(`${RPT_SEARCH_GUARD_STORAGE_KEY}:lockout`, String(lockoutUntil));
  }, [lockoutUntil]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (lockoutUntil && now >= lockoutUntil) {
      setLockoutUntil(0);
      setFailedSearchAttempts(0);
      setRequiresRecaptcha(false);
      setRecaptchaToken('');
      recaptchaRef.current?.reset?.();
    }
  }, [lockoutUntil, now]);

  const text = RPT_COPY[language] || RPT_COPY.en;
  const isSearchLockedOut = lockoutUntil > now;
  const lockoutSecondsRemaining = isSearchLockedOut ? Math.max(1, Math.ceil((lockoutUntil - now) / 1000)) : 0;
  const isSearchCaptchaRequired = requiresRecaptcha || isSearchLockedOut;
  const isBranchSearchError =
    searchError === text.branchRequired ||
    searchError === (language === 'en' ? 'Please select the correct branch.' : 'Mangyaring piliin ang tamang sangay.');

  const resetSearchSecurityState = ({ preserveLockout = false } = {}) => {
    setFailedSearchAttempts(0);
    setRequiresRecaptcha(false);
    setRecaptchaToken('');
    if (!preserveLockout) {
      setLockoutUntil(0);
    }
    recaptchaRef.current?.reset?.();
  };

  const refreshCitizenPaymentState = async ({ preserveWorkflow = true } = {}) => {
    try {
      const [activePaymentResponse, linkedAssessmentResponse] = await Promise.all([
        paymentAPI.getActiveRptPayment(),
        taxpayerAccountAPI.getAssessments({ tax_type: 'RPT' }).catch(() => ({ data: { items: [] } })),
      ]);
      const nextActivePayment = activePaymentResponse.data?.payment || null;
      const previousRefNumber = activePendingPayment?.ref_number || null;
      const nextRefNumber = nextActivePayment?.ref_number || null;

      setLinkedAssessments(linkedAssessmentResponse.data?.items || []);
      setActivePendingPayment(nextActivePayment);

      if (!nextActivePayment && previousRefNumber && preserveWorkflow) {
        clearWorkflowState({ preserveBranch: true });
      }
      if (nextActivePayment?.branch_id) {
        setSelectedBranchId(String(nextActivePayment.branch_id));
      }
      if (!nextRefNumber && searchParams.get('reset') !== '1') {
        resetGeneratedPayment();
      }
    } catch {
      // Keep the current citizen view stable if the refresh fails.
    }
  };

  const handlePaymentCustomerChange = (customer) => {
    setFormData((current) => ({
      ...current,
      taxpayerName: customer.name ?? current.taxpayerName,
      email: customer.email ?? current.email,
      contactNumber: customer.mobile ?? current.contactNumber,
    }));
    resetGeneratedPayment();
  };

  const clearWorkflowState = ({ preserveBranch = false } = {}) => {
    setError('');
    setSearchError('');
    setValidationErrors({});
    if (!preserveBranch) {
      setSelectedBranchId('');
    }
    setTdnInput('');
    setSearchedProperty(emptyPropertySearch);
    setCartItems([]);
    setPendingProperty(null);
    setSelectedPropertyIds([]);
    setSelectedPaymentOption('');
    setStagedPaymentOption('full');
    setPaymentReference(null);
    setOwnerConfirmationOpen(false);
    setAddToCartConfirmationOpen(false);
    setPaymentConfirmationOpen(false);
    setPaymentDetailsOpen(false);
    setSelectionConfirmationOpen(false);
    setShowPaymentOptionStage(false);
    setPaymentOptionModalOpen(false);
    setAddToCartSuccessOpen(false);
    setRemoveFromCartConfirmationOpen(false);
    setPendingRemovalTdn('');
  };

  useEffect(() => {
    const fetchSetup = async () => {
      try {
        const [branchesResponse, statusResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/public/branches`),
          axios.get(`${API_BASE_URL}/public/system-status`),
        ]);
        setBranches(branchesResponse.data);
        setSystemStatus(statusResponse.data);
        await refreshCitizenPaymentState({ preserveWorkflow: false });
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load payment setup.');
      } finally {
        setLoadingPage(false);
      }
    };

    fetchSetup();
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => {
      refreshCitizenPaymentState();
    };

    const intervalId = window.setInterval(() => {
      refreshCitizenPaymentState();
    }, CITIZEN_RPT_REFRESH_INTERVAL_MS);

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [activePendingPayment, searchParams]);

  useEffect(() => {
    if (searchParams.get('reset') === '1') {
      clearWorkflowState();
      setActivePendingPayment(null);
    }
  }, [searchParams]);

  const selectedBranch = useMemo(
    () => branches.find((branch) => String(branch.id) === String(selectedBranchId)) || null,
    [branches, selectedBranchId]
  );
  const isBlockedByPendingPayment = Boolean(activePendingPayment);

  const cartTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + Number(item.final_total_amount_due || 0), 0),
    [cartItems]
  );
  const hasSearchedProperty = Boolean(searchedProperty?.tdn);
  const hasStartedCheckoutFlow = hasSearchedProperty || cartItems.length > 0 || Boolean(paymentReference);
  const hasResolvedSearchState = hasSearchedProperty || cartItems.length > 0 || Boolean(paymentReference);
  const selectedSearchItems = useMemo(
    () => (hasSearchedProperty && selectedPropertyIds.includes(searchedProperty.tdn) ? [searchedProperty] : []),
    [hasSearchedProperty, searchedProperty, selectedPropertyIds]
  );
  const hasPaymentOptionSelection = Boolean(selectedPaymentOption);
  const selectedCartPreviewItem = hasSearchedProperty && hasPaymentOptionSelection
    ? buildCartItemFromProperty(searchedProperty, selectedBranch, selectedPaymentOption)
    : null;

  const isSystemDisabled = Boolean(systemStatus && (!systemStatus.paymentGatewayEnabled || systemStatus.maintenanceMode));

  const resetGeneratedPayment = () => {
    if (paymentReference) {
      setPaymentReference(null);
    }
  };

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    if (validationErrors[name]) {
      setValidationErrors((current) => ({ ...current, [name]: '' }));
    }
    if (error) setError('');
    resetGeneratedPayment();
  };

  const handleSearchProperty = async () => {
    if (activePendingPayment) {
      setSearchError(language === 'en'
        ? 'You already have a pending RPT online payment awaiting treasury action. Please wait for branch verification before starting another payment.'
        : 'Mayroon ka nang nakabinbing RPT online payment na naghihintay ng aksyon ng treasury. Pakihintay munang ma-verify ng branch bago magsimula ng panibagong payment.');
      return;
    }
    if (!selectedBranchId) {
      setSearchError(text.branchRequired);
      return;
    }
    if (!tdnInput.trim()) {
      setSearchError(text.tdnRequired);
      return;
    }
    if (isSearchLockedOut) {
      setSearchError(text.searchLockout(lockoutSecondsRemaining));
      return;
    }
    if (isSearchCaptchaRequired && !recaptchaToken) {
      setSearchError(requiresRecaptcha ? text.recaptchaPrompt : text.recaptchaBlockedPrompt);
      return;
    }

    setSearchingProperty(true);
    setSearchError('');
    setError('');
    setSearchedProperty(emptyPropertySearch);
    setPendingProperty(null);
    setSelectedPropertyIds([]);
    setSelectedPaymentOption('');
    setSelectionConfirmationOpen(false);
    setShowPaymentOptionStage(false);
    setPaymentOptionModalOpen(false);
    resetGeneratedPayment();

    try {
      const response = await paymentAPI.searchRptProperty({
        branch_id: Number(selectedBranchId),
        tdn: tdnInput.trim(),
      });
      setPendingProperty(response.data.property);
      setOwnerConfirmationOpen(true);
      setSearchStats({
        searchesRemaining: response.data.searchesRemaining,
        searchLimit: response.data.searchLimit,
        searchesUsed: response.data.searchesUsed,
      });
      resetSearchSecurityState();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const isBranchMismatchSearch = err.response?.status === 404;
      const nextFailedSearchAttempts = failedSearchAttempts + 1;
      const captchaSatisfied = Boolean(recaptchaToken);
      setFailedSearchAttempts(nextFailedSearchAttempts);
      if (typeof detail === 'object' && detail?.message) {
        setSearchError(isBranchMismatchSearch ? (language === 'en' ? 'Please select the correct branch.' : 'Mangyaring piliin ang tamang sangay.') : detail.message);
        setSearchStats({
          searchesRemaining: detail.searchesRemaining ?? searchStats.searchesRemaining,
          searchLimit: detail.searchLimit ?? searchStats.searchLimit,
          searchesUsed: detail.searchesUsed ?? searchStats.searchesUsed,
        });
      } else {
        setSearchError(isBranchMismatchSearch ? (language === 'en' ? 'Please select the correct branch.' : 'Mangyaring piliin ang tamang sangay.') : detail || text.searchFailed);
      }

      if (nextFailedSearchAttempts >= RPT_FAILED_SEARCH_THRESHOLD) {
        setRequiresRecaptcha(true);
      }

      if (captchaSatisfied && nextFailedSearchAttempts > RPT_FAILED_SEARCH_THRESHOLD) {
        const nextLockoutUntil = Date.now() + RPT_LOCKOUT_DURATION_MS;
        setLockoutUntil(nextLockoutUntil);
        setSearchError(text.searchLockout(Math.ceil(RPT_LOCKOUT_DURATION_MS / 1000)));
        setRecaptchaToken('');
        recaptchaRef.current?.reset?.();
        return;
      }
    } finally {
      setSearchingProperty(false);
    }
  };

  const handleAddToCart = () => {
    if (!searchedProperty?.tdn) {
      return;
    }
    if (!selectedPropertyIds.includes(searchedProperty.tdn)) {
      setSearchError('Please select the TDN you want to pay first.');
      return;
    }
    if (!selectedPaymentOption) {
      setSearchError('Please select a payment option before adding this TDN to the cart.');
      return;
    }
    if (cartItems.some((item) => item.tdn === searchedProperty.tdn)) {
      setSearchError('This TDN is already in your cart.');
      return;
    }
    setAddToCartConfirmationOpen(true);
  };

  const handleRemoveFromCart = (tdn) => {
    setPendingRemovalTdn(tdn);
    setRemoveFromCartConfirmationOpen(true);
  };

  const confirmRemoveFromCart = () => {
    if (!pendingRemovalTdn) {
      setRemoveFromCartConfirmationOpen(false);
      return;
    }
    setCartItems((current) => current.filter((item) => item.tdn !== pendingRemovalTdn));
    setPendingRemovalTdn('');
    setRemoveFromCartConfirmationOpen(false);
    setPaymentDetailsOpen(false);
    resetGeneratedPayment();
  };

  const cancelRemoveFromCart = () => {
    setPendingRemovalTdn('');
    setRemoveFromCartConfirmationOpen(false);
  };

  const validateCheckout = () => {
    const errors = {};
    const storedCitizenName = normalizeIdentityName(publicUser?.full_name);
    const enteredTaxpayerName = normalizeIdentityName(formData.taxpayerName);

    if (!selectedBranchId) errors.branch = language === 'en' ? 'Branch selection is required' : 'Kinakailangan ang pagpili ng sangay';
    if (!cartItems.length) errors.cart = language === 'en' ? 'Add at least one TDN to the cart' : 'Magdagdag ng kahit isang TDN sa cart';
    if (!formData.taxpayerName.trim()) errors.taxpayerName = language === 'en' ? 'Taxpayer name is required' : 'Kinakailangan ang pangalan ng nagbabayad';
    if (storedCitizenName && enteredTaxpayerName && storedCitizenName !== enteredTaxpayerName) {
      errors.taxpayerName = language === 'en' ? 'The taxpayer name must match the logged-in citizen account.' : 'Dapat tumugma ang pangalan ng nagbabayad sa naka-login na citizen account.';
    }
    if (!formData.email.trim()) {
      errors.email = language === 'en' ? 'Email is required' : 'Kinakailangan ang email';
    } else {
      const emailValidationMessage = getEmailValidationMessage(formData.email);
      if (emailValidationMessage) {
        errors.email = emailValidationMessage;
      }
    }
    if (!formData.contactNumber.trim()) {
      errors.contactNumber = language === 'en' ? 'Mobile number is required' : 'Kinakailangan ang mobile number';
    } else if (!PH_MOBILE_PATTERN.test(formData.contactNumber.replace(/[\s()-]/g, ''))) {
      errors.contactNumber = language === 'en' ? 'Please enter a valid Philippine mobile number' : 'Mangyaring maglagay ng wastong Philippine mobile number';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerateReference = async () => {
    if (activePendingPayment) {
      setError(language === 'en'
        ? 'You already have a pending RPT online payment awaiting treasury action. Please wait for branch verification before starting another payment.'
        : 'Mayroon ka nang nakabinbing RPT online payment na naghihintay ng aksyon ng treasury. Pakihintay munang ma-verify ng branch bago magsimula ng panibagong payment.');
      return;
    }
    if (isSystemDisabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!validateCheckout()) {
      setError(language === 'en' ? 'Please review the taxpayer details, cart, and payment method before continuing.' : 'Pakisuri ang detalye ng nagbabayad, cart, at payment method bago magpatuloy.');
      return;
    }

    setGeneratingReference(true);
    setError('');
    resetGeneratedPayment();

    try {
      const response = await paymentAPI.generateRptReference({
        taxpayerName: formData.taxpayerName,
        email: formData.email,
        contactNumber: formData.contactNumber,
        branchId: Number(selectedBranchId),
        paymentMethod: selectedPaymentMethod,
        bankCode: selectedPaymentMethod === 'banking' ? selectedBank : undefined,
        cartItems: cartItems.map((item) => ({
          ...item,
          payment_option: item.payment_option_value || (item.payment_option?.toLowerCase() === 'quarterly' ? 'quarterly' : 'full'),
        })),
      });
      setPaymentReference(response.data);
      setPaymentConfirmationOpen(true);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'object' && detail?.message) {
        setError(detail.message);
        if (detail.activePayment) {
          setActivePendingPayment(detail.activePayment);
          clearWorkflowState();
        }
      } else {
        setError(detail || 'Failed to generate the RPT payment reference.');
      }
    } finally {
      setGeneratingReference(false);
    }
  };

  const handleProceedToPayment = async () => {
    if (!paymentReference?.refNumber) {
      return;
    }

    let checkoutWindow = null;
    setProcessing(true);
    setError('');

    try {
      checkoutWindow = openCheckoutPopupShell({
        name: 'wardsPaymongoCheckout',
        title: 'Opening PayMongo Checkout',
        heading: 'Opening secure payment window...',
        description: 'Please wait while we redirect you to PayMongo. Keep this tab open to complete your payment.',
      });
      if (checkoutWindow) {
        // Build loading page with safe DOM APIs — no blob URL, no document.write
        const doc = checkoutWindow.document;
        doc.title = 'Opening PayMongo Checkout';

        const style = doc.createElement('style');
        style.textContent = 'body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1f2937;}';
        doc.head.appendChild(style);

        const container = doc.createElement('div');
        container.style.cssText = 'text-align:center;max-width:420px;padding:24px;';

        const heading = doc.createElement('h2');
        heading.style.marginBottom = '12px';
        heading.textContent = 'Opening secure payment window...';

        const paragraph = doc.createElement('p');
        paragraph.style.lineHeight = '1.5';
        paragraph.textContent = 'Please wait while we redirect you to PayMongo. Keep this tab open to complete your payment.';

        container.appendChild(heading);
        container.appendChild(paragraph);
        doc.body.appendChild(container);
      }

      const response = await paymentAPI.processPayment({
        refNumber: paymentReference.refNumber,
        paymentMethod: selectedPaymentMethod,
        ...(selectedPaymentMethod === 'banking' && selectedBank ? { bankCode: selectedBank } : {}),
      });

      if (response.data.checkoutUrl) {
        if (checkoutWindow && !checkoutWindow.closed) {
          safeReplace(response.data.checkoutUrl, checkoutWindow);
        } else {
          safeNavigate(response.data.checkoutUrl);
        }
        navigate(appendLanguageParam(`/payment/status?ref=${encodeURIComponent(response.data.refNumber || paymentReference.refNumber)}`, language));
        return;
      }

      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close();
      }
      setError('Payment checkout URL not received. Please try again.');
    } catch (err) {
      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close();
      }
      setError(err.response?.data?.detail || 'Failed to process payment.');
    } finally {
      setProcessing(false);
    }
  };

  const currentGuideSlide = text.guideSlides[guideIndex] || text.guideSlides[0];

  const confirmOwnerMatch = () => {
    if (!pendingProperty) {
      setOwnerConfirmationOpen(false);
      return;
    }
    setSearchedProperty(pendingProperty);
    setSelectedPropertyIds([pendingProperty.tdn]);
    setSelectedPaymentOption('');
    setStagedPaymentOption('full');
    setSelectionConfirmationOpen(false);
    setShowPaymentOptionStage(false);
    setPendingProperty(null);
    setOwnerConfirmationOpen(false);
  };

  const rejectOwnerMatch = () => {
    setPendingProperty(null);
    setSearchedProperty(emptyPropertySearch);
    setSelectedPropertyIds([]);
    setSelectedPaymentOption('');
    setShowPaymentOptionStage(false);
    setOwnerConfirmationOpen(false);
    setSearchError(language === 'en'
      ? 'Please review the Tax Declaration Number and search again if the owner details do not match.'
      : 'Pakisuri ang Tax Declaration Number at maghanap muli kung hindi tumutugma ang detalye ng may-ari.');
  };

  const confirmAddToCart = () => {
    if (!searchedProperty?.tdn) {
      setAddToCartConfirmationOpen(false);
      return;
    }
    const nextItem = buildCartItemFromProperty(searchedProperty, selectedBranch, selectedPaymentOption);
    setCartItems((current) => [...current, nextItem]);
    setSearchError('');
    resetGeneratedPayment();
    setPaymentDetailsOpen(false);
    setAddToCartConfirmationOpen(false);
    setAddToCartSuccessOpen(true);
  };

  const resetSearchFlow = () => {
    setSearchedProperty(emptyPropertySearch);
    setPendingProperty(null);
    setSelectedPropertyIds([]);
    setSelectedPaymentOption('');
    setSelectionConfirmationOpen(false);
    setShowPaymentOptionStage(false);
    setPaymentOptionModalOpen(false);
    setTdnInput('');
    setSearchError('');
    setPaymentDetailsOpen(false);
    setPaymentReference(null);
  };

  const scrollToTransactionSummary = () => {
    transactionSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loadingPage) {
    return (
      <section className="min-h-screen bg-[#f6f8fb] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-14 w-14 border-b-4 border-[#0f5b83] mx-auto mb-4"></div>
          <p className="text-slate-600">{text.loading}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#f7f9fc] pb-20 pt-10">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <div className="mb-5 grid gap-3 lg:grid-cols-[auto_auto_auto_1fr_auto] lg:items-center">
          {!hasResolvedSearchState ? (
            <button
              type="button"
              onClick={() => navigate('/pay-taxes')}
              className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
            >
              {text.backToServiceChooser}
            </button>
          ) : (
            <div />
          )}
          {!hasResolvedSearchState ? (
            <button
              type="button"
              onClick={() => {
                setGuideIndex(0);
                setGuideOpen(true);
              }}
              className="rounded-full bg-[#df3b39] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_25px_rgba(223,59,57,0.28)] transition hover:bg-[#c6312f]"
            >
              {text.guideButton}
            </button>
          ) : (
            <div />
          )}
          <div />
          <div />
          {hasResolvedSearchState && !paymentDetailsOpen ? (
            <button
              type="button"
              onClick={scrollToTransactionSummary}
              className="rounded-md bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white"
            >
              {text.cartButton} ({cartItems.length})
            </button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
          {!hasResolvedSearchState ? (
            <div className="border-b border-slate-200 bg-white px-6 py-6 sm:px-10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#0f5b83]">{text.pageEyebrow}</p>
                  <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.12em] text-slate-900 sm:text-[2.1rem]">
                    {text.pageTitle}
                  </h1>
                </div>
                <div className="max-w-xl text-sm leading-6 text-slate-600">
                  {text.pageDescription}
                </div>
              </div>
            </div>
          ) : null}

          <div className="px-6 py-8 sm:px-10">
            {error && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
                <p className="font-semibold">{error}</p>
              </div>
            )}

            {isSystemDisabled && (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
                <p className="font-semibold">{systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE}</p>
              </div>
            )}

            <div className="space-y-8">
              {activePendingPayment ? (
                <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 shadow-[0_14px_30px_rgba(180,83,9,0.08)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">{text.pendingTitle}</p>
                      <p className="mt-2 text-base font-semibold text-amber-950">
                        {text.pendingDescription}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-amber-900">
                        Reference: <span className="font-bold">{activePendingPayment.ref_number}</span> · Current stage:{' '}
                        <span className="font-bold">{String(activePendingPayment.workflow_status || activePendingPayment.status || 'Pending').replace(/_/g, ' ')}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(appendLanguageParam(`/payment/status?ref=${encodeURIComponent(activePendingPayment.ref_number)}`, language))}
                      className="rounded-full bg-[#0f5b83] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
                    >
                      {text.pendingButton}
                    </button>
                  </div>
                </div>
              ) : null}

              {!hasResolvedSearchState ? (
                <OutlineCard title={text.searchCardTitle}>
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                          {text.selectedBranch}
                        </label>
                        <BranchDropdown
                          value={selectedBranchId}
                          onChange={(value) => {
                            setSelectedBranchId(value);
                            setSearchedProperty(emptyPropertySearch);
                            setPendingProperty(null);
                            setSelectedPropertyIds([]);
                            setSelectedPaymentOption('');
                            setShowPaymentOptionStage(false);
                            setSearchError('');
                            setPaymentDetailsOpen(false);
                            resetGeneratedPayment();
                          }}
                          disabled={isSystemDisabled || isBlockedByPendingPayment}
                          options={[
                            { value: '', label: text.selectBranch },
                            ...branches.map((branch) => ({ value: String(branch.id), label: `${branch.name} - ${branch.location}` })),
                          ]}
                          placeholder={text.selectBranch}
                          error={validationErrors.branch || isBranchSearchError}
                        />
                      </div>
                    </div>

                    <div className="text-center">
                      {linkedAssessments.length ? (
                        <div className="mx-auto mb-6 max-w-[980px] rounded-[26px] border border-[#203e63] bg-[#203e63] px-5 py-5 text-left">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white">{text.verifiedAssessmentsTitle}</p>
                              <p className="mt-2 text-sm text-blue-100">{text.verifiedAssessmentsBody}</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#203e63]">{text.linkedRecords(linkedAssessments.length)}</span>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {linkedAssessments.map((assessment) => (
                              <button
                                key={assessment.id}
                                type="button"
                                onClick={() => {
                                  setTdnInput((assessment.tdn || '').toUpperCase());
                                  if (assessment.branch_id) {
                                    setSelectedBranchId(String(assessment.branch_id));
                                  }
                                  setSearchError('');
                                }}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-[#0f5b83] hover:bg-[#fbfdff]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">{assessment.tdn}</p>
                                    <p className="mt-1 text-xs text-slate-500">{assessment.property_address || (language === 'en' ? 'No property address recorded.' : 'Walang naitalang property address.')}</p>
                                  </div>
                                  <p className="text-xs font-semibold text-[#0f5b83]">{formatCurrency(assessment.final_total_amount_due || assessment.amount_due)}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">{text.tdnLabel}</p>
                      <div className="mx-auto flex max-w-[820px] flex-col gap-4 md:flex-row">
                        <input
                          type="text"
                          value={tdnInput}
                          onChange={(event) => {
                            setTdnInput(event.target.value.toUpperCase());
                            setSearchError('');
                          }}
                          disabled={isSystemDisabled || isBlockedByPendingPayment}
                          placeholder={text.tdnPlaceholder}
                          className="w-full rounded-full border border-[#0f5b83] px-8 py-4 text-center text-xl tracking-[0.12em] text-slate-700 outline-none transition placeholder:text-slate-300 focus:bg-[#fbfdff]"
                        />
                        <button
                          type="button"
                          onClick={handleSearchProperty}
                          disabled={searchingProperty || isSystemDisabled || isBlockedByPendingPayment}
                          className="rounded-full bg-[#203e63] px-10 py-4 text-base font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#13315c] disabled:opacity-50"
                        >
                          {searchingProperty ? text.searching : text.search}
                        </button>
                      </div>

                      {isSearchCaptchaRequired && !isSearchLockedOut ? (
                        <div className="mx-auto mt-5 max-w-[820px] rounded-[26px] border border-slate-200 bg-slate-50 px-5 py-5 text-left">
                          <p className="text-sm font-semibold text-slate-700">
                            {requiresRecaptcha ? text.recaptchaPrompt : text.recaptchaBlockedPrompt}
                          </p>
                          <div className="mt-4 flex justify-center">
                            <ReCAPTCHA
                              ref={recaptchaRef}
                              sitekey={RECAPTCHA_SITE_KEY}
                              onChange={(token) => setRecaptchaToken(token || '')}
                              onExpired={() => setRecaptchaToken('')}
                              onErrored={() => setRecaptchaToken('')}
                            />
                          </div>
                        </div>
                      ) : null}

                      {isSearchLockedOut ? (
                        <div className="mx-auto mt-5 max-w-[820px] rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
                          <p className="font-semibold">{text.searchLockout(lockoutSecondsRemaining)}</p>
                        </div>
                      ) : null}
                    </div>

                    {searchError && !isSearchLockedOut ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
                        {searchError}
                      </div>
                    ) : null}
                  </div>
                </OutlineCard>
              ) : null}

              {hasSearchedProperty && !paymentDetailsOpen ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4 text-sm font-bold uppercase tracking-[0.12em] text-[#0f5b83]">
                      <button
                        type="button"
                        onClick={resetSearchFlow}
                        className="inline-flex items-center gap-2 transition hover:text-[#0c4d6f]"
                      >
                        <span aria-hidden="true">&lsaquo;</span>
                      {text.goBackToSearch}
                      </button>
                    <div className="text-slate-500 normal-case">
                      {selectedBranch?.name} {selectedBranch?.location ? <span>- {selectedBranch.location}</span> : null}
                    </div>
                  </div>

                  {!showPaymentOptionStage ? (
                    <OutlineCard title={language === 'en' ? 'Possible properties you might own' : 'Mga posibleng property na Pagmamay-ari mo'}>
                      <div className="overflow-hidden rounded-[24px] border border-slate-200">
                        <div className="overflow-hidden">
                          <table className="w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-white text-slate-500">
                              <tr>
                                <th className="px-4 py-3 text-left font-semibold">
                                  <input
                                    type="checkbox"
                                    checked={selectedPropertyIds.includes(searchedProperty.tdn)}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setSelectedPropertyIds([searchedProperty.tdn]);
                                      } else {
                                        setSelectedPropertyIds([]);
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-[#0f5b83] focus:ring-[#0f5b83]"
                                  />
                                </th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Tax Declaration No.' : 'Tax Declaration No.'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Name of Owner' : 'Pangalan ng May-ari'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Bill Expiry Date' : 'Petsa ng Pagkawalang-bisa ng Bill'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Type' : 'Uri'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                              <tr>
                                <td className="px-4 py-4">
                                  <input
                                    type="checkbox"
                                    checked={selectedPropertyIds.includes(searchedProperty.tdn)}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setSelectedPropertyIds([searchedProperty.tdn]);
                                      } else {
                                        setSelectedPropertyIds([]);
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-[#0f5b83] focus:ring-[#0f5b83]"
                                  />
                                </td>
                                <td className="px-4 py-4 font-semibold text-slate-900">{searchedProperty.tdn}</td>
                                <td className="px-4 py-4">{searchedProperty.taxpayer_name}</td>
                                <td className="px-4 py-4">2026-12-31</td>
                                <td className="px-4 py-4">{language === 'en' ? 'Land' : 'Lupa'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl lg:flex-1">
                          <DetailStat label="Fair Market Value" value={formatCurrency(searchedProperty.fair_market_value)} />
                          <DetailStat label="Assessment Level" value={formatPercentage(searchedProperty.assessment_level)} />
                            <DetailStat label={language === 'en' ? 'Final Amount Due' : 'Pinal na Halagang Dapat Bayaran'} value={formatCurrency(searchedProperty.final_total_amount_due)} tone="primary" />
                        </div>
                        <div className="flex flex-col items-start gap-3 sm:items-end">
                          <p className="text-sm text-slate-500">
                            {text.selectedTdnCount} <span className="font-bold text-slate-900">{selectedSearchItems.length}</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              if (!selectedSearchItems.length) {
                                setSearchError(language === 'en' ? 'Please select at least one TDN before continuing.' : 'Mangyaring pumili ng kahit isang TDN bago magpatuloy.');
                                return;
                              }
                              if (isBlockedByPendingPayment) {
                                setSearchError(language === 'en' ? 'You already have a pending RPT online payment awaiting treasury action.' : 'Mayroon ka nang nakabinbing RPT online payment na naghihintay ng aksyon ng treasury.');
                                return;
                              }
                              setSelectionConfirmationOpen(true);
                            }}
                            className="rounded-full bg-[#df3b39] px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#c6312f]"
                          >
                            {text.paymentOptionPrompt}
                          </button>
                        </div>
                      </div>
                    </OutlineCard>
                  ) : (
                    <OutlineCard title={language === 'en' ? 'Selected Tax Declaration Number(s)' : 'Napiling Tax Declaration Number(s)'}>
                      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowPaymentOptionStage(false);
                            setSelectedPaymentOption('');
                            setPaymentReference(null);
                          }}
                          className="rounded-full border border-[#0f5b83] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#0f5b83] transition hover:bg-[#eef7fb]"
                        >
                          {text.editSelected}
                        </button>
                        <button
                          type="button"
                          onClick={handleAddToCart}
                          disabled={isBlockedByPendingPayment}
                          className="rounded-full bg-[#df3b39] px-5 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f] disabled:opacity-50"
                        >
                          {language === 'en' ? 'Add to Cart' : 'Idagdag sa Cart'}
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-[24px] border border-slate-200">
                        <div className="overflow-hidden">
                          <table className="w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-white text-slate-500">
                              <tr>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Tax Declaration No.' : 'Tax Declaration No.'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Name of Owner' : 'Pangalan ng May-ari'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Payment Option' : 'Opsyon sa Bayad'}</th>
                                <th className="px-4 py-3 text-left font-semibold">{language === 'en' ? 'Action' : 'Aksyon'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                              <tr>
                                <td className="px-4 py-4 font-semibold text-slate-900">{searchedProperty.tdn}</td>
                                <td className="px-4 py-4">{searchedProperty.taxpayer_name}</td>
                                <td className="px-4 py-4">{selectedPaymentOption ? (selectedPaymentOption === 'quarterly' ? (language === 'en' ? 'Quarterly' : 'Kada quarter') : (language === 'en' ? 'Full' : 'Buo')) : (language === 'en' ? 'Not yet selected' : 'Hindi pa napili')}</td>
                                <td className="px-4 py-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStagedPaymentOption(selectedPaymentOption || 'full');
                                      setPaymentOptionModalOpen(true);
                                    }}
                                    className="font-semibold text-[#2570d5] transition hover:text-[#0f5b83]"
                                  >
                                    {selectedPaymentOption ? (language === 'en' ? 'Edit Payment Option' : 'Baguhin ang Payment Option') : (language === 'en' ? 'Select Payment Option' : 'Pumili ng Payment Option')}
                                  </button>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {selectedCartPreviewItem ? (
                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                          <DetailStat label="Basic Tax" value={formatCurrency(selectedCartPreviewItem.basic_tax_due)} />
                          <DetailStat label="SEF Tax" value={formatCurrency(selectedCartPreviewItem.sef_tax)} />
                          <DetailStat label="Penalties" value={formatCurrency(selectedCartPreviewItem.penalties)} />
                          <DetailStat label={language === 'en' ? 'Discounts' : 'Mga Diskwento'} value={formatCurrency(selectedCartPreviewItem.discounts)} tone="success" />
                          <DetailStat label={language === 'en' ? 'Total' : 'Kabuuan'} value={formatCurrency(selectedCartPreviewItem.final_total_amount_due)} tone="primary" />
                        </div>
                      ) : null}
                    </OutlineCard>
                  )}

                  {searchError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
                      {searchError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {hasStartedCheckoutFlow && !paymentDetailsOpen ? (
                <div ref={transactionSummaryRef} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <OutlineCard title={text.cartButton}>
                    {validationErrors.cart ? <p className="mb-4 text-sm text-red-500">{validationErrors.cart}</p> : null}
                    {!cartItems.length ? (
                      <div className="rounded-[26px] border border-dashed border-[#b7cfde] bg-white px-6 py-12 text-center text-sm text-slate-500">
                        {language === 'en' ? 'Search for a TDN and add it to your cart to continue.' : 'Maghanap ng TDN at idagdag ito sa cart upang magpatuloy.'}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f5b83]">{language === 'en' ? 'Group Bill Set:' : 'Pangkat ng Billing:'} ({cartItems.length} TDN)</p>
                          <div className="mt-4 space-y-4">
                            {cartItems.map((item) => (
                              <div key={item.tdn} className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="grid gap-1">
                                  <p className="text-sm font-bold text-slate-900">{language === 'en' ? 'TDN:' : 'TDN:'} {item.tdn}</p>
                                  <p className="text-sm text-slate-600">{language === 'en' ? 'Name of Owner:' : 'Pangalan ng May-ari:'} {item.taxpayer_name}</p>
                                  <p className="text-sm text-slate-600">{language === 'en' ? 'Payment Mode:' : 'Uri ng Pagbabayad:'} {item.payment_option || 'Full'}</p>
                                  <p className="text-sm text-slate-600">{language === 'en' ? 'Bill Coverage:' : 'Saklaw ng Bill:'} {item.payment_option_value === 'quarterly' ? (language === 'en' ? 'Current Quarter' : 'Kasalukuyang Quarter') : (language === 'en' ? 'Full Year' : 'Buong Taon')}</p>
                                </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFromCart(item.tdn)}
                                    className="text-sm font-bold uppercase tracking-[0.12em] text-red-600 transition hover:text-red-700"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            <DetailStat label={language === 'en' ? 'Amount Due' : 'Halagang Dapat Bayaran'} value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.basic_tax_due || 0) + Number(item.sef_tax || 0), 0))} />
                            <DetailStat label={language === 'en' ? 'SHTTC Applied' : 'Inilapat na SHTTC'} value={formatCurrency(0)} />
                            <DetailStat label={language === 'en' ? 'Discount' : 'Diskwento'} value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.discounts || 0), 0))} tone="success" />
                            <DetailStat label={language === 'en' ? 'Penalty Fee' : 'Penalty Fee'} value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.penalties || 0), 0))} />
                            <DetailStat label={language === 'en' ? 'Total' : 'Kabuuan'} value={formatCurrency(cartTotal)} tone="primary" />
                          </div>
                        </div>

                      </div>
                    )}
                  </OutlineCard>

                  <OutlineCard title={language === 'en' ? 'Transaction Summary' : 'Buod ng Transaksyon'} className="h-fit">
                    {!cartItems.length ? (
                      <p className="text-sm text-slate-500">{language === 'en' ? 'Your transaction summary will appear here after you add a TDN to the cart.' : 'Lalabas dito ang iyong transaction summary pagkatapos mong magdagdag ng TDN sa cart.'}</p>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-3 text-sm">
                          {cartItems.map((item) => (
                            <div key={`${item.tdn}-summary`} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
                              <span className="text-slate-600">{item.tdn}</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(item.final_total_amount_due)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-300 pt-3">
                          <span className="text-sm font-bold uppercase tracking-[0.12em] text-slate-600">{language === 'en' ? 'Total Amount' : 'Kabuuang Halaga'}</span>
                          <span className="text-2xl font-bold text-[#0f5b83]">{formatCurrency(cartTotal)}</span>
                        </div>
                        {!paymentReference ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentDetailsOpen(true);
                              setTimeout(() => {
                                transactionSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 50);
                            }}
                            className="w-full rounded-full bg-[#df3b39] px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f]"
                          >
                            {language === 'en' ? 'Proceed to Payment' : 'Magpatuloy sa Pagbabayad'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPaymentConfirmationOpen(true)}
                            disabled={processing}
                            className="w-full rounded-full bg-[#df3b39] px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f] disabled:opacity-50"
                          >
                            {processing ? (language === 'en' ? 'Redirecting to PayMongo...' : 'Ire-redirect sa PayMongo...') : (language === 'en' ? 'Open PayMongo Checkout' : 'Buksan ang PayMongo Checkout')}
                          </button>
                        )}
                      </div>
                    )}
                  </OutlineCard>
                </div>
              ) : null}

              {hasStartedCheckoutFlow && paymentDetailsOpen ? (
                <OutlineCard title={language === 'en' ? 'Payment Details' : 'Mga Detalye ng Bayad'}>
                  <div className="space-y-6">
                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={() => setPaymentDetailsOpen(false)}
                        className="rounded-full border border-[#0f5b83] bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#0f5b83] transition hover:bg-[#eef7fb]"
                      >
                        {language === 'en' ? 'Back to Transaction Summary' : 'Bumalik sa Buod ng Transaksyon'}
                      </button>
                    </div>

                    <PaymentGatewayExperience
                      amount={cartTotal}
                      bankCode={selectedBank}
                      customer={{
                        name: publicUser?.full_name || formData.taxpayerName,
                        email: formData.email,
                        mobile: formData.contactNumber,
                      }}
                      disabled={isSystemDisabled || isBlockedByPendingPayment}
                      method={selectedPaymentMethod}
                      onBankChange={(value) => {
                        setSelectedBank(value);
                        resetGeneratedPayment();
                      }}
                      onCustomerChange={handlePaymentCustomerChange}
                      onMethodChange={(value) => {
                        setSelectedPaymentMethod(value);
                        setSelectedBank('');
                        resetGeneratedPayment();
                      }}
                      onContinue={handleGenerateReference}
                      processing={generatingReference}
                      readOnlyCustomer
                      referenceNumber={paymentReference?.refNumber}
                      title={language === 'en' ? 'RPT Payment Checkout' : 'Checkout ng RPT Payment'}
                      language={language}
                    />

                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                      <p className="font-bold text-slate-900">{language === 'en' ? 'PayMongo Gateway Note' : 'Paalala sa PayMongo Gateway'}</p>
                      <p className="mt-2">
                        {language === 'en'
                          ? 'Review the system-computed RPT amount, then complete the payer details in the checkout below. PayMongo opens only for final transaction processing and payment status validation.'
                          : 'Suriin ang awtomatikong kinuwentang RPT amount, pagkatapos ay kumpletuhin ang detalye ng magbabayad sa checkout sa ibaba. Bubuksan lamang ang PayMongo para sa final transaction processing at payment status validation.'}
                      </p>
                    </div>

                    {paymentReference ? (
                      <div className="rounded-[24px] bg-emerald-50 px-5 py-5 ring-1 ring-emerald-200">
                        <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-800">{language === 'en' ? 'Payment Summary' : 'Buod ng Bayad'}</h4>
                        <div className="mt-4 space-y-3 text-sm text-slate-700">
                          <div className="flex justify-between gap-4"><span>{language === 'en' ? 'WARDS Transaction Number' : 'Numero ng Transaksyon ng WARDS'}</span><span className="font-semibold text-slate-900">{paymentReference.txnId}</span></div>
                          <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Payment Reference ID' : 'Payment Reference ID'}</span><span className="font-semibold text-slate-900">{paymentReference.refNumber}</span></div>
                          <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Selected Branch' : 'Napiling Sangay'}</span><span className="font-semibold text-slate-900">{selectedBranch?.name || 'N/A'}</span></div>
                          <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Cart Entries' : 'Mga Nasa Cart'}</span><span className="font-semibold text-slate-900">{paymentReference.cartItems?.length || cartItems.length}</span></div>
                          <div className="flex justify-between gap-4 border-t border-emerald-200 pt-3">
                            <span>{language === 'en' ? 'Please verify the total amount to be paid.' : 'Pakisuri ang kabuuang halagang babayaran.'}</span>
                            <span className="text-lg font-bold text-[#0f5b83]">{formatCurrency(paymentReference.amount)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPaymentConfirmationOpen(true)}
                          disabled={processing || isBlockedByPendingPayment}
                          className="mt-5 w-full rounded-full bg-emerald-600 px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {processing ? (language === 'en' ? 'Redirecting to PayMongo...' : 'Ire-redirect sa PayMongo...') : (language === 'en' ? 'Continue to PayMongo' : 'Magpatuloy sa PayMongo')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </OutlineCard>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {guideOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="relative w-full max-w-4xl rounded-[34px] bg-white px-6 py-8 shadow-[0_28px_80px_rgba(15,23,42,0.32)] sm:px-10">
            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="absolute right-5 top-5 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label={text.closeGuide}
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="pr-10">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#0f5b83]">{text.instructions}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">{text.guideTitle}</h2>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-[72px_minmax(0,1fr)_72px] md:items-center">
              <div className="flex justify-start md:justify-center">
                <button
                  type="button"
                  onClick={() => setGuideIndex((current) => (current === 0 ? text.guideSlides.length - 1 : current - 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
                  aria-label={text.previousGuide}
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-6">
                <div className="rounded-[24px] border border-[#d6e5ef] bg-white px-5 py-5">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                        {text.stepLabel} {guideIndex + 1} {language === 'en' ? 'of' : 'sa'} {text.guideSlides.length}
                      </p>
                      <h3 className="mt-2 text-xl font-bold text-[#0f5b83]">{currentGuideSlide.title}</h3>
                    </div>
                    <div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-[#0f5b83] text-base font-bold text-white sm:flex">
                      {guideIndex + 1}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {currentGuideSlide.steps.map((step, index) => (
                      <div key={`${currentGuideSlide.title}-${index}`} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f5b83] text-xs font-bold text-white">
                          {index + 1}
                        </div>
                        <p className="text-sm leading-7 text-slate-700">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-center gap-2">
                  {text.guideSlides.map((slide, index) => (
                    <button
                      key={slide.title}
                      type="button"
                      onClick={() => setGuideIndex(index)}
                      className={`h-3.5 w-3.5 rounded-full transition ${
                        guideIndex === index ? 'bg-[#0f5b83]' : 'bg-slate-300 hover:bg-slate-400'
                      }`}
                      aria-label={language === 'en' ? `Go to guide slide ${index + 1}` : `Pumunta sa guide slide ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end md:justify-center">
                <button
                  type="button"
                  onClick={() => setGuideIndex((current) => (current === text.guideSlides.length - 1 ? 0 : current + 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
                  aria-label={text.nextGuide}
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectionConfirmationOpen ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-md rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eef7fb] text-[#0f5b83]">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">Info</h3>
            <p className="mt-4 text-center text-sm leading-7 text-slate-700">
              I acknowledge that I have reviewed the properties that may be under my ownership before proceeding to payment options.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectionConfirmationOpen(false);
                  setShowPaymentOptionStage(false);
                }}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                Edit Selected TDN
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectionConfirmationOpen(false);
                  setShowPaymentOptionStage(true);
                }}
                className="rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymentOptionModalOpen && hasSearchedProperty ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-4xl rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <h3 className="text-center text-xl font-bold uppercase tracking-[0.08em] text-slate-900">
              {language === 'en' ? 'Choose a Payment Option' : 'Pumili ng Payment Option'} ({searchedProperty.tdn})
            </h3>
            <p className="mt-2 text-center text-sm text-slate-500">
              {language === 'en' ? 'Bill Coverage: current simulated RPT schedule' : 'Saklaw ng Bill: kasalukuyang simulated RPT schedule'}
            </p>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setStagedPaymentOption('quarterly')}
                className={`rounded-[28px] border px-6 py-6 text-left transition ${
                  stagedPaymentOption === 'quarterly'
                    ? 'border-[#0f5b83] bg-white shadow-[0_14px_32px_rgba(15,91,131,0.14)]'
                    : 'border-slate-200 bg-white hover:border-[#0f5b83]'
                }`}
              >
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f5b83]">{language === 'en' ? 'Payment Option 1: Quarterly' : 'Payment Option 1: Kada quarter'}</p>
                <div className="mt-5 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Amount Due' : 'Halagang Dapat Bayaran'}</span><span>{formatCurrency((Number(searchedProperty.basic_tax_due || 0) + Number(searchedProperty.sef_tax || 0)) / 4)}</span></div>
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Discount' : 'Diskwento'}</span><span>-{formatCurrency(searchedProperty.discounts)}</span></div>
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Penalty Fee' : 'Penalty Fee'}</span><span>{formatCurrency(searchedProperty.penalties)}</span></div>
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                    <span>{language === 'en' ? 'Total' : 'Kabuuan'}</span>
                    <span>{formatCurrency(getQuarterlyAmount(searchedProperty))}</span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStagedPaymentOption('full')}
                className={`rounded-[28px] border px-6 py-6 text-left transition ${
                  stagedPaymentOption === 'full'
                    ? 'border-[#0f5b83] bg-white shadow-[0_14px_32px_rgba(15,91,131,0.14)]'
                    : 'border-slate-200 bg-white hover:border-[#0f5b83]'
                }`}
              >
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f5b83]">{language === 'en' ? 'Payment Option 2: Full' : 'Payment Option 2: Buo'}</p>
                <div className="mt-5 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Amount Due' : 'Halagang Dapat Bayaran'}</span><span>{formatCurrency(Number(searchedProperty.basic_tax_due || 0) + Number(searchedProperty.sef_tax || 0))}</span></div>
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Discount' : 'Diskwento'}</span><span>-{formatCurrency(searchedProperty.discounts)}</span></div>
                  <div className="flex justify-between gap-4"><span>{language === 'en' ? 'Penalty Fee' : 'Penalty Fee'}</span><span>{formatCurrency(searchedProperty.penalties)}</span></div>
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                    <span>{language === 'en' ? 'Total' : 'Kabuuan'}</span>
                    <span>{formatCurrency(searchedProperty.final_total_amount_due)}</span>
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentOptionModalOpen(false)}
                className="rounded-full border border-[#df3b39] bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#df3b39] transition hover:bg-red-50"
              >
                {language === 'en' ? 'Cancel' : 'Kanselahin'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPaymentOption(stagedPaymentOption);
                  setPaymentOptionModalOpen(false);
                  setSearchError('');
                }}
                className="rounded-full bg-[#df3b39] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f]"
              >
                {language === 'en' ? 'Confirm' : 'Kumpirmahin'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ownerConfirmationOpen && pendingProperty ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-md rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eef7fb] text-[#0f5b83]">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">{language === 'en' ? 'Please verify the registered owner' : 'Pakiverify ang nakatalang may-ari'}</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              {language === 'en'
                ? <>Please verify that you are paying the RPT for <span className="font-bold">{pendingProperty.taxpayer_name}</span>.</>
                : <>Pakiverify na ikaw ang nagbabayad ng RPT para kay <span className="font-bold">{pendingProperty.taxpayer_name}</span>.</>}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={confirmOwnerMatch}
                className="rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
              >
                {language === 'en' ? 'Yes' : 'Oo'}
              </button>
              <button
                type="button"
                onClick={rejectOwnerMatch}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                {language === 'en' ? 'No' : 'Hindi'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addToCartSuccessOpen ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-md rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <svg className="h-9 w-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-2xl font-bold text-slate-900">{language === 'en' ? 'Successfully Added to Cart' : 'Matagumpay na naidagdag sa Cart'}</h3>
            <button
              type="button"
              onClick={() => {
                setAddToCartSuccessOpen(false);
                scrollToTransactionSummary();
              }}
              className="mt-6 w-full rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
            >
              {language === 'en' ? 'OK' : 'Sige'}
            </button>
          </div>
        </div>
      ) : null}

      {removeFromCartConfirmationOpen && pendingRemovalTdn ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-md rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">{language === 'en' ? 'Remove this TDN from your cart?' : 'Tanggalin ang TDN na ito mula sa iyong cart?'}</h3>
            <p className="mt-4 text-center text-sm leading-7 text-slate-700">
              {language === 'en'
                ? <>This will remove <span className="font-bold text-slate-900">{pendingRemovalTdn}</span> from My Cart and update your transaction summary.</>
                : <>Tatanggalin nito ang <span className="font-bold text-slate-900">{pendingRemovalTdn}</span> mula sa Aking Cart at ia-update ang iyong transaction summary.</>}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={cancelRemoveFromCart}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-600 transition hover:bg-slate-100"
              >
                {language === 'en' ? 'Cancel' : 'Kanselahin'}
              </button>
              <button
                type="button"
                onClick={confirmRemoveFromCart}
                className="rounded-full bg-[#df3b39] px-5 py-3 text-sm font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#c6312f]"
              >
                {language === 'en' ? 'Yes, Remove' : 'Oo, Tanggalin'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addToCartConfirmationOpen && searchedProperty?.tdn ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-md rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eef7fb] text-[#0f5b83]">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">{language === 'en' ? 'Add this amount to cart?' : 'Idagdag ang halagang ito sa cart?'}</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              {language === 'en'
                ? <>The computed amount of <span className="font-bold text-[#0f5b83]">{formatCurrency(searchedProperty.final_total_amount_due)}</span> for <span className="font-bold"> {searchedProperty.tdn}</span> will be added to your cart.</>
                : <>Ang awtomatikong nakwenta na halagang <span className="font-bold text-[#0f5b83]">{formatCurrency(searchedProperty.final_total_amount_due)}</span> para sa <span className="font-bold"> {searchedProperty.tdn}</span> ay idaragdag sa iyong cart.</>}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={confirmAddToCart}
                className="rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
              >
                {language === 'en' ? 'Yes' : 'Oo'}
              </button>
              <button
                type="button"
                onClick={() => setAddToCartConfirmationOpen(false)}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                {language === 'en' ? 'No' : 'Hindi'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymentConfirmationOpen && paymentReference ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="w-full max-w-lg rounded-[30px] bg-white px-7 py-7 shadow-[0_28px_80px_rgba(15,23,42,0.32)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eef7fb] text-[#0f5b83]">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">{language === 'en' ? 'Confirm payment details' : 'Kumpirmahin ang detalye ng bayad'}</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              {language === 'en' ? 'Total amount to be paid:' : 'Kabuuang halagang babayaran:'} <span className="font-bold text-[#0f5b83]">{formatCurrency(paymentReference.amount)}</span>
            </p>
            <p className="mt-2 text-center text-sm leading-6 text-slate-500">
              {language === 'en'
                ? 'If the details are correct, continue to PayMongo sandbox checkout. Otherwise, go back and update your cart or payment details.'
                : 'Kung tama ang mga detalye, magpatuloy sa PayMongo sandbox checkout. Kung hindi, bumalik at i-update ang iyong cart o payment details.'}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={async () => {
                  setPaymentConfirmationOpen(false);
                  await handleProceedToPayment();
                }}
                className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-emerald-700"
              >
                {language === 'en' ? 'Yes' : 'Oo'}
              </button>
              <button
                type="button"
                onClick={() => setPaymentConfirmationOpen(false)}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                {language === 'en' ? 'No' : 'Hindi'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default PayTaxesRPT;
