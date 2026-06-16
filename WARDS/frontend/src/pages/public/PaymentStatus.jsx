import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { paymentAPI } from '../../services/api';
import { appendLanguageParam, resolvePublicLanguage, setPublicLanguage } from '../../utils/publicLanguage';

import { API_BASE_URL } from '../../services/api';
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
  const urlLanguage = searchParams.get('lang');
  const language = resolvePublicLanguage(searchParams);
  const receiptFlow = searchParams.get('receiptFlow') || '';
  const isMerchantReturn = searchParams.get('merchant_return') === '1';
  const hasOpenerWindow = typeof window !== 'undefined' && window.opener && !window.opener.closed;
  const shouldHandOffMerchantReturn = isMerchantReturn && hasOpenerWindow;
  const rawStatus = payment?.workflow_status || '';
  const isRptPayment = payment?.source_module === 'rpt_online_payment' || payment?.metadata?.is_rpt_workflow;
  const isBusinessTaxPayment = payment?.source_module === 'business_tax_online_payment' || payment?.metadata?.is_business_tax_workflow;
  const isReceiptRequestPayment = payment?.source_module === 'receipt_request';
  const paymongoStatus = normalizeStatus(payment?.paymongo_status);
  const status = normalizeStatus(payment?.status);
  const isReceiptRequestPendingVerification = isReceiptRequestPayment
    && !payment?.verified_at
    && (status === 'pending transaction' || SUCCESS_STATUSES.has(paymongoStatus));
  const isVerified = isReceiptRequestPayment
    ? (status === 'verified' || status === 'payment verified' || Boolean(payment?.verified_at))
    : (SUCCESS_STATUSES.has(status) || SUCCESS_STATUSES.has(paymongoStatus) || Boolean(payment?.verified_at));
  const isFailed = FAILED_STATUSES.has(status) || FAILED_STATUSES.has(paymongoStatus) || status === 'rejected';
  const isExpired = EXPIRED_STATUSES.has(status) || EXPIRED_STATUSES.has(paymongoStatus);
  const shouldShowProofUpload = (isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus) || isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus)) && !payment?.has_payment_proof;
  const shouldResetRptWorkflowOnReturn = isRptPayment && RPT_SUCCESS_RETURN_RESET_STAGES.has(rawStatus);
  const shouldPromptPostPaymentInstructions =
    (isRptPayment || isBusinessTaxPayment) &&
    (POST_PAYMENT_INSTRUCTION_STAGES.has(rawStatus) || BT_POST_PAYMENT_STAGES.has(rawStatus)) &&
    (SUCCESS_STATUSES.has(paymongoStatus) || SUCCESS_STATUSES.has(status) || rawStatus === 'PAYMENT_SUBMITTED');
  const isQueueLinkedReceiptPayment = isReceiptRequestPayment && receiptFlow === 'queue-link';
  const isStandaloneReceiptPayment = isReceiptRequestPayment && receiptFlow === 'standalone';

  useEffect(() => {
    if (urlLanguage === 'en' || urlLanguage === 'tl') {
      setPublicLanguage(urlLanguage);
    }
  }, [urlLanguage]);

  useEffect(() => {
    if (shouldHandOffMerchantReturn) {
      setLoading(false);

      try {
        window.opener.postMessage(
          {
            type: 'wards-payment-merchant-return',
            refNumber,
          },
          window.location.origin
        );
      } catch {
        // Ignore cross-window messaging errors and fall back to polling in the opener.
      }

      const closeTimer = window.setTimeout(() => {
        window.close();
      }, 400);

      return () => window.clearTimeout(closeTimer);
    }

    const resolvePaymentStatus = async () => {
      if (!refNumber) {
        setError(language === 'en' ? 'No payment reference found.' : 'Walang nahanap na payment reference.');
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
        setError(err.response?.data?.detail || (language === 'en' ? 'Failed to verify payment status.' : 'Nabigong beripikahin ang katayuan ng bayad.'));
        setLoading(false);
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      }
    };

    resolvePaymentStatus();
    intervalIdRef.current = setInterval(resolvePaymentStatus, 3000);

    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, [refNumber, shouldHandOffMerchantReturn]);

  useEffect(() => {
    if (shouldHandOffMerchantReturn) {
      return;
    }

    if (isFailed || isExpired) {
      navigate(appendLanguageParam(`/payment/failed?ref=${encodeURIComponent(refNumber || '')}`, language), { replace: true });
    }
  }, [isExpired, isFailed, navigate, refNumber, shouldHandOffMerchantReturn]);

  useEffect(() => {
    if (shouldHandOffMerchantReturn) {
      return;
    }

    if (shouldPromptPostPaymentInstructions) {
      setShowPostPaymentInstructions(true);
    }
  }, [shouldPromptPostPaymentInstructions, refNumber, shouldHandOffMerchantReturn]);

  useEffect(() => {
    if (shouldHandOffMerchantReturn || typeof window === 'undefined' || !refNumber) {
      return undefined;
    }

    const handleMerchantReturn = async (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== 'wards-payment-merchant-return' || event.data?.refNumber !== refNumber) {
        return;
      }

      try {
        const response = await axios.get(`${API_BASE_URL}/payments/paymongo/status/${refNumber}`);
        setPayment(response.data);
        setError('');
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to refresh payment status.');
      }
    };

    window.addEventListener('message', handleMerchantReturn);
    return () => window.removeEventListener('message', handleMerchantReturn);
  }, [refNumber, shouldHandOffMerchantReturn]);

  if (shouldHandOffMerchantReturn) {
    return (
      <section className="py-16 bg-lightbg min-h-screen flex items-center justify-center">
        <div className="text-center max-w-lg px-6">
          <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-b-4 border-accent"></div>
          <h2 className="text-2xl font-bold text-primary mb-2">
            {language === 'en' ? 'Returning to Payment Processing' : 'Bumabalik sa Pagproseso ng Bayad'}
          </h2>
          <p className="text-gray-600">
            {language === 'en'
              ? 'This window will close automatically so you can continue on the original payment processing page.'
              : 'Magsasara ang window na ito nang awtomatiko upang makabalik ka sa orihinal na pahina ng pagproseso ng bayad.'}
          </p>
        </div>
      </section>
    );
  }

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
      setUploadMessage(language === 'en'
        ? 'Payment proof uploaded. Your transaction is now queued for branch treasury validation.'
        : 'Na-upload na ang payment proof. Nakapila na ngayon ang iyong transaksyon para sa beripikasyon ng branch treasury.');
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
          <h2 className="text-3xl font-bold text-primary mb-3">
            {language === 'en' ? 'Waiting for Payment Result' : 'Naghihintay sa Resulta ng Bayad'}
          </h2>
          <p className="text-gray-600 text-lg">
            {language === 'en'
              ? 'Complete your payment in the PayMongo tab. WARDS will automatically update this page after the sandbox payment session responds.'
              : 'Tapusin ang iyong bayad sa PayMongo tab. Awtomatikong mag-a-update ang WARDS sa pahinang ito kapag tumugon na ang sandbox payment session.'}
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
            <h2 className="text-3xl font-bold text-gray-900 mb-3">
              {language === 'en' ? 'Unable to Track Payment' : 'Hindi Ma-track ang Bayad'}
            </h2>
            <p className="text-gray-600 mb-8 text-lg">{error}</p>
            <button
              onClick={() => navigate(appendLanguageParam(isReceiptRequestPayment ? '/request-receipt' : '/pay-taxes', language))}
              className="w-full bg-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              {language === 'en' ? 'Retry from Payment Page' : 'Subukan Muli Mula sa Pahina ng Bayad'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const stageLabel = isReceiptRequestPendingVerification
    ? 'Pending Transaction'
    : rawStatus
    ? rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : (isVerified ? (language === 'en' ? 'Payment Verified' : 'Nakumpirma ang Bayad') : (language === 'en' ? 'Payment Processing' : 'Pinoproseso ang Bayad'));

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
              {isReceiptRequestPendingVerification
                ? (language === 'en' ? 'Pending Branch Verification' : 'Naghihintay ng Beripikasyon ng Sanga')
                : ((isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus)) || (isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus))
                  ? (language === 'en' ? 'Payment Submitted to Treasury Workflow' : 'Naipasa na ang Bayad sa Treasury Workflow')
                  : isVerified
                    ? (language === 'en' ? 'Payment Verified!' : 'Nakumpirma ang Bayad!')
                    : (language === 'en' ? 'Payment Processing' : 'Pinoproseso ang Bayad'))}
            </h2>
            <p className="text-gray-600 text-lg">
              {isReceiptRequestPendingVerification
                ? (language === 'en'
                  ? 'Your receipt request payment was captured successfully and is now waiting for Branch Admin verification before release can continue.'
                  : 'Matagumpay na nakuha ang bayad para sa request ng resibo at naghihintay ngayon ng beripikasyon ng Branch Admin bago maipagpatuloy ang release.')
                : ((isRptPayment && RPT_POST_PAYMENT_STAGES.has(rawStatus)) || (isBusinessTaxPayment && BT_POST_PAYMENT_STAGES.has(rawStatus))
                  ? (language === 'en'
                    ? 'Your PayMongo sandbox payment has been captured. WARDS is now waiting for branch treasury validation and supporting proof.'
                    : 'Nakuha na ang iyong PayMongo sandbox payment. Naghihintay ngayon ang WARDS ng beripikasyon ng branch treasury at karagdagang patunay.')
                  : (language === 'en'
                    ? 'Your transaction is being monitored. This page updates automatically as PayMongo responds.'
                    : 'Minomonitor ang iyong transaksyon. Awtomatikong nag-a-update ang pahinang ito habang sumasagot ang PayMongo.'))}
            </p>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 md:p-8 text-left border border-gray-200 shadow-inner">
            <h3 className="text-lg font-bold text-primary mb-4 border-b pb-2">{language === 'en' ? 'Transaction Summary' : 'Buod ng Transaksyon'}</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Reference Number:' : 'Numero ng Sanggunian:'}</span><span className="text-accent font-bold text-lg">{payment?.ref_number || refNumber}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'WARDS Transaction Number:' : 'Numero ng Transaksyon ng WARDS:'}</span><span className="text-gray-900 font-semibold">{payment?.transaction_id || (language === 'en' ? 'Pending assignment' : 'Nakabinbin pa')}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Taxpayer Name:' : 'Pangalan ng Nagbabayad:'}</span><span className="text-gray-900 font-semibold">{payment?.taxpayer_name || (language === 'en' ? 'Processing' : 'Pinoproseso')}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Tax Type:' : 'Uri ng Buwis:'}</span><span className="text-gray-900 font-semibold">{payment?.tax_type || (language === 'en' ? 'Processing' : 'Pinoproseso')}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Payment Method:' : 'Paraan ng Pagbayad:'}</span><span className="text-gray-900 font-semibold capitalize">{payment?.payment_method || (language === 'en' ? 'Processing' : 'Pinoproseso')}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Branch:' : 'Sangay:'}</span><span className="text-gray-900 font-semibold">{payment?.branch || (language === 'en' ? 'Processing' : 'Pinoproseso')}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Payment Timestamp:' : 'Oras ng Bayad:'}</span><span className="text-gray-900 font-semibold">{formatTimestamp(payment?.verified_at || payment?.created_at)}</span></div>
              <div className="flex justify-between items-center pt-3 border-t"><span className="text-gray-700 font-medium text-lg">{language === 'en' ? 'Total Amount' : 'Kabuuang Halaga'}</span><span className="text-3xl font-bold text-primary">{formatCurrency(payment?.amount)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-700 font-medium">{language === 'en' ? 'Current Stage' : 'Kasalukuyang Yugto'}</span><span className="px-4 py-2 rounded-full text-sm font-bold shadow-md bg-blue-600 text-white">{stageLabel}</span></div>
              {isRptPayment && payment?.metadata?.cart_items?.length ? (
                <div className="pt-3 border-t">
                  <p className="text-gray-700 font-medium mb-3">{language === 'en' ? 'RPT Cart Entries' : 'Mga Nasa Cart na RPT'}</p>
                  <div className="space-y-3">
                    {payment.metadata.cart_items.map((item) => (
                      <div key={item.tdn} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
                        <div className="flex justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-900">{item.tdn}</p>
                            <p className="text-sm text-slate-600">{item.property_address}</p>
                            <p className="text-sm text-slate-600">
                              {language === 'en' ? 'Payment Mode:' : 'Paraan ng Bayad:'} {item.payment_option ? item.payment_option.charAt(0).toUpperCase() + item.payment_option.slice(1) : (language === 'en' ? 'Full' : 'Buong Bayad')}
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
                  <p className="text-gray-700 font-medium mb-3">{language === 'en' ? 'Business Tax Record' : 'Rekord ng Business Tax'}</p>
                  <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 space-y-1">
                    <p className="font-semibold text-slate-900">{payment?.metadata?.business_name || (language === 'en' ? 'Business Tax Application' : 'Aplikasyon sa Business Tax')}</p>
                    <p className="text-sm text-slate-600">{language === 'en' ? 'Mayor&apos;s Permit Number:' : 'Numero ng Mayor&apos;s Permit:'} {payment?.metadata?.mayor_permit_number || payment?.property_ref_number || 'N/A'}</p>
                    <p className="text-sm text-slate-600">{language === 'en' ? 'SEC/DTI/CDA Number:' : 'Numero ng SEC/DTI/CDA:'} {payment?.metadata?.sec_dti_cda_number || 'N/A'}</p>
                    <p className="text-sm text-slate-600">{language === 'en' ? 'Owner:' : 'May-ari:'} {payment?.metadata?.owner_name || payment?.taxpayer_name || 'N/A'}</p>
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

            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#0f5b83]">
              {language === 'en' ? 'Instructions' : 'Mga Tagubilin'}
            </p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              {isBusinessTaxPayment
                ? (language === 'en' ? 'Online Payment of Business Tax' : 'Online na Bayad ng Business Tax')
                : (language === 'en' ? 'Online Payment of Real Property Tax' : 'Online na Bayad ng Real Property Tax')}
            </h3>

            <div className="mx-auto mt-10 flex h-28 w-28 items-center justify-center rounded-[28px] bg-[#0f5b83] text-white">
              <svg className="h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v8m0-8l-3 3m3-3l3 3" />
              </svg>
            </div>

            <div className="mt-10 space-y-6 text-lg leading-9 text-slate-800">
              <p>
                {language === 'en'
                  ? 'Your payment was completed through a third-party payment provider. WARDS has received the PayMongo transaction result and recorded your payment for treasury-assisted validation.'
                  : 'Nakumpleto ang iyong bayad sa pamamagitan ng third-party payment provider. Natanggap ng WARDS ang resulta ng PayMongo transaction at naitala ang iyong bayad para sa treasury-assisted validation.'}
              </p>
              <p>
                {language === 'en'
                  ? <>Please review the transaction details below. If payment proof is still required for your branch workflow, upload it in the <span className="font-semibold">Upload Payment Proof</span> section before waiting for branch treasury validation and Official Receipt processing.</>
                  : <>Pakisuri ang mga detalye ng transaksyon sa ibaba. Kung kailangan pa ng payment proof para sa workflow ng inyong sangay, i-upload ito sa seksyong <span className="font-semibold">I-upload ang Patunay ng Bayad</span> bago maghintay sa branch treasury validation at pagproseso ng Official Receipt.</>}
              </p>
              <p>
                {language === 'en'
                  ? <>If you have any concerns, please contact us via{' '} </>
                  : <>Kung may alalahanin ka, mangyaring makipag-ugnayan sa amin sa pamamagitan ng{' '} </>}
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
              {language === 'en' ? 'Continue' : 'Magpatuloy'}
            </button>
          </div>
        </div>
      ) : null}

      {(isRptPayment || isBusinessTaxPayment) && (
        <div className="mt-8 space-y-6">
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
                <p className="font-semibold text-blue-900 mb-1">{language === 'en' ? 'Branch Treasury Validation Queue' : 'Nakahintong Beripikasyon ng Branch Treasury'}</p>
                <p className="text-blue-800 text-sm">
                  {language === 'en'
                    ? 'After PayMongo payment, this transaction is routed to the selected branch treasury office for validation. Official Receipt authorization remains with the branch treasury personnel.'
                    : 'Pagkatapos ng PayMongo payment, ang transaksyong ito ay inilalagay sa napiling branch treasury office para sa beripikasyon. Nananatili sa branch treasury personnel ang awtorisasyon para sa Official Receipt.'}
                </p>
              </div>

              {shouldShowProofUpload && (
                <div className="rounded-xl border border-slate-200 bg-white px-6 py-5">
                  <h3 className="text-lg font-bold text-slate-900 mb-3">{language === 'en' ? 'Upload Payment Proof' : 'I-upload ang Patunay ng Bayad'}</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    {language === 'en'
                      ? 'Upload a payment proof document in PDF, PNG, or JPEG format. Maximum file size is 5MB.'
                      : 'Mag-upload ng dokumento ng patunay ng bayad sa format na PDF, PNG, o JPEG. Ang maximum na laki ng file ay 5MB.'}
                  </p>
                  <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3">
                    <label className="shrink-0 cursor-pointer rounded-2xl bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]">
                      Choose File
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(event) => setSelectedProofFile(event.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                    <span className="truncate text-sm text-slate-600">
                      {selectedProofFile ? selectedProofFile.name : 'No file chosen'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleUploadProof}
                    disabled={!selectedProofFile || uploadingProof}
                    className="mt-4 bg-accent hover:bg-blue-600 text-white px-5 py-3 rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {uploadingProof ? (language === 'en' ? 'Uploading...' : 'Ina-upload...') : (language === 'en' ? 'Submit Payment Proof' : 'Isumite ang Patunay ng Bayad')}
                  </button>
                  {uploadMessage && <p className="mt-3 text-sm text-slate-700">{uploadMessage}</p>}
                </div>
              )}

              {payment?.has_payment_proof && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="font-semibold text-emerald-900">{language === 'en' ? 'Payment proof uploaded' : 'Na-upload na ang patunay ng bayad'}</p>
                  <p className="text-sm text-emerald-800">
                    {language === 'en'
                      ? <>Uploaded on {formatTimestamp(payment.proof_uploaded_at)} as {payment.proof_file_name}.</>
                      : <>Na-upload noong {formatTimestamp(payment.proof_uploaded_at)} bilang {payment.proof_file_name}.</>}
                  </p>
                </div>
              )}

              {payment?.treasury_remarks && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <p className="font-semibold text-amber-900">{language === 'en' ? 'Treasury Remarks' : 'Mga Komento ng Treasury'}</p>
                  <p className="text-sm text-amber-800">{payment.treasury_remarks}</p>
                </div>
              )}

              {rawStatus === 'PAYMENT_VERIFIED' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="font-semibold text-emerald-900">{language === 'en' ? 'Payment Approved by Treasury' : 'Naaprubahan ang Bayad ng Treasury'}</p>
                  <p className="text-sm text-emerald-800">
                    {language === 'en'
                      ? 'Branch treasury personnel have verified your payment. Official Receipt generation or release updates will appear here when available.'
                      : 'Na-verify na ng branch treasury personnel ang iyong bayad. Ang pagbuo o paglabas ng Official Receipt ay lalabas dito kapag available na.'}
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
                  {language === 'en' ? 'Download Official Receipt' : 'I-download ang Official Receipt'}
                </a>
              ) : null}
            </div>
          )}

          <div className="mt-8 space-y-4">
            {/* Primary Action - Download Receipt */}
            <button
              onClick={handleDownloadReceipt}
              disabled={downloadingReceipt}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg disabled:opacity-60 flex items-center justify-center gap-2 text-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloadingReceipt ? (language === 'en' ? 'Preparing PDF...' : 'Ihahanda ang PDF...') : (language === 'en' ? 'Download E-Receipt' : 'I-download ang E-Resibo')}
            </button>

            {/* Secondary Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => navigate(
                  isRptPayment
                    ? appendLanguageParam(`/pay-taxes/rpt${shouldResetRptWorkflowOnReturn ? '?reset=1' : ''}`, language)
                    : isBusinessTaxPayment
                      ? appendLanguageParam(`/pay-taxes/bt/online${payment?.metadata?.tracking_number ? `?tracking=${encodeURIComponent(payment.metadata.tracking_number)}` : ''}`, language)
                      : isReceiptRequestPayment
                        ? appendLanguageParam('/request-receipt', language)
                        : appendLanguageParam('/pay-taxes', language)
                )}
                className="w-full bg-accent hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {language === 'en' ? 'Return to Payment Page' : 'Bumalik sa Pahina ng Bayad'}
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full bg-primary hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {language === 'en' ? 'Return to Home' : 'Bumalik sa Home'}
              </button>
            </div>

            {/* Tertiary Actions - Receipt-specific */}
            {(isQueueLinkedReceiptPayment || isStandaloneReceiptPayment) && (
              <div className="pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-3 text-center font-medium">{language === 'en' ? 'Additional Options' : 'Mga Karagdagang Opsyon'}</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  {isQueueLinkedReceiptPayment && (
                    <button
                      type="button"
                      onClick={() => navigate('/?modal=ticket')}
                      className="w-full sm:w-auto bg-blue-100 hover:bg-blue-200 text-blue-700 px-5 py-2.5 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                      {language === 'en' ? 'View My Ticket' : 'Tingnan ang Aking Ticket'}
                    </button>
                  )}
                  {isStandaloneReceiptPayment && (
                    <button
                      type="button"
                      onClick={() => navigate(appendLanguageParam('/request-receipt?new=1', language))}
                      className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {language === 'en' ? 'Request Another Copy' : 'Humiling ng Panibagong Kopya'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default PaymentStatus;
