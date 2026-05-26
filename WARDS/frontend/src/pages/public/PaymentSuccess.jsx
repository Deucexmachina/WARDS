import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatUtc8DateTime } from '../../utils/dateTime';

const API_BASE_URL = 'http://localhost:8000/api';
const SUCCESS_STATUSES = new Set(['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success']);
const FAILED_STATUSES = new Set(['failed', 'declined', 'cancelled', 'canceled', 'expired']);

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();
const formatCurrency = (amount) => `PHP ${Number(amount || 0).toFixed(2)}`;

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refNumber = searchParams.get('ref');
  const paymentSource = searchParams.get('source');
  const isMerchantReturn = searchParams.get('merchant_return') === '1';

  const isPaymentVerified = (paymentData) => {
    const status = normalizeStatus(paymentData?.status);
    const paymongoStatus = normalizeStatus(paymentData?.paymongo_status);
    return SUCCESS_STATUSES.has(status) || SUCCESS_STATUSES.has(paymongoStatus) || Boolean(paymentData?.verified_at);
  };

  const isPaymentFailed = (paymentData) => {
    const status = normalizeStatus(paymentData?.status);
    const paymongoStatus = normalizeStatus(paymentData?.paymongo_status);
    return FAILED_STATUSES.has(status) || FAILED_STATUSES.has(paymongoStatus);
  };

  useEffect(() => {
    if (refNumber) {
      navigate(`/payment/status?ref=${encodeURIComponent(refNumber)}${isMerchantReturn ? '&merchant_return=1' : ''}`, { replace: true });
      return undefined;
    }

    return undefined;
  }, [isMerchantReturn, navigate, refNumber]);

  useEffect(() => {
    let intervalId;

    const checkPaymentStatus = async () => {
      if (!refNumber) {
        setError('No payment reference found');
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get(`${API_BASE_URL}/payments/paymongo/status/${refNumber}`);
        setPayment(response.data);
        setLoading(false);

        if (isPaymentVerified(response.data) || isPaymentFailed(response.data)) {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to verify payment status');
        setLoading(false);
        clearInterval(intervalId);
      }
    };

    checkPaymentStatus();
    intervalId = setInterval(checkPaymentStatus, 3000);

    return () => clearInterval(intervalId);
  }, [refNumber]);

  useEffect(() => {
    if (!payment) {
      return;
    }

    const status = normalizeStatus(payment?.status);
    const paymongoStatus = normalizeStatus(payment?.paymongo_status);
    if (FAILED_STATUSES.has(status) || FAILED_STATUSES.has(paymongoStatus)) {
      navigate(`/payment/failed?ref=${encodeURIComponent(refNumber || '')}`, { replace: true });
    }
  }, [navigate, payment, refNumber]);

  useEffect(() => {
    if (!isMerchantReturn || !payment || !isPaymentVerified(payment) || typeof window === 'undefined') {
      return;
    }

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            type: 'wards-payment-verified',
            refNumber: payment.ref_number || refNumber,
          },
          window.location.origin
        );
      }
    } catch {
      // Ignore cross-window messaging issues and fall back to manual close text.
    }

    const closeTimer = window.setTimeout(() => {
      window.close();
    }, 500);

    return () => window.clearTimeout(closeTimer);
  }, [isMerchantReturn, payment, refNumber]);

  if (loading) {
    return (
      <section className="py-16 bg-lightbg min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-accent mx-auto mb-6"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-12 w-12 bg-accent rounded-full opacity-20 animate-pulse"></div>
            </div>
          </div>
          <h3 className="text-xl font-bold text-primary mb-2">Verifying Payment</h3>
          <p className="text-gray-600">
            {paymentSource === 'checkout-session'
              ? 'Complete the payment in the PayMongo tab we opened while we monitor the result here.'
              : 'Please wait while we confirm your transaction...'}
          </p>
          <p className="text-sm text-gray-500 mt-2">This may take a few moments</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="py-16 bg-lightbg min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
              <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Verification Error</h2>
            <p className="text-gray-600 mb-8 text-lg">{error}</p>
            <div className="space-y-3">
              <button
                onClick={() => navigate('/pay-taxes')}
                className="w-full bg-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
              >
                Return to Payment Page
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const detailRows = [
    ['Reference Number', payment?.ref_number],
    ['Transaction ID', payment?.transaction_id],
    ['Taxpayer Name', payment?.taxpayer_name],
    ['Tax Type', payment?.tax_type],
    ['Payment Method', payment?.payment_method],
    ['Branch', payment?.branch],
  ];

  if (isMerchantReturn && isPaymentVerified(payment)) {
    return (
      <section className="py-16 bg-lightbg min-h-screen flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-green-600 mb-2">Payment Verified</h2>
          <p className="text-gray-600">Returning to your payment page...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="payment-receipt-page py-16 bg-lightbg min-h-screen print:bg-white print:py-0">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:px-0">
        <div className="bg-white rounded-xl shadow-xl p-8 md:p-12 text-center print:shadow-none print:rounded-none print:p-0">
          <div className="print:hidden">
            <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-bounce">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-4xl font-bold text-green-600 mb-3">Payment Successful!</h2>
            <p className="text-gray-600 mb-8 text-lg">
              Your payment has been successfully processed and verified. Thank you for your payment!
            </p>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 md:p-8 mb-8 text-left border border-gray-200 shadow-inner print:hidden">
            <h3 className="text-lg font-bold text-primary mb-4 border-b pb-2">Payment Details</h3>
            <div className="space-y-4">
              {detailRows.map(([label, value]) => (
                <div key={label} className="flex justify-between items-center gap-6">
                  <span className="text-gray-700 font-medium">{label}:</span>
                  <span className={`text-gray-900 font-semibold ${label === 'Reference Number' ? 'text-accent text-lg font-bold' : label === 'Payment Method' ? 'capitalize' : ''}`}>
                    {value || 'N/A'}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-gray-700 font-medium text-lg">Amount Paid:</span>
                <span className="text-3xl font-bold text-primary">{formatCurrency(payment?.amount)}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-gray-700 font-medium">Status:</span>
                <span className="px-4 py-2 rounded-full text-sm font-bold shadow-md bg-green-500 text-white">
                  Verified
                </span>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6 text-left print:hidden">
            <p className="text-sm text-blue-800 font-semibold mb-1">Payment Confirmed</p>
            <p className="text-sm text-blue-700">
              Your payment has been recorded and will be processed by the {payment?.branch} branch.
            </p>
          </div>

          <div className="space-y-3 print:hidden">
            <button
              onClick={() => window.print()}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Receipt
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-primary hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Return to Home
            </button>
          </div>
        </div>

        <div className="hidden print:block payment-receipt-print">
          <div className="payment-receipt-print__sheet">
            <div className="payment-receipt-print__header">
              <p className="payment-receipt-print__eyebrow">WARDS</p>
              <h1 className="payment-receipt-print__title">Official Payment Receipt</h1>
              <p className="payment-receipt-print__subtitle">
                Verified tax payment confirmation for final testing and official record keeping.
              </p>
            </div>

            <div className="payment-receipt-print__status">
              <div className="payment-receipt-print__status-badge">Verified</div>
              <p>Printed on {formatUtc8DateTime(new Date())}</p>
            </div>

            <div className="payment-receipt-print__card">
              <h2>Transaction Details</h2>
              <div className="payment-receipt-print__rows">
                {detailRows.map(([label, value]) => (
                  <div key={label} className="payment-receipt-print__row">
                    <span>{label}</span>
                    <strong className={label === 'Payment Method' ? 'capitalize' : ''}>{value || 'N/A'}</strong>
                  </div>
                ))}
                <div className="payment-receipt-print__row payment-receipt-print__row--total">
                  <span>Amount Paid</span>
                  <strong>{formatCurrency(payment?.amount)}</strong>
                </div>
              </div>
            </div>

            <div className="payment-receipt-print__note">
              <p>This payment has been successfully verified and recorded by the system.</p>
              <p>Branch: {payment?.branch || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PaymentSuccess;
