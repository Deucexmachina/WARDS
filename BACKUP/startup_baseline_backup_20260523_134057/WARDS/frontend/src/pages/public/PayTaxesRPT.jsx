import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { paymentAPI, taxpayerAccountAPI } from '../../services/api';
import { formatTin, getEmailValidationMessage, validateTin } from '../../utils/validation';

const API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const PAYMENT_METHODS = [
  { id: 'gcash', label: 'GCash', icon: 'GC' },
  { id: 'maya', label: 'Maya', icon: 'MY' },
  { id: 'card', label: 'Debit / Credit Card', icon: 'CC' },
  { id: 'banking', label: 'Online Banking', icon: 'OB' },
];
const PH_MOBILE_PATTERN = /^(?:\+63|63|0)9\d{9}$/;
const BANK_OPTIONS = [
  { value: 'bdo', label: 'BDO - Banco de Oro' },
  { value: 'bpi', label: 'BPI - Bank of the Philippine Islands' },
  { value: 'metrobank', label: 'Metrobank' },
  { value: 'unionbank', label: 'UnionBank' },
  { value: 'landbank', label: 'Landbank' },
];
const RPT_FINAL_CLEAR_STATUSES = new Set(['PAYMENT_VERIFIED', 'OR_GENERATED', 'COMPLETED']);

const getStoredPublicUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || localStorage.getItem('publicUser') || 'null');
  } catch {
    return null;
  }
};

const normalizeIdentityName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const normalizeTinDigits = (value) => String(value || '').replace(/\D/g, '');

