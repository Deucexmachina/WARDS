import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import { paymentAPI, receiptAPI } from '../../services/api';
import PaymentGatewayExperience from '../../components/PaymentGatewayExperience';
import { getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../../utils/publicSession';
import { getEmailValidationMessage } from '../../utils/validation';

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

const buildReceiptRequestStorageKey = (email) => {
  const normalizedEmail = (email || 'public-user').trim().toLowerCase();
  return `${ACTIVE_RECEIPT_REQUEST_STORAGE_KEY_PREFIX}:${normalizedEmail}:standalone`;
};

const lockedFieldClasses = 'w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-700';

const RequestReceipt = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [storedUser, setStoredUser] = useState(() => getStoredPublicUser());
  const authenticatedProfileName = (storedUser?.full_name || '').trim();
  const [branches, setBranches] = useState([]);
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
        setError(err.response?.data?.detail || 'Failed to load branches.');
      }
    };

    fetchContext();
  }, []);

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
  }, [activeReceiptRequestStorageKey, navigate, searchParams]);

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
      setNameError(trimmed && !namePattern.test(trimmed) ? 'Taxpayer name must contain letters only.' : '');
    }

    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }

    setError('');
  };

  const handleSubmitRequest = async () => {
    if (!systemStatus?.receiptRequestEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }

    if (!formData.taxpayerName || !formData.taxType || !formData.branchId || !formData.txnDate || !formData.email || !formData.requestReason) {
      setError('Please fill all required fields.');
      return;
    }

    if (formData.requestReason === 'Other' && !formData.requestReasonOther.trim()) {
      setError('Please provide your custom reason for request.');
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
      setError('Please correct the taxpayer name field.');
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
      setError(err.response?.data?.detail || 'Failed to submit receipt request.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayFee = async (requestIdOverride = null, checkoutDetails = {}) => {
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
        const paymentStatusPath = `/payment/status?ref=${encodeURIComponent(paymentResponse.data.refNumber || initiateResponse.data.paymentRefNumber)}&receiptFlow=standalone`;
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
    <section className="min-h-screen bg-slate-50 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="bg-gradient-to-r from-[#0f2f5f] via-[#17457f] to-[#2b6cb0] px-8 py-10 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">Online Services</p>
            <h2 className="mt-3 text-3xl font-bold">Request Official Receipt Copy</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-blue-50">
              Submit your receipt copy request online. Once the branch validates the request and the fee is completed,
              your receipt copy will move through the release workflow.
            </p>
          </div>

          <div className="px-6 py-8 md:px-8">
            {error ? (
              <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
                <p className="font-semibold">{error}</p>
              </div>
            ) : null}

            {systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode) ? (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
                <p className="font-semibold">{systemStatus.disabledMessage || DEFAULT_DISABLED_MESSAGE}</p>
              </div>
            ) : null}

            <div className={requestStatus ? `mx-auto ${requestConfirmed ? 'max-w-6xl' : 'max-w-2xl'}` : 'grid gap-8 xl:grid-cols-[1.25fr,0.75fr]'}>
              {!requestStatus ? (
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="text-lg font-bold text-slate-900">Request Details</h3>
                  <p className="mt-1 text-sm text-slate-500">Complete the required details below for the branch to validate your receipt copy request.</p>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                      <input
                        type="text"
                        name="taxpayerName"
                        value={formData.taxpayerName}
                        onChange={handleInputChange}
                        readOnly={isStandaloneNameLocked}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder="Enter your full name"
                        className={isStandaloneNameLocked ? lockedFieldClasses : `w-full rounded-2xl border px-4 py-3 ${nameError ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'} focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100`}
                      />
                      {nameError ? <p className="mt-2 text-sm font-medium text-rose-600">{nameError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder="your.email@example.com"
                        className={`w-full rounded-2xl border px-4 py-3 ${emailError ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'} focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100`}
                      />
                      {emailError ? <p className="mt-2 text-sm font-medium text-rose-600">{emailError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Tax Type</label>
                      <select
                        name="taxType"
                        value={formData.taxType}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="RPT">RPT</option>
                        <option value="BUSINESS">BT</option>
                        <option value="MISC">MISC</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Transaction Date</label>
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
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Branch</label>
                      <select
                        name="branchId"
                        value={formData.branchId}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="">Select branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Reason for Request</label>
                      <select
                        name="requestReason"
                        value={formData.requestReason}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {RECEIPT_REQUEST_REASONS.map((reason) => (
                          <option key={reason} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </div>

                    {formData.requestReason === 'Other' ? (
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Custom Reason</label>
                        <input
                          type="text"
                          name="requestReasonOther"
                          value={formData.requestReasonOther}
                          onChange={handleInputChange}
                          maxLength={255}
                          disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                          placeholder="Enter your reason for requesting a receipt copy"
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    ) : null}

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Reference Number <span className="text-slate-400">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        name="refNumber"
                        value={formData.refNumber}
                        onChange={handleInputChange}
                        disabled={Boolean(systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
                        placeholder="Enter transaction reference number if available"
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
                  {loading ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
              ) : null}

              <div className="space-y-6">
                {!requestStatus ? (
                <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">How It Works</p>
                  <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
                    <p>1. Submit the online receipt copy request with your transaction details.</p>
                    <p>2. Pay the request fee through the online payment gateway.</p>
                    <p>3. The branch validates the request and prepares the release copy.</p>
                    <p>4. Once released, the finished copy is sent through the branch release workflow.</p>
                  </div>
                </div>
                ) : null}

                {requestStatus ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-xl font-bold text-slate-900">{requestConfirmed ? 'Payment Details' : 'Request Status'}</h3>
                    {!requestConfirmed ? (
                    <>
                    <div className="mt-5 space-y-3">
                      {[
                        ['Request ID', requestStatus.requestId],
                        ['Overall Status', requestStatus.overallStatus || requestStatus.status],
                        ['Assigned Branch', assignedBranchLabel],
                        ['Tax Type', requestStatus.taxType],
                        ['Reason for Request', requestStatus.requestReason === 'Other' ? (requestStatus.requestReasonOther || 'Other') : requestStatus.requestReason],
                        ['Payment Status', requestStatus.paymentStatus || 'Pending'],
                        ['Payment Channel', requestStatus.payment?.paymentMethod ? String(requestStatus.payment.paymentMethod).replaceAll('_', ' ') : paymentMethod.replaceAll('_', ' ')],
                        ['Release Status', requestStatus.releaseStatus || 'Not Ready for Release'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <span className="text-sm font-semibold text-slate-600">{label}</span>
                          <span className="text-right text-sm font-semibold text-slate-900">{value || 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                    {!requestStatus.feePaid ? (
                      <button
                        type="button"
                        onClick={() => setRequestConfirmed(true)}
                        className="mt-6 w-full rounded-2xl bg-[#0f2f5f] px-5 py-3 font-semibold text-white transition hover:bg-[#19498d]"
                      >
                        Confirm
                      </button>
                    ) : null}
                    </>
                    ) : null}

                    {!requestStatus.feePaid && requestConfirmed ? (
                      <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-emerald-900">Request Fee</p>
                            <p className="mt-1 text-sm text-emerald-800">Complete the online payment to continue the branch release workflow.</p>
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
                            title="Request Fee Checkout"
                          />
                        </div>
                      </div>
                    ) : requestStatus.feePaid ? (
                      <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800">
                        {requestStatus.paymentStatus === 'Pending Transaction'
                          ? 'Payment recorded. Your request is now waiting for Branch Admin verification before release can continue.'
                          : 'Payment recorded. Your request is now moving through the branch release workflow.'}
                      </div>
                    ) : null}

                    {requestStatus.nextAction === 'Wait for Branch Release' ? (
                      <button
                        onClick={() => navigate('/pay-taxes')}
                        className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-100 px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-200"
                      >
                        Go to Pay Taxes Online
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Your submitted receipt copy request status will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RequestReceipt;
