import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import { paymentAPI, receiptAPI } from '../../services/api';
import PaymentGatewayExperience from '../../components/PaymentGatewayExperience';
import { getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../../utils/publicSession';
import { getEmailValidationMessage } from '../../utils/validation';
import { appendLanguageParam, usePublicLanguage } from '../../utils/publicLanguage';
import { safeReplace, safeNavigate } from '../../utils/urlValidator';

const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX = 'activeReceiptRequestId';
const RECEIPT_REQUEST_REASONS = [
  'Lost original receipt',
  'Damaged receipt',
  'Personal record keeping',
  'Accounting requirement',
  'Bank or loan requirement',
  'Government compliance',
  'Other',
];
const getTodayDateValue = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const STATUS_TRANSLATIONS = {
  'Payment Pending': { en: 'Payment Pending', tl: 'Naghihintay ng Bayad' },
  Pending: { en: 'Pending', tl: 'Naghihintay' },
  'Not Ready for Release': { en: 'Not Ready for Release', tl: 'Hindi Pa Handa Para I-release' },
  'Ready for Release': { en: 'Ready for Release', tl: 'Handa Na Para I-release' },
  Released: { en: 'Released', tl: 'Na-release na' },
  'Under Validation': { en: 'Under Validation', tl: 'Sinasailalim sa Beripikasyon' },
  Processing: { en: 'Processing', tl: 'Pinoproseso' },
  Completed: { en: 'Completed', tl: 'Nakumpleto' },
  Rejected: { en: 'Rejected', tl: 'Tinanggihan' },
  Cancelled: { en: 'Cancelled', tl: 'Kinansela' },
  Verified: { en: 'Verified', tl: 'Na-verify' },
  'Pending Transaction': { en: 'Pending Transaction', tl: 'Naghihintay ng Transaksyon' },
};

const RECEIPT_REASON_TRANSLATIONS = {
  'Lost original receipt': { en: 'Lost original receipt', tl: 'Nawalang orihinal na resibo' },
  'Damaged receipt': { en: 'Damaged receipt', tl: 'Sirang resibo' },
  'Personal record keeping': { en: 'Personal record keeping', tl: 'Personal na Pagtatala ng Rekord' },
  'Accounting requirement': { en: 'Accounting requirement', tl: 'Kinakailangan sa accounting' },
  'Bank or loan requirement': { en: 'Bank or loan requirement', tl: 'Kinakailangan ng bangko o loan' },
  'Government compliance': { en: 'Government compliance', tl: 'Pagsunod sa requirement ng gobyerno' },
  Other: { en: 'Other', tl: 'Iba pa' },
};

const TAX_TYPE_TRANSLATIONS = {
  RPT: { en: 'RPT', tl: 'RPT' },
  BUSINESS: { en: 'BT', tl: 'BT' },
  MISC: { en: 'MISC', tl: 'MISC' },
  CTC: { en: 'CTC', tl: 'CTC' },
  PTR: { en: 'PTR', tl: 'PTR' },
  MARKET: { en: 'MARKET', tl: 'MARKET' },
};

const buildReceiptRequestStorageKey = (email) => {
  const normalizedEmail = (email || 'public-user').trim().toLowerCase();
  return `${ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX}:${normalizedEmail}:standalone`;
};

const lockedFieldClasses = 'w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-700';

const RequestReceipt = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [storedUser, setStoredUser] = useState(() => getStoredPublicUser());
  const [language] = usePublicLanguage();
  const authenticatedProfileName = (storedUser?.full_name || '').trim();
  const [branches, setBranches] = useState([]);
  const [branchServices, setBranchServices] = useState([]);
  const [requestStatus, setRequestStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [requestConfirmed, setRequestConfirmed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const [selectedBank, setSelectedBank] = useState('');
  const [paymentCustomer, setPaymentCustomer] = useState({
    name: authenticatedProfileName,
    email: storedUser?.email || '',
    mobile: storedUser?.contact_number || '',
  });
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [systemStatus, setSystemStatus] = useState(null);

  const text = language === 'tl'
    ? {
        defaultDisabledMessage: 'Ang serbisyong ito ay kasalukuyang hindi magagamit dahil ito ay hindi pinagana ng system administration.',
        failedToLoadBranches: 'Hindi ma-load ang mga branch.',
        onlineServices: 'Online Services',
        title: 'Humiling ng Kopya ng Opisyal na Resibo',
        heroDescription: 'Isumite online ang iyong request para sa kopya ng resibo. Kapag na-validate ng branch ang request at nakumpleto ang bayad, dadaan ang iyong receipt copy sa release workflow.',
        requestDetails: 'Detalye ng Request',
        requestDetailsDescription: 'Kumpletuhin ang mga kinakailangang detalye sa ibaba upang ma-validate ng branch ang iyong request para sa kopya ng resibo.',
        fullName: 'Buong Pangalan',
        enterFullName: 'Ilagay ang iyong buong pangalan',
        emailAddress: 'Email Address',
        emailPlaceholder: 'iyong.email@example.com',
        taxType: 'Uri ng Buwis',
        transactionDate: 'Petsa ng Transaksyon',
        branch: 'Branch',
        selectBranch: 'Pumili ng Branch',
        reasonForRequest: 'Dahilan ng Request',
        customReason: 'Custom na Dahilan',
        customReasonPlaceholder: 'Ilagay ang iyong dahilan sa paghingi ng kopya ng resibo',
        referenceNumber: 'Reference Number',
        optional: '(Opsyonal)',
        referencePlaceholder: 'Ilagay ang transaction reference number kung mayroon',
        submitting: 'Isinusumite...',
        submitRequest: 'Isumite ang Request',
        howItWorks: 'Paano Ito Gumagana',
        step1: '1. Isumite online ang request para sa kopya ng resibo kasama ang detalye ng iyong transaksyon.',
        step2: '2. Bayaran ang request fee sa pamamagitan ng online payment gateway.',
        step3: '3. Iva-validate ng branch ang request at ihahanda ang release copy.',
        step4: '4. Kapag na-release na, ipapadala ang kopya sa iyong email.',
        requestStatus: 'Status ng Request',
        paymentDetails: 'Detalye ng Bayad',
        requestFeeCheckout: 'Checkout ng Bayad sa Request',
        openingPaymentWindow: 'Binubuksan ang secure payment window...',
        openingPaymentWindowDescription: 'Mangyaring maghintay habang nire-redirect ka sa PayMongo. Panatilihing bukas ang tab na ito upang makumpleto ang bayad para sa iyong receipt request.',
        requestId: 'Request ID',
        overallStatus: 'Kabuuang Status',
        assignedBranch: 'Nakatalagang Branch',
        reasonForRequestStatus: 'Dahilan ng Request',
        paymentStatus: 'Status ng Bayad',
        paymentChannel: 'Payment Channel',
        releaseStatus: 'Status ng Release',
        confirm: 'Kumpirmahin',
        requestFee: 'Bayad sa Request',
        requestFeeDescription: 'Kumpletuhin ang online payment upang magpatuloy ang branch release workflow.',
        paymentRecordedPendingVerification: 'Naitala na ang bayad. Ang iyong request ay naghihintay na ngayon ng beripikasyon ng Branch Admin bago magpatuloy ang release.',
        paymentRecordedInWorkflow: 'Naitala na ang bayad. Ang iyong request ay dumadaan na ngayon sa branch release workflow.',
        goToPayTaxesOnline: 'Pumunta sa Pay Taxes Online',
        emptyStatus: '',
        pleaseFillRequired: 'Mangyaring punan ang lahat ng kinakailangang field.',
        provideCustomReason: 'Mangyaring ilagay ang iyong custom na dahilan ng request.',
        correctHighlightedEmail: 'Mangyaring ayusin ang naka-highlight na email field.',
        taxpayerLettersOnly: 'Ang pangalan ng taxpayer ay dapat mga letra lamang.',
        correctTaxpayerName: 'Mangyaring ayusin ang field ng pangalan ng taxpayer.',
        failedToSubmit: 'Hindi naisumite ang request para sa resibo.',
        paymentCheckoutMissing: 'Hindi natanggap ang payment checkout URL. Pakisubukang muli.',
        failedToProcessFee: 'Hindi naproseso ang bayad para sa request fee.',
        notYetAssigned: 'Hindi pa naitatalaga',
        notApplicable: 'Wala',
      }
    : {
        defaultDisabledMessage: 'This service is currently unavailable because it has been disabled by system administration.',
        failedToLoadBranches: 'Failed to load branches.',
        onlineServices: 'Online Services',
        title: 'Request Official Receipt Copy',
        heroDescription: 'Submit your receipt copy request online. Once the branch validates the request and the fee is completed, your receipt copy will move through the release workflow.',
        requestDetails: 'Request Details',
        requestDetailsDescription: 'Complete the required details below for the branch to validate your receipt copy request.',
        fullName: 'Full Name',
        enterFullName: 'Enter your full name',
        emailAddress: 'Email Address',
        emailPlaceholder: 'your.email@example.com',
        taxType: 'Tax Type',
        transactionDate: 'Transaction Date',
        branch: 'Branch',
        selectBranch: 'Select Branch',
        reasonForRequest: 'Reason for Request',
        customReason: 'Custom Reason',
        customReasonPlaceholder: 'Enter your reason for requesting a receipt copy',
        referenceNumber: 'Reference Number',
        optional: '(Optional)',
        referencePlaceholder: 'Enter transaction reference number if available',
        submitting: 'Submitting...',
        submitRequest: 'Submit Request',
        howItWorks: 'How It Works',
        step1: '1. Submit the online receipt copy request with your transaction details.',
        step2: '2. Pay the request fee through the online payment gateway.',
        step3: '3. The branch validates the request and prepares the release copy.',
        step4: '4. Once released, the finished copy is sent through the branch release workflow.',
        requestStatus: 'Request Status',
        paymentDetails: 'Payment Details',
        requestFeeCheckout: 'Request Fee Checkout',
        openingPaymentWindow: 'Opening secure payment window...',
        openingPaymentWindowDescription: 'Please wait while we redirect you to PayMongo. Keep this tab open to complete your receipt request payment.',
        requestId: 'Request ID',
        overallStatus: 'Overall Status',
        assignedBranch: 'Assigned Branch',
        reasonForRequestStatus: 'Reason for Request',
        paymentStatus: 'Payment Status',
        paymentChannel: 'Payment Channel',
        releaseStatus: 'Release Status',
        confirm: 'Confirm',
        requestFee: 'Request Fee',
        requestFeeDescription: 'Complete the online payment to continue the branch release workflow.',
        paymentRecordedPendingVerification: 'Payment recorded. Your request is now waiting for Branch Admin verification before release can continue.',
        paymentRecordedInWorkflow: 'Payment recorded. Your request is now moving through the branch release workflow.',
        goToPayTaxesOnline: 'Go to Pay Taxes Online',
        emptyStatus: '',
        pleaseFillRequired: 'Please fill all required fields.',
        provideCustomReason: 'Please provide your custom reason for request.',
        correctHighlightedEmail: 'Please correct the highlighted email field.',
        taxpayerLettersOnly: 'Taxpayer name must contain letters only.',
        correctTaxpayerName: 'Please correct the taxpayer name field.',
        failedToSubmit: 'Failed to submit receipt request.',
        paymentCheckoutMissing: 'Payment checkout URL not received. Please try again.',
        failedToProcessFee: 'Failed to process the request fee payment.',
        notYetAssigned: 'Not yet assigned',
        notApplicable: 'N/A',
      };

  const localizeReceiptReason = (value) => {
    const entry = RECEIPT_REASON_TRANSLATIONS[value];
    return entry ? entry[language] : value;
  };

  const localizeStatusValue = (value) => {
    const entry = STATUS_TRANSLATIONS[value];
    return entry ? entry[language] : value;
  };

  const localizeTaxType = (value) => {
    const entry = TAX_TYPE_TRANSLATIONS[value];
    return entry ? entry[language] : value;
  };

  const localizePaymentMethod = (value) => {
    const normalized = String(value || '').trim().replaceAll('_', ' ');
    return normalized || text.notApplicable;
  };

  const localizeEmailError = (message) => {
    if (!message || language === 'en') {
      return message;
    }
    const mappings = {
      'Email address is required.': 'Kailangan ang email address.',
      'Enter a valid email address.': 'Maglagay ng wastong email address.',
      'Use only one @ symbol in the email address.': 'Gumamit lamang ng isang @ symbol sa email address.',
      'Email address is too long.': 'Masyadong mahaba ang email address.',
      'Email address contains invalid characters.': 'May hindi wastong mga character ang email address.',
    };
    return mappings[message] || message;
  };

  const localizeModuleError = (message) => {
    if (!message || language === 'en') {
      return message;
    }
    const mappings = {
      [DEFAULT_DISABLED_MESSAGE]: text.defaultDisabledMessage,
      'Failed to load branches.': text.failedToLoadBranches,
      'Please fill all required fields.': text.pleaseFillRequired,
      'Please provide your custom reason for request.': text.provideCustomReason,
      'Please correct the highlighted email field.': text.correctHighlightedEmail,
      'Taxpayer name must contain letters only.': text.taxpayerLettersOnly,
      'Please correct the taxpayer name field.': text.correctTaxpayerName,
      'Failed to submit receipt request.': text.failedToSubmit,
      'Payment checkout URL not received. Please try again.': text.paymentCheckoutMissing,
      'Failed to process the request fee payment.': text.failedToProcessFee,
    };
    return mappings[message] || message;
  };

  const todayDate = useMemo(() => getTodayDateValue(), []);
  const activeReceiptRequestStorageKey = useMemo(
    () => buildReceiptRequestStorageKey(storedUser?.email),
    [storedUser]
  );
  const isStandaloneNameLocked = Boolean(authenticatedProfileName);
  const namePattern = useMemo(() => /^[A-Za-z.\-' ]+$/, []);

  const [formData, setFormData] = useState({
    taxpayerName: authenticatedProfileName,
    taxType: 'RPT',
    requestReason: RECEIPT_REQUEST_REASONS[0],
    requestReasonOther: '',
    branchId: '',
    txnDate: getTodayDateValue(),
    refNumber: '',
    email: storedUser?.email || '',
  });
  const selectedBranch = useMemo(
    () => branches.find((branch) => String(branch.id) === String(formData.branchId)) || null,
    [branches, formData.branchId]
  );

  useEffect(() => {
    setFormData((current) => ({
      ...current,
      taxpayerName: authenticatedProfileName || current.taxpayerName || '',
      email: storedUser?.email || current.email || '',
    }));
    setPaymentCustomer((current) => ({
      ...current,
      name: authenticatedProfileName || current.name || '',
      email: storedUser?.email || current.email || '',
      mobile: storedUser?.contact_number || current.mobile || '',
    }));
  }, [authenticatedProfileName, storedUser]);

  useEffect(() => {
    const syncStoredUser = () => {
      const latestUser = getStoredPublicUser();
      setStoredUser(latestUser);
    };

    window.addEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
    window.addEventListener('focus', syncStoredUser);
    return () => {
      window.removeEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
      window.removeEventListener('focus', syncStoredUser);
    };
  }, []);

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const [branchesResponse, statusResponse] = await Promise.all([
          axios.get('http://localhost:8000/api/public/branches'),
          axios.get('http://localhost:8000/api/public/system-status'),
        ]);
        setBranches(branchesResponse.data);
        setSystemStatus(statusResponse.data);
      } catch (err) {
        setError(err.response?.data?.detail || text.failedToLoadBranches);
      }
    };

    fetchContext();
  }, [text.failedToLoadBranches]);

  useEffect(() => {
    const legacyRequestId = localStorage.getItem('activeReceiptRequestId');
    if (legacyRequestId && !localStorage.getItem(activeReceiptRequestStorageKey)) {
      localStorage.setItem(activeReceiptRequestStorageKey, legacyRequestId);
    }
    localStorage.removeItem('activeReceiptRequestId');

    if (searchParams.get('new') === '1') {
      localStorage.removeItem(activeReceiptRequestStorageKey);
      setRequestStatus(null);
      setRequestConfirmed(false);
      navigate(appendLanguageParam('/request-receipt', language), { replace: true });
      return;
    }

    const activeRequestId = localStorage.getItem(activeReceiptRequestStorageKey);
    if (!activeRequestId) {
      setRequestStatus(null);
      return;
    }

    receiptAPI.getRequestStatus(activeRequestId)
      .then((response) => {
        setRequestStatus(response.data);
        setRequestConfirmed(Boolean(response.data?.feePaid));
        if (['Released', 'Completed'].includes(response.data?.overallStatus || response.data?.status)) {
          localStorage.removeItem(activeReceiptRequestStorageKey);
        }
      })
      .catch(() => {
        localStorage.removeItem(activeReceiptRequestStorageKey);
        setRequestStatus(null);
        setRequestConfirmed(false);
      });
  }, [activeReceiptRequestStorageKey, language, navigate, searchParams]);

  useEffect(() => {
    const selectedBranchId = Number(formData.branchId);
    if (!selectedBranchId) {
      setBranchServices([]);
      return;
    }

    axios.get(`http://localhost:8000/api/public/branches/${selectedBranchId}`)
      .then((response) => {
        const nextServices = response.data?.services || [];
        setBranchServices(nextServices);
        setFormData((current) => ({
          ...current,
          taxType: nextServices.some((service) => service.name === current.taxType)
            ? current.taxType
            : (nextServices[0]?.name || current.taxType),
        }));
      })
      .catch((err) => {
        setBranchServices([]);
        setError(err.response?.data?.detail || text.failedToLoadBranches);
      });
  }, [formData.branchId, text.failedToLoadBranches]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;

    if (name === 'taxpayerName' && isStandaloneNameLocked) {
      return;
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
      ...(name === 'requestReason' && value !== 'Other' ? { requestReasonOther: '' } : {}),
    }));

    if (name === 'taxpayerName') {
      const trimmed = value.trim();
      setNameError(trimmed && !namePattern.test(trimmed) ? text.taxpayerLettersOnly : '');
    }

    if (name === 'email') {
      setEmailError(localizeEmailError(getEmailValidationMessage(value)));
    }

    setError('');
  };

  const handleSubmitRequest = async () => {
    if (!systemStatus?.receiptRequestEnabled) {
      setError(systemStatus?.disabledMessage || text.defaultDisabledMessage);
      return;
    }

    if (!formData.taxpayerName || !formData.taxType || !formData.branchId || !formData.txnDate || !formData.email || !formData.requestReason) {
      setError(text.pleaseFillRequired);
      return;
    }

    if (formData.requestReason === 'Other' && !formData.requestReasonOther.trim()) {
      setError(text.provideCustomReason);
      return;
    }

    const nextEmailError = getEmailValidationMessage(formData.email);
    if (nextEmailError) {
      setEmailError(localizeEmailError(nextEmailError));
      setError(text.correctHighlightedEmail);
      return;
    }

    if (!namePattern.test(formData.taxpayerName.trim())) {
      setNameError(text.taxpayerLettersOnly);
      setError(text.correctTaxpayerName);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await receiptAPI.requestCopy(formData);
      setRequestStatus(response.data);
      setRequestConfirmed(false);
      localStorage.setItem(activeReceiptRequestStorageKey, response.data.requestId);
    } catch (err) {
      setError(err.response?.data?.detail || text.failedToSubmit);
    } finally {
      setLoading(false);
    }
  };

  const handlePayFee = async (requestIdOverride = null, checkoutDetails = {}) => {
    if (!systemStatus?.paymentGatewayEnabled) {
      setError(systemStatus?.disabledMessage || text.defaultDisabledMessage);
      return;
    }

    const resolvedRequestId = requestIdOverride || requestStatus?.requestId;
    if (!resolvedRequestId) {
      return;
    }

    setPaying(true);
    setError('');
    let checkoutWindow = null;

    try {
      checkoutWindow = window.open('', 'wardsReceiptCheckout');

      if (checkoutWindow) {
        // Build loading page with safe DOM APIs — no blob URL, no document.write
        const doc = checkoutWindow.document;
        doc.title = text.requestFeeCheckout;

        const style = doc.createElement('style');
        style.textContent = 'body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1f2937;}';
        doc.head.appendChild(style);

        const container = doc.createElement('div');
        container.style.cssText = 'text-align:center;max-width:420px;padding:24px;';

        const heading = doc.createElement('h2');
        heading.style.marginBottom = '12px';
        heading.textContent = text.openingPaymentWindow;

        const paragraph = doc.createElement('p');
        paragraph.style.lineHeight = '1.5';
        paragraph.textContent = text.openingPaymentWindowDescription;

        container.appendChild(heading);
        container.appendChild(paragraph);
        doc.body.appendChild(container);
      }

      const paymentContext = requestStatus || {};
      const checkoutCustomer = checkoutDetails.customer || paymentCustomer;
      const initiateResponse = await receiptAPI.payRequestFee(resolvedRequestId, {
        paymentMethod: checkoutDetails.method || paymentMethod,
        email: paymentContext.email || checkoutCustomer.email || formData.email,
        taxpayerName: paymentContext.taxpayerName || checkoutCustomer.name || formData.taxpayerName,
        transactionDate: paymentContext.transactionDate || formData.txnDate,
        branchId: paymentContext.branchId || Number(formData.branchId) || null,
        taxType: paymentContext.taxType || formData.taxType,
      });

      setRequestStatus((current) => (
        current
          ? {
              ...current,
              requestId: initiateResponse.data.requestId || current.requestId,
              paymentRefNumber: initiateResponse.data.paymentRefNumber || current.paymentRefNumber,
              paymentStatus: initiateResponse.data.status || current.paymentStatus,
              payment: {
                ...(current.payment || {}),
                refNumber: initiateResponse.data.paymentRefNumber || current.payment?.refNumber,
                status: initiateResponse.data.status || current.payment?.status,
                amount: initiateResponse.data.amount ?? current.payment?.amount,
                paymentMethod: checkoutDetails.method || paymentMethod,
              },
            }
          : current
      ));

      if (initiateResponse.data.requestId) {
        localStorage.setItem(activeReceiptRequestStorageKey, initiateResponse.data.requestId);
      }

      const paymentResponse = await paymentAPI.processPayment({
        refNumber: initiateResponse.data.paymentRefNumber,
        paymentMethod: checkoutDetails.method || paymentMethod,
        bankCode: checkoutDetails.bankCode || undefined,
      });

      if (paymentResponse.data.checkoutUrl) {
        const paymentStatusPath = appendLanguageParam(
          `/payment/status?ref=${encodeURIComponent(paymentResponse.data.refNumber || initiateResponse.data.paymentRefNumber)}&receiptFlow=standalone`,
          language
        );
        if (checkoutWindow && !checkoutWindow.closed) {
          safeReplace(paymentResponse.data.checkoutUrl, checkoutWindow);
          navigate(paymentStatusPath);
          return;
        }

        safeNavigate(paymentResponse.data.checkoutUrl);
        return;
      }

      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close();
      }

      setError(text.paymentCheckoutMissing);
    } catch (err) {
      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close();
      }
      setError(err.response?.data?.detail || text.failedToProcessFee);
    } finally {
      setPaying(false);
    }
  };

  const assignedBranchLabel = requestStatus?.branchName || selectedBranch?.name || text.notYetAssigned;

  return (
    <section className="min-h-screen bg-slate-50 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="bg-gradient-to-r from-[#0f2f5f] via-[#17457f] to-[#2b6cb0] px-8 py-10 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">{text.onlineServices}</p>
            <h2 className="mt-3 text-3xl font-bold">{text.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-blue-50">{text.heroDescription}</p>
          </div>

          <div className="px-6 py-8 md:px-8">
            {error ? (
              <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
                <p className="font-semibold">{localizeModuleError(error)}</p>
              </div>
            ) : null}

            {systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode) ? (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
                <p className="font-semibold">{systemStatus.disabledMessage || text.defaultDisabledMessage}</p>
              </div>
            ) : null}

            <div className={requestStatus ? `mx-auto ${requestConfirmed ? 'max-w-6xl' : 'max-w-2xl'}` : 'grid gap-8 xl:grid-cols-[1.25fr,0.75fr]'}>
              {!requestStatus ? (
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-bold text-slate-900">{text.requestDetails}</h3>
                  <p className="mt-1 text-sm text-slate-500">{text.requestDetailsDescription}</p>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.fullName}</label>
                      <input
                        type="text"
                        name="taxpayerName"
                        value={formData.taxpayerName}
                        onChange={handleInputChange}
                        readOnly={isStandaloneNameLocked}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder={text.enterFullName}
                        className={isStandaloneNameLocked ? lockedFieldClasses : `w-full rounded-2xl border px-4 py-3 ${nameError ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'} focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100`}
                      />
                      {nameError ? <p className="mt-2 text-sm font-medium text-rose-600">{nameError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.emailAddress}</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder={text.emailPlaceholder}
                        className={`w-full rounded-2xl border px-4 py-3 ${emailError ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'} focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100`}
                      />
                      {emailError ? <p className="mt-2 text-sm font-medium text-rose-600">{emailError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.taxType}</label>
                      <select
                        name="taxType"
                        value={formData.taxType}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {branchServices.length ? branchServices.map((service) => (
                          <option key={service.code || service.name} value={service.name}>
                            {localizeTaxType(service.name)}
                          </option>
                        )) : (
                          <>
                            <option value="RPT">{localizeTaxType('RPT')}</option>
                            <option value="BUSINESS">{localizeTaxType('BUSINESS')}</option>
                            <option value="MISC">{localizeTaxType('MISC')}</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.transactionDate}</label>
                      <input
                        type="date"
                        name="txnDate"
                        value={formData.txnDate}
                        onChange={handleInputChange}
                        max={todayDate}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.branch}</label>
                      <select
                        name="branchId"
                        value={formData.branchId}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="">{text.selectBranch}</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">{text.reasonForRequest}</label>
                      <select
                        name="requestReason"
                        value={formData.requestReason}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {RECEIPT_REQUEST_REASONS.map((reason) => (
                          <option key={reason} value={reason}>{localizeReceiptReason(reason)}</option>
                        ))}
                      </select>
                    </div>

                    {formData.requestReason === 'Other' ? (
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">{text.customReason}</label>
                        <input
                          type="text"
                          name="requestReasonOther"
                          value={formData.requestReasonOther}
                          onChange={handleInputChange}
                          maxLength={255}
                          disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                          placeholder={text.customReasonPlaceholder}
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    ) : null}

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        {text.referenceNumber} <span className="text-slate-400">{text.optional}</span>
                      </label>
                      <input
                        type="text"
                        name="refNumber"
                        value={formData.refNumber}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder={text.referencePlaceholder}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>

                  </div>
                </div>

                <button
                  onClick={handleSubmitRequest}
                  disabled={loading || (systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                  className="w-full rounded-2xl bg-[#0f2f5f] px-5 py-4 text-lg font-semibold text-white transition hover:bg-[#19498d] disabled:opacity-50"
                >
                  {loading ? text.submitting : text.submitRequest}
                </button>
              </div>
              ) : null}

              <div className="space-y-6">
                {!requestStatus ? (
                <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">{text.howItWorks}</p>
                  <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
                    <p>{text.step1}</p>
                    <p>{text.step2}</p>
                    <p>{text.step3}</p>
                    <p>{text.step4}</p>
                  </div>
                </div>
                ) : null}

                {requestStatus ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-xl font-bold text-slate-900">{requestConfirmed ? text.paymentDetails : text.requestStatus}</h3>
                    {!requestConfirmed ? (
                    <>
                    <div className="mt-5 space-y-3">
                      {[
                        [text.requestId, requestStatus.requestId],
                        [text.overallStatus, localizeStatusValue(requestStatus.overallStatus || requestStatus.status)],
                        [text.assignedBranch, assignedBranchLabel],
                        [text.taxType, localizeTaxType(requestStatus.taxType)],
                        [text.reasonForRequestStatus, requestStatus.requestReason === 'Other' ? (requestStatus.requestReasonOther || localizeReceiptReason('Other')) : localizeReceiptReason(requestStatus.requestReason)],
                        [text.paymentStatus, localizeStatusValue(requestStatus.paymentStatus || 'Pending')],
                        [text.releaseStatus, localizeStatusValue(requestStatus.releaseStatus || 'Not Ready for Release')],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <span className="text-sm font-semibold text-slate-600">{label}</span>
                          <span className="text-right text-sm font-semibold text-slate-900">{value || text.notApplicable}</span>
                        </div>
                      ))}
                    </div>
                    {!requestStatus.feePaid ? (
                      <button
                        type="button"
                        onClick={() => setRequestConfirmed(true)}
                        className="mt-6 w-full rounded-2xl bg-[#0f2f5f] px-5 py-3 font-semibold text-white transition hover:bg-[#19498d]"
                      >
                        {text.confirm}
                      </button>
                    ) : null}
                    </>
                    ) : null}

                    {!requestStatus.feePaid && requestConfirmed ? (
                      <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-emerald-900">{text.requestFee}</p>
                            <p className="mt-1 text-sm text-emerald-800">{text.requestFeeDescription}</p>
                          </div>
                          <p className="text-2xl font-bold text-emerald-700">P200.00</p>
                        </div>
                        <div className="mt-5">
                          <PaymentGatewayExperience
                            amount={200}
                            bankCode={selectedBank}
                            customer={{
                              name: paymentCustomer.name || requestStatus.taxpayerName || formData.taxpayerName,
                              email: paymentCustomer.email || requestStatus.email || formData.email,
                              mobile: paymentCustomer.mobile,
                            }}
                            disabled={Boolean(systemStatus && (!systemStatus.paymentGatewayEnabled || systemStatus.maintenanceMode))}
                            method={paymentMethod}
                            onBankChange={setSelectedBank}
                            onCustomerChange={setPaymentCustomer}
                            onMethodChange={(nextMethod) => {
                              setPaymentMethod(nextMethod);
                              setSelectedBank('');
                            }}
                            onContinue={(details) => handlePayFee(null, details)}
                            processing={paying}
                            referenceNumber={requestStatus.requestId}
                            title={text.requestFeeCheckout}
                            language={language}
                          />
                        </div>
                      </div>
                    ) : requestStatus.feePaid ? (
                      <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800">
                        {requestStatus.paymentStatus === 'Pending Transaction'
                          ? text.paymentRecordedPendingVerification
                          : text.paymentRecordedInWorkflow}
                      </div>
                    ) : null}

                    {requestStatus.nextAction === 'Wait for Branch Release' ? (
                      <button
                        onClick={() => navigate('/pay-taxes')}
                        className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-100 px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-200"
                      >
                        {text.goToPayTaxesOnline}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RequestReceipt;