const formatCurrency = (amount) =>
  `PHP ${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercentage = (value) => `${(Number(value || 0) * 100).toFixed(0)}%`;

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

const GUIDE_SLIDES = [
  {
    title: 'Search for your Tax Declaration Number',
    steps: [
      'Type and search for the Tax Declaration Number of your property.',
      'Complete the CAPTCHA validation before continuing.',
      'Review the daily search allocation shown below the search field.',
      "Click the 'Search' button.",
    ],
  },
  {
    title: 'Confirm the registered owner',
    steps: [
      'If the Tax Declaration Number is in the system, the registered property owner will be shown.',
      "If the owner name is correct, choose 'Yes'.",
      "If it is incorrect, choose 'No' and review the Tax Declaration Number you entered.",
    ],
  },
  {
    title: 'Select the TDNs to pay',
    steps: [
      'Choose the TDNs that you would like to pay.',
      "Click 'Go to Payment Options'.",
      'If there are unpaid or unselected TDNs, a reminder prompt may appear before proceeding.',
    ],
  },
  {
    title: 'Assign the payment option',
    steps: [
      "Use 'Select Payment Option' if the TDN does not yet have an assigned schedule.",
      "If a payment option is already present, use 'Edit Payment Option'.",
      "Choose either 'Full' or 'Quarterly' based on the taxpayer's preference.",
      "Click 'Confirm' once the payment option is correct.",
    ],
  },
  {
    title: 'Add selected entries to the cart',
    steps: [
      "Click 'Add to Cart'.",
      "A confirmation dialog will appear before the amount is added to the cart.",
      "Click 'Yes' to continue, then click 'OK' to return to the cart.",
    ],
  },
  {
    title: 'Review the transaction summary',
    steps: [
      'The system will display the total amount that needs to be settled.',
      "Review the transaction details carefully inside 'My Cart'.",
      "Click 'Proceed to Payment' to continue to the e-payments page.",
    ],
  },
  {
    title: 'Confirm the amount for payment',
    steps: [
      'A confirmation prompt will ask you to verify the total amount before payment.',
      "Click 'Yes' to proceed or 'No' to return and adjust the details.",
      'Take note of the payment reference number shown before moving to the payment provider.',
    ],
  },
  {
    title: 'Complete the third-party payment',
    steps: [
      'For online payment options, you will be redirected to a third-party payment provider.',
      'Follow the payment provider instructions to finish the transaction.',
      'If you need assistance, contact rptpayment@quezoncity.gov.ph.',
    ],
  },
];

const OutlineCard = ({ title, children, className = '' }) => (
  <div className={`rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_36px_rgba(15,23,42,0.06)] ${className}`}>
    <h3 className="mb-5 text-sm font-bold uppercase tracking-[0.24em] text-[#0f5b83]">{title}</h3>
    {children}
  </div>
);

const DetailStat = ({ label, value, tone = 'default' }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
    <p className={`mt-2 text-sm font-semibold ${tone === 'success' ? 'text-emerald-700' : tone === 'primary' ? 'text-[#0f5b83]' : 'text-slate-900'}`}>{value}</p>
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

const PayTaxesRPT = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const transactionSummaryRef = useRef(null);
  const publicUser = getStoredPublicUser();
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
    tin: formatTin(publicUser?.tin || ''),
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
  const [activePendingPayment, setActivePendingPayment] = useState(null);

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
  };

  useEffect(() => {
    const fetchSetup = async () => {
      try {
        const [branchesResponse, statusResponse, activePaymentResponse, linkedAssessmentResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/public/branches`),
          axios.get(`${API_BASE_URL}/public/system-status`),
          paymentAPI.getActiveRptPayment(),
          taxpayerAccountAPI.getAssessments({ tax_type: 'RPT' }).catch(() => ({ data: { items: [] } })),
        ]);
        setBranches(branchesResponse.data);
        setSystemStatus(statusResponse.data);
        const nextActivePayment = activePaymentResponse.data?.payment || null;
        setLinkedAssessments(linkedAssessmentResponse.data?.items || []);
        setActivePendingPayment(nextActivePayment);
        if (nextActivePayment) {
          clearWorkflowState();
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load payment setup.');
      } finally {
        setLoadingPage(false);
      }
    };

    fetchSetup();
  }, []);

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
    const nextValue = name === 'tin' ? formatTin(value) : value;
    setFormData((current) => ({ ...current, [name]: nextValue }));
    if (validationErrors[name]) {
      setValidationErrors((current) => ({ ...current, [name]: '' }));
    }
    if (error) setError('');
    resetGeneratedPayment();
  };

  const handleSearchProperty = async () => {
    if (activePendingPayment) {
      setSearchError('You already have a pending RPT online payment awaiting treasury action. Please wait for branch verification before starting another payment.');
      return;
    }
    if (!selectedBranchId) {
      setSearchError('Please select a branch before searching for a property.');
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
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'object' && detail?.message) {
        setSearchError(detail.message);
        setSearchStats({
          searchesRemaining: detail.searchesRemaining ?? searchStats.searchesRemaining,
          searchLimit: detail.searchLimit ?? searchStats.searchLimit,
          searchesUsed: detail.searchesUsed ?? searchStats.searchesUsed,
        });
      } else {
        setSearchError(detail || 'Failed to search property record.');
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
    setCartItems((current) => current.filter((item) => item.tdn !== tdn));
    resetGeneratedPayment();
  };

  const validateCheckout = () => {
    const errors = {};
    const storedCitizenName = normalizeIdentityName(publicUser?.full_name);
    const enteredTaxpayerName = normalizeIdentityName(formData.taxpayerName);
    const storedTin = normalizeTinDigits(publicUser?.tin);
    const enteredTin = normalizeTinDigits(formData.tin);

    if (!selectedBranchId) errors.branch = 'Branch selection is required';
    if (!cartItems.length) errors.cart = 'Add at least one TDN to the cart';
    if (!formData.taxpayerName.trim()) errors.taxpayerName = 'Taxpayer name is required';
    const tinValidationError = validateTin(formData.tin);
    if (tinValidationError) errors.tin = tinValidationError;
    if (storedCitizenName && enteredTaxpayerName && storedCitizenName !== enteredTaxpayerName) {
      errors.taxpayerName = 'The taxpayer name must match the logged-in citizen account.';
    }
    if (storedTin && enteredTin && storedTin !== enteredTin) {
      errors.tin = 'TIN verification failed. Please use the TIN linked to your citizen account.';
    }
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailValidationMessage = getEmailValidationMessage(formData.email);
      if (emailValidationMessage) {
        errors.email = emailValidationMessage;
      }
    }
    if (!formData.contactNumber.trim()) {
      errors.contactNumber = 'Mobile number is required';
    } else if (!PH_MOBILE_PATTERN.test(formData.contactNumber.replace(/[\s()-]/g, ''))) {
      errors.contactNumber = 'Please enter a valid Philippine mobile number';
    }
    if (selectedPaymentMethod === 'banking' && !selectedBank) {
      errors.selectedBank = 'Please select a bank';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerateReference = async () => {
    if (activePendingPayment) {
      setError('You already have a pending RPT online payment awaiting treasury action. Please wait for branch verification before starting another payment.');
      return;
    }
    if (isSystemDisabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!validateCheckout()) {
      setError('Please review the taxpayer details, cart, and payment method before continuing.');
      return;
    }

    setGeneratingReference(true);
    setError('');
    resetGeneratedPayment();

    try {
      const response = await paymentAPI.generateRptReference({
        taxpayerName: formData.taxpayerName,
        tin: formData.tin,
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
      checkoutWindow = window.open('', 'wardsPaymongoCheckout');
      if (checkoutWindow) {
        checkoutWindow.document.write(`
          <html>
            <head><title>Opening PayMongo Checkout</title></head>
            <body style="font-family: Arial, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f8fafc; color:#1f2937;">
              <div style="text-align:center; max-width:420px; padding:24px;">
                <h2 style="margin-bottom:12px;">Opening secure payment window...</h2>
                <p style="line-height:1.5;">Please wait while we redirect you to PayMongo. Keep this tab open to complete your payment.</p>
              </div>
            </body>
          </html>
        `);
        checkoutWindow.document.close();
      }

      const response = await paymentAPI.processPayment({
        refNumber: paymentReference.refNumber,
        paymentMethod: selectedPaymentMethod,
        ...(selectedPaymentMethod === 'banking' && selectedBank ? { bankCode: selectedBank } : {}),
      });

      if (response.data.checkoutUrl) {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.location.replace(response.data.checkoutUrl);
        } else {
          window.location.href = response.data.checkoutUrl;
        }
        navigate(`/payment/status?ref=${encodeURIComponent(response.data.refNumber || paymentReference.refNumber)}`);
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

  const currentGuideSlide = GUIDE_SLIDES[guideIndex];

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
    setSearchError('Please review the Tax Declaration Number and search again if the owner details do not match.');
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
          <p className="text-slate-600">Loading RPT online payment workflow...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#f7f9fc] pb-20 pt-10">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8">
        <div className="mb-5 grid gap-3 lg:grid-cols-[auto_auto_1fr_auto] lg:items-center">
          <button
            type="button"
            onClick={() => {
              setGuideIndex(0);
              setGuideOpen(true);
            }}
            className="rounded-full bg-[#df3b39] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_25px_rgba(223,59,57,0.28)] transition hover:bg-[#c6312f]"
          >
            Click here for a step-by-step guide
          </button>
          {hasResolvedSearchState && !paymentDetailsOpen ? (
            <button
              type="button"
              onClick={scrollToTransactionSummary}
              disabled={!hasStartedCheckoutFlow}
              className="rounded-full bg-[#0f5b83] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Go to my Transaction Summary
            </button>
          ) : (
            <div />
          )}
          <div />
          {hasResolvedSearchState && !paymentDetailsOpen ? (
            <button
              type="button"
              onClick={scrollToTransactionSummary}
              className="rounded-md bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white"
            >
              My Cart ({cartItems.length})
            </button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
          {!hasResolvedSearchState ? (
            <div className="border-b border-slate-200 bg-white px-6 py-6 sm:px-10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#0f5b83]">QC Treasury Online Services</p>
                  <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.12em] text-slate-900 sm:text-[2.1rem]">
                    Real Property Tax Search
                  </h1>
                </div>
                <div className="max-w-xl text-sm leading-6 text-slate-600">
                  WARDS serves as a treasury-assisted online payment and validation workflow. Final payment validation and Official Receipt issuance remain under the authority of the selected Branch Treasury Office.
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
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Pending RPT Transaction</p>
                      <p className="mt-2 text-base font-semibold text-amber-950">
                        You already have an RPT online payment awaiting branch treasury action.
                      </p>
                      <p className="mt-2 text-sm leading-6 text-amber-900">
                        Reference: <span className="font-bold">{activePendingPayment.ref_number}</span> · Current stage:{' '}
                        <span className="font-bold">{String(activePendingPayment.workflow_status || activePendingPayment.status || 'Pending').replace(/_/g, ' ')}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/payment/status?ref=${encodeURIComponent(activePendingPayment.ref_number)}`)}
                      className="rounded-full bg-[#0f5b83] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
                    >
                      View Pending Transaction
                    </button>
                  </div>
                </div>
              ) : null}

              {!hasResolvedSearchState ? (
                <OutlineCard title="Search Property">
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                          Selected Branch
                        </label>
                        <select
                          value={selectedBranchId}
                          onChange={(event) => {
                            setSelectedBranchId(event.target.value);
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
                          className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-900 outline-none transition ${
                            validationErrors.branch ? 'border-red-500' : 'border-slate-300 focus:border-[#0f5b83]'
                          }`}
                        >
                          <option value="">Select Branch</option>
                          {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>
                              {branch.name} - {branch.location}
                            </option>
                          ))}
                        </select>
                        {validationErrors.branch ? <p className="mt-2 text-sm text-red-500">{validationErrors.branch}</p> : null}
                      </div>
                      <div className="rounded-[28px] border border-[#d6e5ef] bg-[#f7fbfe] px-5 py-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0f5b83]">Daily Search Allocation</p>
                        <p className="mt-2 text-2xl font-bold text-[#0f5b83]">{searchStats.searchesRemaining} / {searchStats.searchLimit}</p>
                        <p className="mt-1 text-sm text-slate-500">You have {searchStats.searchesRemaining} of {searchStats.searchLimit} searches remaining for today.</p>
                      </div>
                    </div>

                    <div className="text-center">
                      {linkedAssessments.length ? (
                        <div className="mx-auto mb-6 max-w-[980px] rounded-[26px] border border-[#d6e5ef] bg-[#f7fbfe] px-5 py-5 text-left">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0f5b83]">Verified RPT Assessments On Your Account</p>
                              <p className="mt-2 text-sm text-slate-500">Click a TDN below to auto-fill the search field with an admin-generated assessment record.</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{linkedAssessments.length} linked record{linkedAssessments.length === 1 ? '' : 's'}</span>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {linkedAssessments.map((assessment) => (
                              <button
                                key={assessment.id}
                                type="button"
                                onClick={() => setTdnInput((assessment.tdn || '').toUpperCase())}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-[#0f5b83] hover:bg-[#fbfdff]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-slate-900">{assessment.tdn}</p>
                                    <p className="mt-1 text-xs text-slate-500">{assessment.property_address || 'No property address recorded.'}</p>
                                  </div>
                                  <p className="text-xs font-semibold text-[#0f5b83]">{formatCurrency(assessment.final_total_amount_due || assessment.amount_due)}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Enter Tax Declaration Number</p>
                      <div className="mx-auto flex max-w-[820px] flex-col gap-4 md:flex-row">
                        <input
                          type="text"
                          value={tdnInput}
                          onChange={(event) => {
                            setTdnInput(event.target.value.toUpperCase());
                            setSearchError('');
                          }}
                          disabled={isSystemDisabled || isBlockedByPendingPayment}
                          placeholder="[ A-XXX-XXXXX ]"
                          className="w-full rounded-full border border-[#0f5b83] px-8 py-4 text-center text-xl tracking-[0.12em] text-slate-700 outline-none transition placeholder:text-slate-300 focus:bg-[#fbfdff]"
                        />
                        <button
                          type="button"
                          onClick={handleSearchProperty}
                          disabled={searchingProperty || isSystemDisabled || isBlockedByPendingPayment}
                          className="rounded-full bg-[#6f98ad] px-10 py-4 text-base font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#5b859a] disabled:opacity-50"
                        >
                          {searchingProperty ? 'Searching...' : 'Search'}
                        </button>
                      </div>
                    </div>

                    {searchError ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
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
                      Go Back to Search
                    </button>
                    <div className="text-slate-500 normal-case">
                      {selectedBranch?.name} {selectedBranch?.location ? <span>- {selectedBranch.location}</span> : null}
                    </div>
                  </div>

                  {!showPaymentOptionStage ? (
                    <OutlineCard title="Possible properties you might own">
                      <div className="overflow-hidden rounded-[24px] border border-slate-200">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-[#f8fbfe] text-slate-500">
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
                                <th className="px-4 py-3 text-left font-semibold">Tax Declaration No.</th>
                                <th className="px-4 py-3 text-left font-semibold">Name of Owner</th>
                                <th className="px-4 py-3 text-left font-semibold">Bill Expiry Date</th>
                                <th className="px-4 py-3 text-left font-semibold">Type</th>
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
                                <td className="px-4 py-4">Land</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl lg:flex-1">
                          <DetailStat label="Fair Market Value" value={formatCurrency(searchedProperty.fair_market_value)} />
                          <DetailStat label="Assessment Level" value={formatPercentage(searchedProperty.assessment_level)} />
                          <DetailStat label="Final Amount Due" value={formatCurrency(searchedProperty.final_total_amount_due)} tone="primary" />
                        </div>
                        <div className="flex flex-col items-start gap-3 sm:items-end">
                          <p className="text-sm text-slate-500">
                            Selected TDN: <span className="font-bold text-slate-900">{selectedSearchItems.length}</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              if (!selectedSearchItems.length) {
                                setSearchError('Please select at least one TDN before continuing.');
                                return;
                              }
                              if (isBlockedByPendingPayment) {
                                setSearchError('You already have a pending RPT online payment awaiting treasury action.');
                                return;
                              }
                              setSelectionConfirmationOpen(true);
                            }}
                            className="rounded-full bg-[#df3b39] px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-white transition hover:bg-[#c6312f]"
                          >
                            Go to Payment Option
                          </button>
                        </div>
                      </div>
                    </OutlineCard>
                  ) : (
                    <OutlineCard title="Selected Tax Declaration Number(s)">
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
                          Edit Selected TDN(s)
                        </button>
                        <button
                          type="button"
                          onClick={handleAddToCart}
                          disabled={isBlockedByPendingPayment}
                          className="rounded-full bg-[#df3b39] px-5 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f] disabled:opacity-50"
                        >
                          Add to Cart
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-[24px] border border-slate-200">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-[#f8fbfe] text-slate-500">
                              <tr>
                                <th className="px-4 py-3 text-left font-semibold">Tax Declaration No.</th>
                                <th className="px-4 py-3 text-left font-semibold">Name of Owner</th>
                                <th className="px-4 py-3 text-left font-semibold">Payment Option</th>
                                <th className="px-4 py-3 text-left font-semibold">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                              <tr>
                                <td className="px-4 py-4 font-semibold text-slate-900">{searchedProperty.tdn}</td>
                                <td className="px-4 py-4">{searchedProperty.taxpayer_name}</td>
                                <td className="px-4 py-4">{selectedPaymentOption ? (selectedPaymentOption === 'quarterly' ? 'Quarterly' : 'Full') : 'Not yet selected'}</td>
                                <td className="px-4 py-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStagedPaymentOption(selectedPaymentOption || 'full');
                                      setPaymentOptionModalOpen(true);
                                    }}
                                    className="font-semibold text-[#2570d5] transition hover:text-[#0f5b83]"
                                  >
                                    {selectedPaymentOption ? 'Edit Payment Option' : 'Select Payment Option'}
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
                          <DetailStat label="Discounts" value={formatCurrency(selectedCartPreviewItem.discounts)} tone="success" />
                          <DetailStat label="Total" value={formatCurrency(selectedCartPreviewItem.final_total_amount_due)} tone="primary" />
                        </div>
                      ) : null}
                    </OutlineCard>
                  )}

                  {searchError ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
                      {searchError}
                    </div>
                  ) : null}
                </>
              ) : null}

              {hasStartedCheckoutFlow && !paymentDetailsOpen ? (
                <div ref={transactionSummaryRef} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <OutlineCard title="My Cart">
                    {validationErrors.cart ? <p className="mb-4 text-sm text-red-500">{validationErrors.cart}</p> : null}
                    {!cartItems.length ? (
                      <div className="rounded-[26px] border border-dashed border-[#b7cfde] bg-[#fbfdff] px-6 py-12 text-center text-sm text-slate-500">
                        Search for a TDN and add it to your cart to continue.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="rounded-[24px] border border-slate-200 bg-[#fbfdff] p-5">
                          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f5b83]">Group Bill Set: ({cartItems.length} TDN)</p>
                          <div className="mt-4 space-y-4">
                            {cartItems.map((item) => (
                              <div key={item.tdn} className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="grid gap-1">
                                  <p className="text-sm font-bold text-slate-900">TDN: {item.tdn}</p>
                                  <p className="text-sm text-slate-600">Name of Owner: {item.taxpayer_name}</p>
                                  <p className="text-sm text-slate-600">Payment Mode: {item.payment_option || 'Full'}</p>
                                  <p className="text-sm text-slate-600">Bill Coverage: {item.bill_coverage || 'Full Year'}</p>
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
                            <DetailStat label="Amount Due" value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.basic_tax_due || 0) + Number(item.sef_tax || 0), 0))} />
                            <DetailStat label="SHTTC Applied" value={formatCurrency(0)} />
                            <DetailStat label="Discount" value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.discounts || 0), 0))} tone="success" />
                            <DetailStat label="Penalty Fee" value={formatCurrency(cartItems.reduce((sum, item) => sum + Number(item.penalties || 0), 0))} />
                            <DetailStat label="Total" value={formatCurrency(cartTotal)} tone="primary" />
                          </div>
                        </div>

                      </div>
                    )}
                  </OutlineCard>

                  <OutlineCard title="Transaction Summary" className="h-fit">
                    {!cartItems.length ? (
                      <p className="text-sm text-slate-500">Your transaction summary will appear here after you add a TDN to the cart.</p>
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
                          <span className="text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Total Amount</span>
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
                            Proceed to Payment
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPaymentConfirmationOpen(true)}
                            disabled={processing}
                            className="w-full rounded-full bg-[#df3b39] px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#c6312f] disabled:opacity-50"
                          >
                            {processing ? 'Redirecting to PayMongo...' : 'Open PayMongo Checkout'}
                          </button>
                        )}
                      </div>
                    )}
                  </OutlineCard>
                </div>
              ) : null}

              {hasStartedCheckoutFlow && paymentDetailsOpen ? (
                <OutlineCard title="Payment Details">
                  <div className="space-y-6">
                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={() => setPaymentDetailsOpen(false)}
                        className="rounded-full border border-[#0f5b83] bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#0f5b83] transition hover:bg-[#eef7fb]"
                      >
                        Back to Transaction Summary
                      </button>
                    </div>

                    <div className="rounded-[26px] bg-gradient-to-r from-[#0f5b83] to-[#1b6f9d] px-6 py-6 text-white shadow-[0_18px_36px_rgba(15,91,131,0.18)]">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-100">Amount to Pay</p>
                      <p className="mt-3 text-4xl font-bold">{formatCurrency(cartTotal)}</p>
                      <p className="mt-2 max-w-xl text-sm text-blue-100">The total is system-computed from the selected RPT entries and is read-only.</p>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Tax Type</label>
                        <input
                          type="text"
                          value="Real Property Tax"
                          readOnly
                          className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Taxpayer Name</label>
                        <input
                          type="text"
                          name="taxpayerName"
                          value={formData.taxpayerName}
                          onChange={handleFieldChange}
                          readOnly={Boolean(publicUser?.full_name)}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm ${
                            validationErrors.taxpayerName ? 'border-red-500' : 'border-slate-300'
                          } ${publicUser?.full_name ? 'bg-slate-50 text-slate-700' : 'text-slate-900'}`}
                        />
                        {validationErrors.taxpayerName ? <p className="mt-2 text-sm text-red-500">{validationErrors.taxpayerName}</p> : null}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">TIN</label>
                        <input
                          type="text"
                          name="tin"
                          value={formData.tin}
                          onChange={handleFieldChange}
                          maxLength={15}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm ${validationErrors.tin ? 'border-red-500' : 'border-slate-300'}`}
                        />
                        {validationErrors.tin ? <p className="mt-2 text-sm text-red-500">{validationErrors.tin}</p> : null}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Email Address</label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleFieldChange}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm ${validationErrors.email ? 'border-red-500' : 'border-slate-300'}`}
                        />
                        {validationErrors.email ? <p className="mt-2 text-sm text-red-500">{validationErrors.email}</p> : null}
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Mobile Number</label>
                        <input
                          type="tel"
                          name="contactNumber"
                          value={formData.contactNumber}
                          onChange={handleFieldChange}
                          placeholder="09XXXXXXXXX"
                          className={`w-full rounded-2xl border px-4 py-3 text-sm ${validationErrors.contactNumber ? 'border-red-500' : 'border-slate-300'}`}
                        />
                        {validationErrors.contactNumber ? <p className="mt-2 text-sm text-red-500">{validationErrors.contactNumber}</p> : null}
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Payment Method</p>
                      <div className="grid grid-cols-2 gap-3">
                        {PAYMENT_METHODS.map((method) => (
                          <button
                            key={method.id}
                            type="button"
                            onClick={() => {
                              setSelectedPaymentMethod(method.id);
                              if (method.id !== 'banking') setSelectedBank('');
                              resetGeneratedPayment();
                            }}
                            disabled={isBlockedByPendingPayment}
                            className={`rounded-[22px] border px-4 py-4 text-left transition ${
                              selectedPaymentMethod === method.id
                                ? 'border-[#0f5b83] bg-[#eef7fb] shadow-[0_12px_28px_rgba(15,91,131,0.12)]'
                                : 'border-slate-300 hover:border-[#0f5b83]'
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{method.icon}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{method.label}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedPaymentMethod === 'banking' ? (
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Select Bank</label>
                        <select
                          value={selectedBank}
                          onChange={(event) => {
                            setSelectedBank(event.target.value);
                            resetGeneratedPayment();
                          }}
                          disabled={isBlockedByPendingPayment}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm ${validationErrors.selectedBank ? 'border-red-500' : 'border-slate-300'}`}
                        >
                          <option value="">Choose a bank...</option>
                          {BANK_OPTIONS.map((bank) => (
                            <option key={bank.value} value={bank.value}>{bank.label}</option>
                          ))}
                        </select>
                        {validationErrors.selectedBank ? <p className="mt-2 text-sm text-red-500">{validationErrors.selectedBank}</p> : null}
                      </div>
                    ) : null}

                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                      <p className="font-bold text-slate-900">Treasury-Assisted Validation Reminder</p>
                      <p className="mt-2">
                        After successful PayMongo sandbox payment, the taxpayer must still upload payment proof. The selected branch treasury staff validates the transaction before Official Receipt release.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateReference}
                      disabled={generatingReference || isSystemDisabled || isBlockedByPendingPayment}
                      className="w-full rounded-full bg-[#0f5b83] px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white shadow-[0_12px_25px_rgba(15,91,131,0.18)] transition hover:bg-[#0c4d6f] disabled:opacity-50"
                    >
                      {generatingReference ? 'Generating Payment Reference...' : paymentReference ? 'Regenerate Payment Reference' : 'Generate Payment Reference'}
                    </button>

                    {paymentReference ? (
                      <div className="rounded-[24px] bg-emerald-50 px-5 py-5 ring-1 ring-emerald-200">
                        <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-800">Payment Summary</h4>
                        <div className="mt-4 space-y-3 text-sm text-slate-700">
                          <div className="flex justify-between gap-4"><span>WARDS Transaction Number</span><span className="font-semibold text-slate-900">{paymentReference.txnId}</span></div>
                          <div className="flex justify-between gap-4"><span>Payment Reference ID</span><span className="font-semibold text-slate-900">{paymentReference.refNumber}</span></div>
                          <div className="flex justify-between gap-4"><span>Selected Branch</span><span className="font-semibold text-slate-900">{selectedBranch?.name || 'N/A'}</span></div>
                          <div className="flex justify-between gap-4"><span>Cart Entries</span><span className="font-semibold text-slate-900">{paymentReference.cartItems?.length || cartItems.length}</span></div>
                          <div className="flex justify-between gap-4 border-t border-emerald-200 pt-3">
                            <span>Please verify the total amount to be paid.</span>
                            <span className="text-lg font-bold text-[#0f5b83]">{formatCurrency(paymentReference.amount)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPaymentConfirmationOpen(true)}
                          disabled={processing || isBlockedByPendingPayment}
                          className="mt-5 w-full rounded-full bg-emerald-600 px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {processing ? 'Redirecting to PayMongo...' : 'Continue to PayMongo'}
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
              aria-label="Close guide"
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="pr-10">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#0f5b83]">Instructions</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Online Payment of Real Property Tax</h2>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-[72px_minmax(0,1fr)_72px] md:items-center">
              <div className="flex justify-start md:justify-center">
                <button
                  type="button"
                  onClick={() => setGuideIndex((current) => (current === 0 ? GUIDE_SLIDES.length - 1 : current - 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
                  aria-label="Previous guide slide"
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
                        Step {guideIndex + 1} of {GUIDE_SLIDES.length}
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
                  {GUIDE_SLIDES.map((slide, index) => (
                    <button
                      key={slide.title}
                      type="button"
                      onClick={() => setGuideIndex(index)}
                      className={`h-3.5 w-3.5 rounded-full transition ${
                        guideIndex === index ? 'bg-[#0f5b83]' : 'bg-slate-300 hover:bg-slate-400'
                      }`}
                      aria-label={`Go to guide slide ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end md:justify-center">
                <button
                  type="button"
                  onClick={() => setGuideIndex((current) => (current === GUIDE_SLIDES.length - 1 ? 0 : current + 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
                  aria-label="Next guide slide"
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
              Choose a Payment Option ({searchedProperty.tdn})
            </h3>
            <p className="mt-2 text-center text-sm text-slate-500">
              Bill Coverage: current simulated RPT schedule
            </p>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setStagedPaymentOption('quarterly')}
                className={`rounded-[28px] border px-6 py-6 text-left transition ${
                  stagedPaymentOption === 'quarterly'
                    ? 'border-[#0f5b83] bg-[#f7fbfe] shadow-[0_14px_32px_rgba(15,91,131,0.14)]'
                    : 'border-slate-200 hover:border-[#0f5b83]'
                }`}
              >
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f5b83]">Payment Option 1: Quarterly</p>
                <div className="mt-5 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4"><span>Amount Due</span><span>{formatCurrency((Number(searchedProperty.basic_tax_due || 0) + Number(searchedProperty.sef_tax || 0)) / 4)}</span></div>
                  <div className="flex justify-between gap-4"><span>Discount</span><span>-{formatCurrency(searchedProperty.discounts)}</span></div>
                  <div className="flex justify-between gap-4"><span>Penalty Fee</span><span>{formatCurrency(searchedProperty.penalties)}</span></div>
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                    <span>Total</span>
                    <span>{formatCurrency(getQuarterlyAmount(searchedProperty))}</span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStagedPaymentOption('full')}
                className={`rounded-[28px] border px-6 py-6 text-left transition ${
                  stagedPaymentOption === 'full'
                    ? 'border-[#0f5b83] bg-[#f7fbfe] shadow-[0_14px_32px_rgba(15,91,131,0.14)]'
                    : 'border-slate-200 hover:border-[#0f5b83]'
                }`}
              >
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f5b83]">Payment Option 2: Full</p>
                <div className="mt-5 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4"><span>Amount Due</span><span>{formatCurrency(Number(searchedProperty.basic_tax_due || 0) + Number(searchedProperty.sef_tax || 0))}</span></div>
                  <div className="flex justify-between gap-4"><span>Discount</span><span>-{formatCurrency(searchedProperty.discounts)}</span></div>
                  <div className="flex justify-between gap-4"><span>Penalty Fee</span><span>{formatCurrency(searchedProperty.penalties)}</span></div>
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                    <span>Total</span>
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
                Cancel
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
                Confirm
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
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">Please verify the registered owner</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              Please verify that you are paying the RPT for <span className="font-bold">{pendingProperty.taxpayer_name}</span>.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={confirmOwnerMatch}
                className="rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={rejectOwnerMatch}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                No
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
            <h3 className="mt-5 text-center text-2xl font-bold text-slate-900">Successfully Added to Cart</h3>
            <button
              type="button"
              onClick={() => {
                setAddToCartSuccessOpen(false);
                scrollToTransactionSummary();
              }}
              className="mt-6 w-full rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
            >
              OK
            </button>
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
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">Add this amount to cart?</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              The computed amount of <span className="font-bold text-[#0f5b83]">{formatCurrency(searchedProperty.final_total_amount_due)}</span> for
              <span className="font-bold"> {searchedProperty.tdn}</span> will be added to your cart.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={confirmAddToCart}
                className="rounded-full bg-[#0f5b83] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setAddToCartConfirmationOpen(false)}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                No
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
            <h3 className="mt-5 text-center text-xl font-bold text-slate-900">Confirm payment details</h3>
            <p className="mt-4 text-center text-base leading-7 text-slate-700">
              Total amount to be paid: <span className="font-bold text-[#0f5b83]">{formatCurrency(paymentReference.amount)}</span>
            </p>
            <p className="mt-2 text-center text-sm leading-6 text-slate-500">
              If the details are correct, continue to PayMongo sandbox checkout. Otherwise, go back and update your cart or payment details.
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
                Yes
              </button>
              <button
                type="button"
                onClick={() => setPaymentConfirmationOpen(false)}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-400"
              >
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default PayTaxesRPT;
