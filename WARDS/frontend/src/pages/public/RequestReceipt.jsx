import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import axios from 'axios';
import { paymentAPI, receiptAPI } from '../../services/api';
import { getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../../utils/publicSession';
import { getEmailValidationMessage } from '../../utils/validation';

const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX = 'activeReceiptRequestId';
const PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY = 'wardsPendingReceiptQueueLink';
const VIEW_TICKET_MODAL_QUERY = '?modal=ticket';
const getTodayDateValue = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const formatAppointmentAvailabilityMessage = (availability) => {
  if (!availability) {
    return 'Appointments are currently unavailable for the selected branch schedule.';
  }

  if (availability.status === 'before_effective_date') {
    return 'Today is not yet open for appointment booking at this branch. Please contact the branch or use an immediate request if available.';
  }

  if (availability.status === 'fully_booked') {
    return 'No appointment times are available for the selected date. Please choose another date or branch.';
  }

  return (
    availability.message ||
    'Appointments are currently unavailable for the selected branch schedule. Please choose another available time.'
  );
};

const deriveTaxTypeFromService = (serviceType) => {
  const normalized = (serviceType || '').trim().toLowerCase();
  if (normalized.includes('real property') || normalized.includes('rpt') || normalized.includes('amilyar')) {
    return 'RPT';
  }
  if (normalized.includes('business') || normalized === 'bt' || normalized.includes('permit')) {
    return 'BUSINESS';
  }
  return 'MISC';
};

const lockedFieldClasses = 'w-full px-4 py-3 border border-slate-200 rounded-lg bg-slate-100 text-slate-700 cursor-not-allowed';
const buildReceiptRequestStorageKey = (email, workflow, queueNumber = '') => {
  const normalizedEmail = (email || 'public-user').trim().toLowerCase();
  const normalizedQueueNumber = (queueNumber || '').trim();
  return workflow === 'queue-link'
    ? `${ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX}:${normalizedEmail}:queue:${normalizedQueueNumber || 'unlinked'}`
    : `${ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX}:${normalizedEmail}:standalone`;
};

const RequestReceipt = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [storedUser, setStoredUser] = useState(() => getStoredPublicUser());
  const isQueueLinkMode = searchParams.get('mode') === 'queue-link';
  const shouldStartNewStandaloneRequest = !isQueueLinkMode && searchParams.get('new') === '1';
  const linkedQueueFromNavigation = isQueueLinkMode ? (location.state?.linkedQueue || null) : null;
  const linkedQueueFromStorage = useMemo(() => {
    if (!isQueueLinkMode) {
      return null;
    }

    try {
      const parsed = JSON.parse(sessionStorage.getItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY) || 'null');
      if (!parsed?.queueNumber) {
        return null;
      }
      const storedEmail = (storedUser?.email || '').trim().toLowerCase();
      const contextEmail = (parsed?.email || '').trim().toLowerCase();
      if (storedEmail && contextEmail && storedEmail !== contextEmail) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, [isQueueLinkMode, storedUser]);
  const linkedQueue = linkedQueueFromNavigation || linkedQueueFromStorage;
  const activeReceiptRequestStorageKey = useMemo(
    () => buildReceiptRequestStorageKey(storedUser?.email, isQueueLinkMode ? 'queue-link' : 'standalone', linkedQueue?.queueNumber),
    [storedUser, isQueueLinkMode, linkedQueue]
  );
  const standaloneReceiptRequestStorageKey = useMemo(
    () => buildReceiptRequestStorageKey(storedUser?.email, 'standalone'),
    [storedUser]
  );
  const authenticatedProfileName = (storedUser?.full_name || '').trim();
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState({
    taxpayerName: authenticatedProfileName,
    taxType: 'RPT',
    requestType: 'Immediate',
    branchId: '',
    txnDate: getTodayDateValue(),
    refNumber: '',
    email: '',
    appointmentDate: '',
    appointmentSlot: '',
  });
  const [paymentOption, setPaymentOption] = useState('pay_online');
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const [requestStatus, setRequestStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [appointmentError, setAppointmentError] = useState('');
  const [appointmentAvailability, setAppointmentAvailability] = useState(null);
  const [appointmentAvailabilityLoading, setAppointmentAvailabilityLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState(null);
  const namePattern = useMemo(() => /^[A-Za-z.\-' ]+$/, []);
  const todayDate = useMemo(() => getTodayDateValue(), []);
  const selectedBranch = useMemo(
    () => branches.find((branch) => String(branch.id) === String(formData.branchId)) || null,
    [branches, formData.branchId]
  );
  const isLinkedToActiveQueue = Boolean(linkedQueue?.queueNumber);
  const isStandaloneNameLocked = !isLinkedToActiveQueue && Boolean(authenticatedProfileName);
  const shouldShowViewMyTicketAction = isQueueLinkMode && isLinkedToActiveQueue;
  const canUseOverTheCounter = isQueueLinkMode && isLinkedToActiveQueue;
  const needsAppointmentBranch = formData.requestType === 'Appointment' && !selectedBranch;
  const appointmentTimeDisabledReason = useMemo(() => {
    if (formData.requestType !== 'Appointment') {
      return '';
    }
    if (!selectedBranch) {
      return 'Please select a branch first so we can load its operating hours and available appointment times.';
    }
    if (appointmentAvailabilityLoading) {
      return 'Loading today\'s available appointment times for the selected branch...';
    }
    if (appointmentError) {
      return appointmentError;
    }
    if (appointmentAvailability && !appointmentAvailability.is_available) {
      return formatAppointmentAvailabilityMessage(appointmentAvailability);
    }
    if (appointmentAvailability?.is_available && !(appointmentAvailability.available_slots || []).length) {
      return 'No appointment times are available for the selected date. Please choose another date.';
    }
    return '';
  }, [
    appointmentAvailability,
    appointmentAvailabilityLoading,
    appointmentError,
    formData.requestType,
    selectedBranch,
  ]);

  const resetForAnotherRequest = () => {
    setRequestStatus(null);
    setPaymentOption('pay_online');
    setPaymentMethod('gcash');
    setError('');
    setNameError('');
    setFormData({
      taxpayerName: authenticatedProfileName,
      taxType: 'RPT',
      requestType: 'Immediate',
      branchId: '',
      txnDate: todayDate,
      refNumber: '',
      email: storedUser?.email || '',
      appointmentDate: '',
      appointmentSlot: '',
    });
    setAppointmentError('');
    setAppointmentAvailability(null);
    localStorage.removeItem(standaloneReceiptRequestStorageKey);
    navigate('/request-receipt', { replace: true });
  };

  const handleViewMyTicket = () => {
    sessionStorage.removeItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY);
    navigate(`/${VIEW_TICKET_MODAL_QUERY}`);
  };

  useEffect(() => {
    const syncStoredUser = () => {
      const latestUser = getStoredPublicUser();
      setStoredUser(latestUser);
      setFormData((current) => ({
        ...current,
        taxpayerName: isLinkedToActiveQueue
          ? (current.taxpayerName || linkedQueue?.taxpayerName || '')
          : ((latestUser?.full_name || '').trim()),
        email: current.email || linkedQueue?.email || latestUser?.email || '',
      }));
    };

    syncStoredUser();
    window.addEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
    window.addEventListener('focus', syncStoredUser);
    return () => {
      window.removeEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
      window.removeEventListener('focus', syncStoredUser);
    };
  }, [isLinkedToActiveQueue, linkedQueue]);

  useEffect(() => {
    if (!isQueueLinkMode) {
      sessionStorage.removeItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY);
      return;
    }

    if (linkedQueueFromNavigation?.queueNumber) {
      sessionStorage.setItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY, JSON.stringify(linkedQueueFromNavigation));
      return;
    }

    if (!linkedQueueFromStorage?.queueNumber) {
      sessionStorage.removeItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY);
    }
  }, [isQueueLinkMode, linkedQueueFromNavigation, linkedQueueFromStorage]);

  useEffect(() => {
    if (!canUseOverTheCounter && paymentOption !== 'pay_online') {
      setPaymentOption('pay_online');
    }
  }, [canUseOverTheCounter, paymentOption]);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const [branchesResponse, statusResponse] = await Promise.all([
          axios.get('http://localhost:8000/api/public/branches'),
          axios.get('http://localhost:8000/api/public/system-status'),
        ]);
        setBranches(branchesResponse.data);
        setSystemStatus(statusResponse.data);
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load branches.');
      }
    };

    setFormData((current) => ({
      ...current,
      taxpayerName: linkedQueue?.taxpayerName || authenticatedProfileName || current.taxpayerName || '',
      taxType: linkedQueue?.serviceType ? deriveTaxTypeFromService(linkedQueue.serviceType) : current.taxType,
      requestType: linkedQueue?.queueType === 'appointment' ? 'Appointment' : current.requestType,
      branchId: current.branchId || linkedQueue?.branchId || '',
      txnDate: todayDate,
      email: current.email || linkedQueue?.email || storedUser?.email || '',
    }));

    fetchBranches();
  }, [linkedQueue, storedUser, todayDate, authenticatedProfileName]);

  useEffect(() => {
    const legacyRequestId = localStorage.getItem('activeReceiptRequestId');
    if (legacyRequestId && !isQueueLinkMode && !localStorage.getItem(standaloneReceiptRequestStorageKey)) {
      localStorage.setItem(standaloneReceiptRequestStorageKey, legacyRequestId);
    }
    localStorage.removeItem('activeReceiptRequestId');

    if (shouldStartNewStandaloneRequest) {
      localStorage.removeItem(standaloneReceiptRequestStorageKey);
      setRequestStatus(null);
      navigate('/request-receipt', { replace: true });
      return;
    }

    const activeRequestId = localStorage.getItem(activeReceiptRequestStorageKey);
    if (!activeRequestId) {
      setRequestStatus(null);
      return;
    }

    receiptAPI.getRequestStatus(activeRequestId)
      .then((response) => {
        const responseQueueNumber = (response.data?.linkedQueueNumber || '').trim();
        const activeQueueNumber = (linkedQueue?.queueNumber || '').trim();
        const belongsToCurrentWorkflow = isQueueLinkMode
          ? Boolean(responseQueueNumber) && responseQueueNumber === activeQueueNumber
          : !responseQueueNumber;

        if (!belongsToCurrentWorkflow) {
          localStorage.removeItem(activeReceiptRequestStorageKey);
          setRequestStatus(null);
          return;
        }

        setRequestStatus(response.data);
        if (['Released', 'Completed'].includes(response.data?.overallStatus || response.data?.status)) {
          localStorage.removeItem(activeReceiptRequestStorageKey);
        }
      })
      .catch(() => {
        localStorage.removeItem(activeReceiptRequestStorageKey);
        setRequestStatus(null);
      });
  }, [
    activeReceiptRequestStorageKey,
    isQueueLinkMode,
    linkedQueue,
    navigate,
    shouldStartNewStandaloneRequest,
    standaloneReceiptRequestStorageKey,
  ]);

  useEffect(() => {
    if (formData.requestType !== 'Appointment') {
      setAppointmentAvailability(null);
      setAppointmentAvailabilityLoading(false);
      setAppointmentError('');
      return;
    }

    if (!selectedBranch) {
      setAppointmentAvailability(null);
      return;
    }
    if (isLinkedToActiveQueue && linkedQueue?.queueType === 'appointment') {
      setAppointmentAvailability(null);
      setAppointmentAvailabilityLoading(false);
      setAppointmentError('');
      return;
    }

    let isActive = true;

    const fetchAppointmentAvailability = async () => {
      try {
        setAppointmentAvailabilityLoading(true);
        const response = await axios.get(`http://localhost:8000/api/public/branches/${selectedBranch.id}/appointment-availability`, {
          params: { date: todayDate },
        });
        if (!isActive) {
          return;
        }

        setAppointmentAvailability(response.data);
        if (!response.data?.is_available) {
          setAppointmentError(formatAppointmentAvailabilityMessage(response.data));
          setFormData((current) => ({ ...current, appointmentSlot: '' }));
          return;
        }

        const slotStillValid = response.data.available_slots?.some((slot) => slot.value === formData.appointmentSlot);
        if (!slotStillValid) {
          setFormData((current) => ({ ...current, appointmentSlot: '' }));
        }
        setAppointmentError('');
      } catch (availabilityError) {
        if (!isActive) {
          return;
        }
        setAppointmentAvailability(null);
        setAppointmentError(
          availabilityError.response?.data?.detail ||
            'Appointments are currently unavailable for the selected branch schedule. Please choose another available time.'
        );
        setFormData((current) => ({ ...current, appointmentSlot: '' }));
      } finally {
        if (isActive) {
          setAppointmentAvailabilityLoading(false);
        }
      }
    };

    fetchAppointmentAvailability();

    return () => {
      isActive = false;
    };
  }, [selectedBranch, formData.requestType, formData.appointmentSlot, todayDate, isLinkedToActiveQueue, linkedQueue]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    if ((isLinkedToActiveQueue || isStandaloneNameLocked) && ['taxpayerName'].includes(name)) {
      return;
    }
    if (isLinkedToActiveQueue && ['taxType', 'txnDate'].includes(name)) {
      return;
    }
    setFormData((current) => {
      const nextData = { ...current, [name]: value };

      if (name === 'requestType' && value !== 'Appointment') {
        nextData.appointmentDate = '';
        nextData.appointmentSlot = '';
      }

      if (name === 'requestType' && value === 'Appointment') {
        nextData.appointmentDate = todayDate;
        nextData.appointmentSlot = '';
      }

      if (name === 'branchId') {
        nextData.appointmentSlot = '';
      }

      return nextData;
    });
    if (name === 'taxpayerName') {
      const trimmed = value.trim();
      setNameError(trimmed && !namePattern.test(trimmed) ? 'Taxpayer name must contain letters only.' : '');
    }
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }
    if (name === 'requestType' && value !== 'Appointment') {
      setAppointmentError('');
      setAppointmentAvailability(null);
    }
    if (name === 'appointmentSlot' || name === 'branchId') {
      setAppointmentError('');
    }
  };

  const buildAppointmentDateTime = () => {
    if (formData.requestType !== 'Appointment') {
      return null;
    }
    if (isLinkedToActiveQueue && linkedQueue?.queueType === 'appointment') {
      return linkedQueue.appointmentTime || null;
    }

    if (!formData.appointmentSlot) {
      setAppointmentError('Please select an appointment time within the branch operating hours.');
      return null;
    }

    const isoValue = `${todayDate}T${formData.appointmentSlot}:00`;
    const appointmentDateTime = new Date(isoValue);

    if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime < new Date()) {
      setAppointmentError('Appointment date and time must be from the current date onward.');
      return null;
    }

    if (!appointmentAvailability?.is_available) {
      setAppointmentError(formatAppointmentAvailabilityMessage(appointmentAvailability));
      return null;
    }

    const slotStillAvailable = appointmentAvailability?.available_slots?.some((slot) => slot.value === formData.appointmentSlot);
    if (!slotStillAvailable) {
      setAppointmentError('The selected appointment slot is no longer available. Please choose another available time.');
      return null;
    }

    setAppointmentError('');
    return isoValue;
  };

  const handleSubmitRequest = async () => {
    if (!systemStatus?.receiptRequestEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    if (!formData.taxpayerName || !formData.taxType || !formData.branchId || !formData.txnDate || !formData.email) {
      setError('Please fill all required fields.');
      return;
    }
    const nextEmailError = getEmailValidationMessage(formData.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      return;
    }
    if (!namePattern.test(formData.taxpayerName.trim())) {
      setNameError('Taxpayer name must contain letters only.');
      return;
    }
    const appointmentDateTime = buildAppointmentDateTime();
    if (formData.requestType === 'Appointment' && !appointmentDateTime) {
      setError('Please choose an appointment time within branch operating hours.');
      return;
    }
    if (paymentOption === 'over_the_counter' && !canUseOverTheCounter) {
      setError('Over-the-counter payment is only available when this receipt request comes from a registered queue number.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await receiptAPI.requestCopy({
        ...formData,
        txnDate: todayDate,
        linkedQueueNumber: linkedQueue?.queueNumber || null,
        linkToActiveQueue: isLinkedToActiveQueue && isQueueLinkMode,
        appointmentDate: formData.requestType === 'Appointment' ? todayDate : null,
        appointmentSlot: formData.requestType === 'Appointment' ? formData.appointmentSlot : null,
      });
      setRequestStatus(response.data);
      localStorage.setItem(activeReceiptRequestStorageKey, response.data.requestId);
      sessionStorage.removeItem(PENDING_RECEIPT_QUEUE_LINK_STORAGE_KEY);
      if (paymentOption === 'over_the_counter' && canUseOverTheCounter) {
        const otcResponse = await receiptAPI.payRequestFee(response.data.requestId, { paymentMethod: 'over_the_counter' });
        setRequestStatus((current) => (
          current
            ? {
                ...current,
                paymentStatus: otcResponse.data.status,
                payment: {
                  ...(current.payment || {}),
                  refNumber: otcResponse.data.paymentRefNumber,
                  status: otcResponse.data.status,
                  amount: otcResponse.data.amount,
                  paymentMethod: otcResponse.data.paymentMethod,
                },
                paymentRefNumber: otcResponse.data.paymentRefNumber,
                nextAction: 'Pay at Branch Counter',
              }
            : current
        ));
        return;
      }
      // Removed automatic payment for queue-linked requests - user must manually click "Pay Request Fee" button
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit receipt request.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayFee = async (requestIdOverride = null) => {
    if (!systemStatus?.paymentGatewayEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
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
        checkoutWindow.document.write(`
          <html>
            <head><title>Opening PayMongo Checkout</title></head>
            <body style="font-family: Arial, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#f8fafc; color:#1f2937;">
              <div style="text-align:center; max-width:420px; padding:24px;">
                <h2 style="margin-bottom:12px;">Opening secure payment window...</h2>
                <p style="line-height:1.5;">Please wait while we redirect you to PayMongo. Keep this tab open to complete your receipt request payment.</p>
              </div>
            </body>
          </html>
        `);
        checkoutWindow.document.close();
      }

      const paymentContext = requestStatus || {};
      const initiateResponse = await receiptAPI.payRequestFee(resolvedRequestId, {
        paymentMethod,
        email: paymentContext.email || formData.email,
        taxpayerName: paymentContext.taxpayerName || formData.taxpayerName,
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
                paymentMethod: paymentMethod,
              },
            }
          : current
      ));
      if (initiateResponse.data.requestId) {
        localStorage.setItem(activeReceiptRequestStorageKey, initiateResponse.data.requestId);
      }
      const paymentResponse = await paymentAPI.processPayment({
        refNumber: initiateResponse.data.paymentRefNumber,
        paymentMethod,
      });

      if (paymentResponse.data.checkoutUrl) {
        const paymentStatusPath = `/payment/status?ref=${encodeURIComponent(paymentResponse.data.refNumber || initiateResponse.data.paymentRefNumber)}&receiptFlow=${encodeURIComponent(isQueueLinkMode ? 'queue-link' : 'standalone')}`;
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.location.replace(paymentResponse.data.checkoutUrl);
          navigate(paymentStatusPath);
          return;
        }

        window.location.href = paymentResponse.data.checkoutUrl;
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
      setError(err.response?.data?.detail || 'Failed to process the request fee payment.');
    } finally {
      setPaying(false);
    }
  };

  const assignedBranchLabel = requestStatus?.branchName || selectedBranch?.name || 'Not yet assigned';

  return (
    <section className="py-16 bg-white min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-lightbg rounded-xl shadow-lg p-8">
          <h2 className="text-3xl font-bold text-primary mb-4">Request Official Receipt Copy</h2>
          <p className="text-gray-600 mb-8">
            Submit your receipt requisition here. If a verified branch receipt record matches your reference, the request will move through the branch release flow automatically after payment.
          </p>

          {error && (
            <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
              <p className="font-semibold">{error}</p>
            </div>
          )}

          {systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode) && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
              <p className="font-semibold">{systemStatus.disabledMessage || DEFAULT_DISABLED_MESSAGE}</p>
            </div>
          )}

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">{isLinkedToActiveQueue ? 'Name' : 'Full Name'}</label>
                <input
                  type="text"
                  name="taxpayerName"
                  value={formData.taxpayerName}
                  onChange={handleInputChange}
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                  readOnly={isLinkedToActiveQueue || isStandaloneNameLocked}
                  placeholder="Enter your full name"
                  className={(isLinkedToActiveQueue || isStandaloneNameLocked) ? lockedFieldClasses : `w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${nameError ? 'border-red-400' : 'border-gray-300'}`}
                />
                {nameError && <p className="mt-2 text-sm text-red-600">{nameError}</p>}
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Transaction Date</label>
                <input
                  type="date"
                  name="txnDate"
                  value={formData.txnDate}
                  onChange={handleInputChange}
                  disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)) || isLinkedToActiveQueue}
                  readOnly={isLinkedToActiveQueue}
                  max={todayDate}
                  className={isLinkedToActiveQueue ? lockedFieldClasses : 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent'}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Tax Type</label>
                <select
                  name="taxType"
                  value={formData.taxType}
                  onChange={handleInputChange}
                  disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)) || isLinkedToActiveQueue}
                  className={isLinkedToActiveQueue ? lockedFieldClasses : 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent'}
                >
                  <option value="RPT">RPT</option>
                  <option value="BUSINESS">BT</option>
                  <option value="MISC">MISC</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Request Type</label>
                <select
                  name="requestType"
                  value={formData.requestType}
                  onChange={handleInputChange}
                  disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)) || isLinkedToActiveQueue}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                >
                  <option value="Immediate">Immediate</option>
                  <option value="Appointment">By Appointment</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Branch</label>
                <select
                  name="branchId"
                  value={formData.branchId}
                  onChange={handleInputChange}
                  disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)) || isLinkedToActiveQueue}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
                {needsAppointmentBranch && (
                  <p className="mt-2 text-sm font-medium text-amber-700">
                    Please select a branch first. Appointment times are loaded from that branch&apos;s operating hours.
                  </p>
                )}
              </div>
            </div>

            {isLinkedToActiveQueue && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This receipt request will be linked to your active queue number <span className="font-semibold">{linkedQueue.queueNumber}</span> for {linkedQueue.branchName || 'your selected branch'}.
                {linkedQueue.queueType === 'appointment' && linkedQueue.appointmentTime ? ' The existing appointment schedule on that queue will also be reused.' : ''}
              </div>
            )}

            {formData.requestType === 'Appointment' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Appointment Date</label>
                  <input
                    type="text"
                    value={todayDate}
                    readOnly
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-slate-50 text-slate-700"
                  />
                  <p className="mt-2 text-sm font-medium text-blue-700">
                    Appointment requests use today&apos;s schedule. You only need to choose a time.
                  </p>
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Appointment Time</label>
                  {isLinkedToActiveQueue && linkedQueue?.queueType === 'appointment' ? (
                    <>
                      <input
                        type="text"
                        value={linkedQueue.appointmentTime ? new Date(linkedQueue.appointmentTime).toLocaleString() : 'Inherited from active queue'}
                        readOnly
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-slate-50 text-slate-700"
                      />
                      <p className="mt-2 text-sm font-medium text-blue-700">
                        The appointment schedule from your active queue number will be reused for this receipt request.
                      </p>
                    </>
                  ) : (
                    <>
                      <select
                        name="appointmentSlot"
                        value={formData.appointmentSlot}
                        onChange={handleInputChange}
                        disabled={
                          Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)) ||
                          !selectedBranch ||
                          appointmentAvailabilityLoading ||
                          !appointmentAvailability?.is_available
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                      >
                        <option value="">
                          {appointmentAvailabilityLoading
                            ? 'Loading available times...'
                            : !selectedBranch
                              ? 'Select branch first'
                              : appointmentAvailability?.is_available
                                ? 'Select available time'
                                : 'No available time slots for today'}
                        </option>
                        {(appointmentAvailability?.available_slots || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {appointmentTimeDisabledReason && (
                        <p className="mt-2 text-sm font-medium text-amber-700">
                          {appointmentTimeDisabledReason}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {appointmentAvailability?.is_available && appointmentAvailability?.time_settings && (
                  <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    Choose only from the selected branch's published operating hours for that day.
                    If a time becomes unavailable before submission, the system will block it and ask you to choose another valid slot.
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                Reference Number <span className="text-gray-400">(Optional)</span>
              </label>
              <input
                type="text"
                name="refNumber"
                value={formData.refNumber}
                onChange={handleInputChange}
                disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                placeholder="Enter transaction reference number if available"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Email Address</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                readOnly={isLinkedToActiveQueue}
                placeholder="your.email@example.com"
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                  emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
              />
              {emailError && <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">Payment Method</h3>
              {canUseOverTheCounter ? (
                <>
                  <p className="mt-1 text-sm text-slate-600">
                    Choose whether to pay at the branch counter or continue to the online payment gateway after submitting this queue-linked receipt request.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label
                      className={`rounded-xl border px-4 py-4 transition cursor-pointer ${
                        paymentOption === 'over_the_counter'
                          ? 'border-amber-500 bg-amber-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="payment_option"
                          value="over_the_counter"
                          checked={paymentOption === 'over_the_counter'}
                          onChange={(event) => setPaymentOption(event.target.value)}
                          className="mt-1 h-4 w-4 border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">Over the Counter</p>
                          <p className="mt-1 text-sm text-slate-600">Pay directly at the assigned branch.</p>
                          <p className="mt-1 text-sm text-slate-600">Receipt request is submitted without online payment.</p>
                        </div>
                      </div>
                    </label>
                    <label
                      className={`rounded-xl border px-4 py-4 transition cursor-pointer ${
                        paymentOption === 'pay_online'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="payment_option"
                          value="pay_online"
                          checked={paymentOption === 'pay_online'}
                          onChange={(event) => setPaymentOption(event.target.value)}
                          className="mt-1 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">Pay Online</p>
                          <p className="mt-1 text-sm text-slate-600">Proceed to the payment gateway after submitting the receipt request.</p>
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
                  <p className="font-semibold text-blue-900">Pay Online</p>
                  <p className="mt-1 text-sm text-blue-800">This standalone receipt request flow uses online payment only.</p>
                  <p className="mt-1 text-sm text-blue-800">You will proceed to the payment gateway after submitting the receipt request.</p>
                </div>
              )}
              <div className="mt-4">
                <label className="block text-gray-700 font-semibold mb-2">Online Payment Channel</label>
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  disabled={paymentOption !== 'pay_online'}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                    paymentOption === 'pay_online'
                      ? 'border-gray-300 bg-white'
                      : 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="card">Card</option>
                  <option value="banking">Online Banking</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleSubmitRequest}
              disabled={loading || (systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
              className="w-full bg-accent hover:bg-blue-600 text-white py-4 rounded-lg font-semibold transition duration-300 shadow-lg text-lg disabled:opacity-50"
            >
              {loading ? 'Submitting...' : paymentOption === 'pay_online' ? 'Submit Request and Pay Online' : 'Submit Request'}
            </button>
          </div>

          {requestStatus && (
            <div className="mt-8 bg-white border-2 border-accent rounded-xl p-6">
              <h3 className="text-xl font-bold text-primary mb-4">Request Status</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Request ID:</span>
                  <span className="text-lg font-bold text-accent">{requestStatus.requestId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Status:</span>
                  <span className="px-3 py-1 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800">
                    {requestStatus.overallStatus || requestStatus.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Matched Receipt Record:</span>
                  <span className={`font-semibold ${requestStatus.matchedReceipt ? 'text-green-700' : 'text-orange-700'}`}>
                    {requestStatus.matchedReceipt ? 'Found in branch records' : 'Not yet matched'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Assigned Branch:</span>
                  <span className="font-semibold text-gray-900">{assignedBranchLabel}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Payment Status:</span>
                  <span className="font-semibold text-gray-900">{requestStatus.paymentStatus || 'Pending'}</span>
                </div>
                {requestStatus.payment?.paymentMethod && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700 font-medium">Payment Method:</span>
                    <span className="font-semibold text-gray-900 capitalize">{String(requestStatus.payment.paymentMethod).replaceAll('_', ' ')}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Release Status:</span>
                  <span className="font-semibold text-gray-900">{requestStatus.releaseStatus || 'Not Ready for Release'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Tax Type:</span>
                  <span className="font-semibold text-gray-900">{requestStatus.taxType}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Request Type:</span>
                  <span className="font-semibold text-gray-900">{requestStatus.requestType}</span>
                </div>
                {requestStatus.appointmentTime && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700 font-medium">Appointment Schedule:</span>
                    <span className="font-semibold text-gray-900">
                      {new Date(requestStatus.appointmentTime).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {!requestStatus.feePaid && requestStatus.paymentStatus !== 'Pending Over-the-Counter Payment' && (
                <div className="mt-6 border-t pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-700 font-medium">Request Fee Amount:</span>
                    <span className="text-xl font-bold text-red-600">P200.00</span>
                  </div>

                  <div className="mb-4">
                    <label className="block text-gray-700 font-semibold mb-2">Payment Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                    >
                      <option value="gcash">GCash</option>
                      <option value="maya">Maya</option>
                      <option value="card">Card</option>
                      <option value="banking">Online Banking</option>
                    </select>
                  </div>

                  <button
                    onClick={handlePayFee}
                    disabled={paying || (systemStatus && (!systemStatus.paymentGatewayEnabled || systemStatus.maintenanceMode))}
                    className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
                  >
                    {paying ? 'Processing Payment...' : 'Pay Request Fee'}
                  </button>
                  {systemStatus && (!systemStatus.paymentGatewayEnabled || systemStatus.maintenanceMode) && (
                    <p className="mt-3 text-sm font-medium text-amber-800">
                      {systemStatus.disabledMessage || DEFAULT_DISABLED_MESSAGE}
                    </p>
                  )}
                </div>
              )}

              {requestStatus.feePaid && (
                <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
                  Payment recorded. The request is now connected to the selected branch workflow.
                </div>
              )}

              {!requestStatus.feePaid && requestStatus.paymentStatus === 'Pending Over-the-Counter Payment' && (
                <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                  This request has been recorded for over-the-counter payment. Please present your linked queue number and request ID at the branch to settle the receipt request fee.
                </div>
              )}

              {shouldShowViewMyTicketAction ? (
                <button
                  onClick={handleViewMyTicket}
                  className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition duration-300"
                >
                  View My Ticket
                </button>
              ) : null}

              {requestStatus.nextAction === 'Wait for Branch Release' ? (
                <button
                  onClick={() => navigate('/pay-taxes')}
                  className="mt-3 w-full bg-slate-100 hover:bg-slate-200 text-slate-800 py-3 rounded-lg font-semibold transition duration-300 border border-slate-300"
                >
                  Go to Pay Taxes Online
                </button>
              ) : null}

            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default RequestReceipt;
