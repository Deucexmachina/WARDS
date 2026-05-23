import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { paymentAPI } from '../../services/api';
import { formatTin } from '../../utils/validation';

const API_BASE_URL = 'http://localhost:8000/api';
const SUCCESS_STATUSES = new Set(['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success']);
const FAILED_STATUSES = new Set(['failed', 'declined', 'cancelled', 'canceled']);
const EXPIRED_STATUSES = new Set(['expired']);
const RPT_TERMINAL_STAGES = new Set(['PAYMENT_VERIFIED', 'PAYMENT_REJECTED', 'OR_GENERATED', 'COMPLETED']);
const RPT_SUCCESS_RETURN_RESET_STAGES = new Set(['PAYMENT_VERIFIED', 'OR_GENERATED', 'COMPLETED']);
const RPT_POST_PAYMENT_STAGES = new Set([
  'PAYMENT_SUBMITTED',
  'PENDING_TREASURY_VALIDATION',
  'CLARIFICATION_REQUESTED',
  'PAYMENT_VERIFIED',
  'OR_GENERATED',
  'COMPLETED',
]);
const BT_POST_PAYMENT_STAGES = new Set([
  'PAYMENT_SUBMITTED',
  'PENDING_TREASURY_VALIDATION',
  'CLARIFICATION_REQUESTED',
  'OR_GENERATED',
  'COMPLETED',
]);

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();
const formatTimestamp = (value) => {
  if (!value) return 'Pending';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
};
const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildApiAssetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
};

const POST_PAYMENT_INSTRUCTION_STAGES = new Set([
  'PAYMENT_SUBMITTED',
  'PENDING_TREASURY_VALIDATION',
  'CLARIFICATION_REQUESTED',
  'PAYMENT_VERIFIED',
  'OR_GENERATED',
  'COMPLETED',
]);

