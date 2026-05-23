import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';
const FAILED_STATUSES = new Set(['failed', 'declined', 'cancelled', 'canceled']);
const EXPIRED_STATUSES = new Set(['expired']);
const SUCCESS_STATUSES = new Set(['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success']);

const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();
const formatCurrency = (amount) => `PHP ${Number(amount || 0).toFixed(2)}`;

const PaymentFailed = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refNumber = searchParams.get('ref');

  const getStatusState = (paymentData) => {
    const status = normalizeStatus(paymentData?.status);
    const paymongoStatus = normalizeStatus(paymentData?.paymongo_status);

    if (SUCCESS_STATUSES.has(status) || SUCCESS_STATUSES.has(paymongoStatus) || paymentData?.verified_at) {
      return 'success';
    }
    if (EXPIRED_STATUSES.has(status) || EXPIRED_STATUSES.has(paymongoStatus)) {
      return 'expired';
    }
    if (FAILED_STATUSES.has(status) || FAILED_STATUSES.has(paymongoStatus)) {
      return 'failed';
    }
    return 'incomplete';
  };

  useEffect(() => {
    let intervalId;

    const fetchPaymentDetails = async () => {
      if (!refNumber) {
        setError('No payment reference found.');
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get(`${API_BASE_URL}/payments/paymongo/status/${refNumber}`);
        setPayment(response.data);
        setLoading(false);

        const statusState = getStatusState(response.data);
        if (statusState !== 'incomplete') {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load payment details.');
        setLoading(false);
        clearInterval(intervalId);
      }
    };

    fetchPaymentDetails();
    intervalId = setInterval(fetchPaymentDetails, 3000);

    return () => clearInterval(intervalId);
  }, [refNumber]);

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
          <h3 className="text-xl font-bold text-primary mb-2">Checking Payment Status</h3>
          <p className="text-gray-600">Please wait while we verify your transaction...</p>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Unable to Load Payment</h2>
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

  const statusState = getStatusState(payment);

  if (statusState === 'success') {
    navigate(`/payment/success?ref=${encodeURIComponent(refNumber || '')}`);
    return null;
  }

  const statusConfig = {
    failed: {
      title: 'Payment Failed',
      message: 'Your payment attempt was not completed successfully. This can happen when the transaction is cancelled, declined, or rejected by your payment provider.',
      badge: 'Failed',
      badgeClass: 'bg-red-500 text-white',
      iconBg: 'bg-gradient-to-br from-red-400 to-red-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
      tips: [
        'Verify your account balance or wallet limit before trying again.',
        'Try another supported payment method if the issue persists.',
        'Contact your payment provider if you believe the payment should have succeeded.',
        'Ensure your payment details are correct and up to date.',
      ],
    },
    expired: {
      title: 'Payment Session Expired',
      message: 'This payment session has expired before the transaction was completed. Payment sessions are valid for a limited time to ensure security.',
      badge: 'Expired',
      badgeClass: 'bg-orange-500 text-white',
      iconBg: 'bg-gradient-to-br from-orange-400 to-orange-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tips: [
        'Generate a new payment reference to get a fresh checkout session.',
        'Complete your next payment before the session expires.',
        'Payment sessions typically expire after 24 hours of inactivity.',
        'Avoid leaving the checkout page open for extended periods.',
      ],
    },
    incomplete: {
      title: 'Payment Not Completed',
      message: 'The payment was not finalized. This may occur if you cancelled the payment, closed the payment window, or selected a test failure option.',
      badge: 'Incomplete',
      badgeClass: 'bg-yellow-500 text-white',
      iconBg: 'bg-gradient-to-br from-yellow-400 to-yellow-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tips: [
        'If you were testing the payment flow, this is the expected result.',
        'To complete a successful payment, start a new payment and follow through to completion.',
        'You can safely retry using a new payment reference.',
        'No charges were made to your account.',
      ],
    },
  };

  const currentStatus = statusConfig[statusState];

  return (
    <section className="py-16 bg-lightbg min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-xl p-8 md:p-12 text-center">
          <div className={`w-24 h-24 ${currentStatus.iconBg} rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg`}>
            <div className={currentStatus.iconText}>
              {currentStatus.icon}
            </div>
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-4">{currentStatus.title}</h2>
          <p className="text-gray-600 mb-8 text-lg">{currentStatus.message}</p>

          {payment && (
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 md:p-8 mb-8 text-left border border-gray-200 shadow-inner">
              <h3 className="text-lg font-bold text-primary mb-4 border-b pb-2">Transaction Details</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Reference Number:</span>
                  <span className="text-accent font-bold text-lg">{payment.ref_number}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Transaction ID:</span>
                  <span className="text-gray-900 font-semibold">{payment.transaction_id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Taxpayer Name:</span>
                  <span className="text-gray-900 font-semibold">{payment.taxpayer_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Tax Type:</span>
                  <span className="text-gray-900 font-semibold">{payment.tax_type}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Payment Method:</span>
                  <span className="text-gray-900 font-semibold capitalize">{payment.payment_method}</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-gray-700 font-medium text-lg">Amount:</span>
                  <span className="text-3xl font-bold text-primary">{formatCurrency(payment.amount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Branch:</span>
                  <span className="text-gray-900 font-semibold">{payment.branch}</span>
                </div>
                {payment.failure_reason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
                    <p className="text-sm text-red-800 font-semibold mb-1">Failure Reason:</p>
                    <p className="text-sm text-red-700">{payment.failure_reason}</p>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-gray-700 font-medium">Status:</span>
                  <span className={`px-4 py-2 rounded-full text-sm font-bold shadow-md ${currentStatus.badgeClass}`}>
                    {currentStatus.badge}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-5 mb-6 text-left shadow-sm">
            <div className="flex items-start">
              <svg className="w-6 h-6 text-blue-600 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm text-blue-900 font-bold mb-2">What to do next</p>
                <ul className="space-y-2 text-sm text-blue-800">
                  {currentStatus.tips.map((tip) => (
                    <li key={tip} className="flex items-start">
                      <span className="text-blue-600 mr-2 font-bold">&bull;</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate('/pay-taxes')}
              className="w-full bg-accent hover:bg-blue-600 text-white py-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center text-lg"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Start New Payment
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-primary hover:bg-blue-800 text-white py-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg text-lg"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PaymentFailed;