const PaymentStatus = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProofFile, setSelectedProofFile] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [showPostPaymentInstructions, setShowPostPaymentInstructions] = useState(false);
  const intervalIdRef = useRef(null);

  const refNumber = searchParams.get('ref');
  const rawStatus = payment?.workflow_status || '';
  const isRptPayment = payment?.source_module === 'rpt_online_payment' || payment?.metadata?.is_rpt_workflow;
  const isBusinessTaxPayment = payment?.source_module === 'business_tax_online_payment' || payment?.metadata?.is_business_tax_workflow;
  const paymongoStatus = normalizeStatus(payment?.paymongo_status);
  const status = normalizeStatus(payment?.status);
  const isVerified = SUCCESS_STATUSES.has(status) || SUCCESS_STATUSES.has(paymongoStatus) || Boolean(payment?.verified_at);
  const isFailed = FAILED_STATUSES.has(status) || FAILED_STATUSES.has(paymongoStatus);
  const isExpired = EXPIRED_STATUSES.has(status) || EXPIRED_STATUSES.has(paymongoStatus);
  const shouldShowProofUpload = (isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus) || isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus)) && !payment?.has_payment_proof;
  const shouldResetRptWorkflowOnReturn = isRptPayment && RPT_SUCCESS_RETURN_RESET_STAGES.has(rawStatus);
  const shouldPromptPostPaymentInstructions =
    (isRptPayment || isBusinessTaxPayment) &&
    (POST_PAYMENT_INSTRUCTION_STAGES.has(rawStatus) || BT_POST_PAYMENT_STAGES.has(rawStatus)) &&
    (SUCCESS_STATUSES.has(paymongoStatus) || SUCCESS_STATUSES.has(status) || rawStatus === 'PAYMENT_SUBMITTED');

  useEffect(() => {
    const resolvePaymentStatus = async () => {
      if (!refNumber) {
        setError('No payment reference found.');
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get(`${API_BASE_URL}/payments/paymongo/status/${refNumber}`);
        const paymentData = response.data;
        setPayment(paymentData);
        setLoading(false);

        const nextRawStatus = paymentData?.workflow_status || '';
        const nextStatus = normalizeStatus(paymentData?.status);
        const nextPaymongoStatus = normalizeStatus(paymentData?.paymongo_status);
        const nextIsSuccess = SUCCESS_STATUSES.has(nextStatus) || SUCCESS_STATUSES.has(nextPaymongoStatus) || Boolean(paymentData?.verified_at);
        const nextIsFailure = FAILED_STATUSES.has(nextStatus) || FAILED_STATUSES.has(nextPaymongoStatus);
        const nextIsExpired = EXPIRED_STATUSES.has(nextStatus) || EXPIRED_STATUSES.has(nextPaymongoStatus);
        const nextIsRpt = paymentData?.source_module === 'rpt_online_payment' || paymentData?.metadata?.is_rpt_workflow;

        if (nextIsFailure || nextIsExpired || (nextIsRpt && RPT_TERMINAL_STAGES.has(nextRawStatus))) {
          if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        }

        if (!nextIsRpt && nextIsSuccess && intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to verify payment status.');
        setLoading(false);
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      }
    };

    resolvePaymentStatus();
    intervalIdRef.current = setInterval(resolvePaymentStatus, 3000);

    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, [refNumber]);

  useEffect(() => {
    if (isFailed || isExpired) {
      navigate(`/payment/failed?ref=${encodeURIComponent(refNumber || '')}`, { replace: true });
    }
  }, [isExpired, isFailed, navigate, refNumber]);

  useEffect(() => {
    if (shouldPromptPostPaymentInstructions) {
      setShowPostPaymentInstructions(true);
    }
  }, [shouldPromptPostPaymentInstructions, refNumber]);

  const handleUploadProof = async () => {
    if (!selectedProofFile || !payment?.ref_number) {
      return;
    }

    setUploadingProof(true);
    setUploadMessage('');
    const formData = new FormData();
    formData.append('file', selectedProofFile);

    try {
      const response = isBusinessTaxPayment
        ? await paymentAPI.uploadBusinessTaxProof(payment.ref_number, formData)
        : await paymentAPI.uploadRptProof(payment.ref_number, formData);
      setPayment(response.data);
      setUploadMessage('Payment proof uploaded. Your transaction is now queued for branch treasury validation.');
      setSelectedProofFile(null);
    } catch (err) {
      setUploadMessage(err.response?.data?.detail || 'Failed to upload payment proof.');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleDownloadReceipt = async () => {
    if (!payment?.id || downloadingReceipt) return;

    setDownloadingReceipt(true);
    try {
      const response = await axios.get(
        buildApiAssetUrl(`/api/payments/${payment.id}/payment-confirmation`),
        { responseType: 'blob' },
      );
      const disposition = response.headers['content-disposition'] || '';
      const matchedFilename = disposition.match(/filename="?([^"]+)"?/i);
      const filename = matchedFilename?.[1] || `${payment.ref_number || `payment-${payment.id}`}-confirmation.pdf`;
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      setUploadMessage(downloadError.response?.data?.detail || 'Failed to download payment confirmation.');
    } finally {
      setDownloadingReceipt(false);
    }
  };

  if (loading) {
    return (
      <section className="py-16 bg-lightbg min-h-screen flex items-center justify-center">
        <div className="text-center max-w-xl px-6">
          <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-accent mx-auto mb-6"></div>
          <h2 className="text-3xl font-bold text-primary mb-3">Waiting for Payment Result</h2>
          <p className="text-gray-600 text-lg">
            Complete your payment in the PayMongo tab. WARDS will automatically update this page after the sandbox payment session responds.
          </p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="py-16 bg-lightbg min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Unable to Track Payment</h2>
            <p className="text-gray-600 mb-8 text-lg">{error}</p>
            <button
              onClick={() => navigate('/pay-taxes')}
              className="w-full bg-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Retry from Payment Page
            </button>
          </div>
        </div>
      </section>
    );
  }

  const stageLabel = rawStatus
    ? rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : (isVerified ? 'Payment Verified' : 'Payment Processing');

  return (
    <section className="py-16 bg-lightbg min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-xl p-8 md:p-12">
          <div className="text-center mb-8">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg ${isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus) ? 'bg-gradient-to-br from-blue-500 to-blue-700' : isVerified ? 'bg-gradient-to-br from-green-400 to-green-600' : 'bg-gradient-to-br from-yellow-400 to-yellow-600'}`}>
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {(isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus)) || (isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus)) ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : isVerified ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
            </div>
            <h2 className="text-4xl font-bold text-primary mb-3">
              {(isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus)) || (isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus))
                ? 'Payment Submitted to Treasury Workflow'
                : isVerified
                  ? 'Payment Verified!'
                  : 'Payment Processing'}
            </h2>
            <p className="text-gray-600 text-lg">
              {(isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus)) || (isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus))
                ? 'Your PayMongo sandbox payment has been captured. WARDS is now waiting for branch treasury validation and supporting proof.'
                : 'Your transaction is being monitored. This page updates automatically as PayMongo responds.'}
            </p>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 md:p-8 text-left border border-gray-200 shadow-inner">
            <h3 className="text-lg font-bold text-primary mb-4 border-b pb-2">Transaction Summary</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Reference Number:</span><span className="text-accent font-bold text-lg">{payment?.ref_number || refNumber}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">WARDS Transaction Number:</span><span className="text-gray-900 font-semibold">{payment?.transaction_id || 'Pending assignment'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Taxpayer Name:</span><span className="text-gray-900 font-semibold">{payment?.taxpayer_name || 'Processing'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">TIN:</span><span className="text-gray-900 font-semibold">{formatTin(payment?.tin || '') || 'Processing'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Tax Type:</span><span className="text-gray-900 font-semibold">{payment?.tax_type || 'Processing'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Payment Method:</span><span className="text-gray-900 font-semibold capitalize">{payment?.payment_method || 'Processing'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Branch:</span><span className="text-gray-900 font-semibold">{payment?.branch || 'Processing'}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Payment Timestamp:</span><span className="text-gray-900 font-semibold">{formatTimestamp(payment?.verified_at || payment?.created_at)}</span></div>
              <div className="flex justify-between items-center pt-3 border-t"><span className="text-gray-700 font-medium text-lg">Total Amount</span><span className="text-3xl font-bold text-primary">{formatCurrency(payment?.amount)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">Current Stage</span><span className="px-4 py-2 rounded-full text-sm font-bold shadow-md bg-blue-600 text-white">{stageLabel}</span></div>
              {isRptPayment && payment?.metadata?.cart_items?.length ? (
                <div className="pt-3 border-t">
                  <p className="text-gray-700 font-medium mb-3">RPT Cart Entries</p>
                  <div className="space-y-3">
                    {payment.metadata.cart_items.map((item) => (
                      <div key={item.tdn} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
                        <div className="flex justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-900">{item.tdn}</p>
                            <p className="text-sm text-slate-600">{item.property_address}</p>
                            <p className="text-sm text-slate-600">
                              Payment Mode: {item.payment_option ? item.payment_option.charAt(0).toUpperCase() + item.payment_option.slice(1) : 'Full'}
                              {item.bill_coverage ? ` • ${item.bill_coverage}` : ''}
                            </p>
                          </div>
                          <p className="font-bold text-primary">{formatCurrency(item.final_total_amount_due)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {isBusinessTaxPayment ? (
                <div className="pt-3 border-t">
                  <p className="text-gray-700 font-medium mb-3">Business Tax Record</p>
                  <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 space-y-1">
                    <p className="font-semibold text-slate-900">{payment?.metadata?.business_name || 'Business Tax Application'}</p>
                    <p className="text-sm text-slate-600">Mayor&apos;s Permit Number: {payment?.metadata?.mayor_permit_number || payment?.property_ref_number || 'N/A'}</p>
                    <p className="text-sm text-slate-600">SEC/DTI/CDA Number: {payment?.metadata?.sec_dti_cda_number || 'N/A'}</p>
                    <p className="text-sm text-slate-600">Owner: {payment?.metadata?.owner_name || payment?.taxpayer_name || 'N/A'}</p>
                  </div>
                </div>
              ) : null}
            </div>
      </div>

      {showPostPaymentInstructions ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 px-4 py-6">
          <div className="relative w-full max-w-3xl rounded-[34px] bg-white px-8 py-8 shadow-[0_28px_80px_rgba(15,23,42,0.32)] sm:px-12">
            <button
              type="button"
              onClick={() => setShowPostPaymentInstructions(false)}
              className="absolute right-5 top-5 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close post-payment instructions"
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#0f5b83]">Instructions</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              {isBusinessTaxPayment ? 'Online Payment of Business Tax' : 'Online Payment of Real Property Tax'}
            </h3>

            <div className="mx-auto mt-10 flex h-28 w-28 items-center justify-center rounded-[28px] bg-[#0f5b83] text-white">
              <svg className="h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v8m0-8l-3 3m3-3l3 3" />
              </svg>
            </div>

            <div className="mt-10 space-y-6 text-lg leading-9 text-slate-800">
              <p>
                Your payment was completed through a third-party payment provider. WARDS has received the PayMongo transaction result and recorded your payment for treasury-assisted validation.
              </p>
              <p>
                Please review the transaction details below. If payment proof is still required for your branch workflow, upload it in the <span className="font-semibold">Upload Payment Proof</span> section before waiting for branch treasury validation and Official Receipt processing.
              </p>
              <p>
                If you have any concerns, please contact us via{' '}
                <a href="mailto:rptpayment@quezoncity.gov.ph" className="font-semibold text-[#0f5b83] underline underline-offset-4">
                  rptpayment@quezoncity.gov.ph
                </a>.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowPostPaymentInstructions(false)}
              className="mt-8 w-full rounded-full bg-[#0f5b83] px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {(isRptPayment || isBusinessTaxPayment) && (
        <div className="mt-8 space-y-6">
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
                <p className="font-semibold text-blue-900 mb-1">Branch Treasury Validation Queue</p>
                <p className="text-blue-800 text-sm">
                  After PayMongo payment, this transaction is routed to the selected branch treasury office for validation. Official Receipt authorization remains with the branch treasury personnel.
                </p>
              </div>

              {shouldShowProofUpload && (
                <div className="rounded-xl border border-slate-200 bg-white px-6 py-5">
                  <h3 className="text-lg font-bold text-slate-900 mb-3">Upload Payment Proof</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Upload a screenshot or payment receipt reference in JPG, PNG, or PDF format. Maximum file size is 5MB.
                  </p>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={(event) => setSelectedProofFile(event.target.files?.[0] || null)}
                    className="block w-full text-sm text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handleUploadProof}
                    disabled={!selectedProofFile || uploadingProof}
                    className="mt-4 bg-accent hover:bg-blue-600 text-white px-5 py-3 rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {uploadingProof ? 'Uploading...' : 'Submit Payment Proof'}
                  </button>
                  {uploadMessage && <p className="mt-3 text-sm text-slate-700">{uploadMessage}</p>}
                </div>
              )}

              {payment?.has_payment_proof && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="font-semibold text-emerald-900">Payment proof uploaded</p>
                  <p className="text-sm text-emerald-800">
                    Uploaded on {formatTimestamp(payment.proof_uploaded_at)} as {payment.proof_file_name}.
                  </p>
                </div>
              )}

              {payment?.treasury_remarks && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <p className="font-semibold text-amber-900">Treasury Remarks</p>
                  <p className="text-sm text-amber-800">{payment.treasury_remarks}</p>
                </div>
              )}

              {rawStatus === 'PAYMENT_VERIFIED' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="font-semibold text-emerald-900">Payment Approved by Treasury</p>
                  <p className="text-sm text-emerald-800">
                    Branch treasury personnel have verified your payment. Official Receipt generation or release updates will appear here when available.
                  </p>
                </div>
              )}
              {payment?.official_receipt_download_url ? (
                <a
                  href={buildApiAssetUrl(payment.official_receipt_download_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white"
                >
                  Download Official Receipt
                </a>
              ) : null}
            </div>
          )}

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg disabled:opacity-60"
            >
              {downloadingReceipt ? 'Preparing PDF...' : 'Download E-Receipt'}
            </button>
            <button
              onClick={() => navigate(
                isRptPayment
                  ? `/pay-taxes/rpt${shouldResetRptWorkflowOnReturn ? '?reset=1' : ''}`
                  : isBusinessTaxPayment
                    ? `/pay-taxes/bt/online${payment?.metadata?.tracking_number ? `?tracking=${encodeURIComponent(payment.metadata.tracking_number)}` : ''}`
                  : '/pay-taxes'
              )}
              className="w-full bg-accent hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Return to Payment Page
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-primary hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PaymentStatus;
