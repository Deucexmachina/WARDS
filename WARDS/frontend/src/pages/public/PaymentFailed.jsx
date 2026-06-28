import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { appendLanguageParam, resolvePublicLanguage, setPublicLanguage } from '../../utils/publicLanguage';

import { API_BASE_URL } from '../../services/api';
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
  const accessToken = searchParams.get('token') || '';
  const urlLanguage = searchParams.get('lang');
  const language = resolvePublicLanguage(searchParams);

  useEffect(() => {
    if (urlLanguage === 'en' || urlLanguage === 'tl') {
      setPublicLanguage(urlLanguage);
    }
  }, [urlLanguage]);

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
        setError(language === 'en' ? 'No payment reference found.' : 'Walang nahanap na payment reference.');
        setLoading(false);
        return;
      }

      try {
        const tokenQuery = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
        const response = await api.get(`${API_BASE_URL}/payments/paymongo/status/${refNumber}${tokenQuery}`);
        setPayment(response.data);
        setLoading(false);

        const statusState = getStatusState(response.data);
        if (statusState !== 'incomplete') {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError(err.response?.data?.detail || (language === 'en' ? 'Failed to load payment details.' : 'Nabigong i-load ang mga detalye ng bayad.'));
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
          <h3 className="text-xl font-bold text-primary mb-2">{language === 'en' ? 'Checking Payment Status' : 'Sinusuri ang Katayuan ng Bayad'}</h3>
          <p className="text-gray-600">{language === 'en' ? 'Please wait while we verify your transaction...' : 'Mangyaring maghintay habang bini-beripika ang iyong transaksyon...'}</p>
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
            <h2 className="text-3xl font-bold text-gray-900 mb-3">{language === 'en' ? 'Unable to Load Payment' : 'Hindi Ma-load ang Bayad'}</h2>
            <p className="text-gray-600 mb-8 text-lg">{error}</p>
            <div className="space-y-3">
              <button
                onClick={() => navigate(appendLanguageParam('/pay-taxes', language))}
                className="w-full bg-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
              >
                {language === 'en' ? 'Return to Payment Page' : 'Bumalik sa Pahina ng Bayad'}
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300"
              >
                {language === 'en' ? 'Go to Home' : 'Pumunta sa Home'}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const statusState = getStatusState(payment);

  if (statusState === 'success') {
    navigate(appendLanguageParam(`/payment/success?ref=${encodeURIComponent(refNumber || '')}`, language));
    return null;
  }

  const statusConfig = {
    failed: {
      title: language === 'en' ? 'Payment Failed' : 'Nabigo ang Bayad',
      message: language === 'en'
        ? 'Your payment attempt was not completed successfully. This can happen when the transaction is cancelled, declined, or rejected by your payment provider.'
        : 'Hindi matagumpay na natapos ang iyong pagtatangka sa pagbabayad. Maaaring mangyari ito kapag nakansela, tinanggihan, o nireject ng iyong payment provider ang transaksyon.',
      badge: language === 'en' ? 'Failed' : 'Nabigo',
      badgeClass: 'bg-red-500 text-white',
      iconBg: 'bg-gradient-to-br from-red-400 to-red-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
      tips: [
        language === 'en'
          ? 'Verify your account balance or wallet limit before trying again.'
          : 'Suriin ang balanse ng iyong account o wallet limit bago subukan muli.',
        language === 'en'
          ? 'Try another supported payment method if the issue persists.'
          : 'Subukan ang ibang sinusuportahang paraan ng pagbabayad kung magpatuloy ang isyu.',
        language === 'en'
          ? 'Contact your payment provider if you believe the payment should have succeeded.'
          : 'Makipag-ugnayan sa iyong payment provider kung naniniwala kang dapat ay nagtagumpay ang bayad.',
        language === 'en'
          ? 'Ensure your payment details are correct and up to date.'
          : 'Tiyaking tama at napapanahon ang iyong detalye sa pagbabayad.',
      ],
    },
    expired: {
      title: language === 'en' ? 'Payment Session Expired' : 'Nag-expire ang Payment Session',
      message: language === 'en'
        ? 'This payment session has expired before the transaction was completed. Payment sessions are valid for a limited time to ensure security.'
        : 'Nag-expire ang payment session na ito bago natapos ang transaksyon. May limitadong oras lamang ang payment sessions para sa seguridad.',
      badge: language === 'en' ? 'Expired' : 'Nag-expire',
      badgeClass: 'bg-orange-500 text-white',
      iconBg: 'bg-gradient-to-br from-orange-400 to-orange-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tips: [
        language === 'en'
          ? 'Generate a new payment reference to get a fresh checkout session.'
          : 'Gumawa ng bagong payment reference para sa panibagong checkout session.',
        language === 'en'
          ? 'Complete your next payment before the session expires.'
          : 'Tapusin ang iyong susunod na bayad bago mag-expire ang session.',
        language === 'en'
          ? 'Payment sessions typically expire after 24 hours of inactivity.'
          : 'Karaniwang nag-e-expire ang payment session matapos ang 24 oras na walang aktibidad.',
        language === 'en'
          ? 'Avoid leaving the checkout page open for extended periods.'
          : 'Iwasang iwanang bukas ang checkout page nang matagal.',
      ],
    },
    incomplete: {
      title: language === 'en' ? 'Payment Not Completed' : 'Hindi Kumpleto ang Bayad',
      message: language === 'en'
        ? 'The payment was not finalized. This may occur if you cancelled the payment, closed the payment window, or selected a test failure option.'
        : 'Hindi natapos ang bayad. Maaaring mangyari ito kung kinansela mo ang bayad, isinara ang payment window, o pumili ng test failure option.',
      badge: language === 'en' ? 'Incomplete' : 'Hindi Kumpleto',
      badgeClass: 'bg-yellow-500 text-white',
      iconBg: 'bg-gradient-to-br from-yellow-400 to-yellow-600',
      iconText: 'text-white',
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tips: [
        language === 'en'
          ? 'If you were testing the payment flow, this is the expected result.'
          : 'Kung tine-test mo ang payment flow, ito ang inaasahang resulta.',
        language === 'en'
          ? 'To complete a successful payment, start a new payment and follow through to completion.'
          : 'Para makumpleto ang matagumpay na bayad, magsimula ng bagong payment at tapusin ito nang buo.',
        language === 'en'
          ? 'You can safely retry using a new payment reference.'
          : 'Maaari kang mag-subok muli gamit ang bagong payment reference.',
        language === 'en'
          ? 'No charges were made to your account.'
          : 'Walang naibawas sa iyong account.',
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
              <h3 className="text-lg font-bold text-primary mb-4 border-b pb-2">{language === 'en' ? 'Transaction Details' : 'Mga Detalye ng Transaksyon'}</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Reference Number:' : 'Numero ng Sanggunian:'}</span>
                  <span className="text-accent font-bold text-lg">{payment.ref_number}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Transaction ID:' : 'ID ng Transaksyon:'}</span>
                  <span className="text-gray-900 font-semibold">{payment.transaction_id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Taxpayer Name:' : 'Pangalan ng Nagbabayad:'}</span>
                  <span className="text-gray-900 font-semibold">{payment.taxpayer_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Tax Type:' : 'Uri ng Buwis:'}</span>
                  <span className="text-gray-900 font-semibold">{payment.tax_type}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Payment Method:' : 'Paraan ng Pagbayad:'}</span>
                  <span className="text-gray-900 font-semibold capitalize">{payment.payment_method}</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-gray-700 font-medium text-lg">{language === 'en' ? 'Amount:' : 'Halaga:'}</span>
                  <span className="text-3xl font-bold text-primary">{formatCurrency(payment.amount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Branch:' : 'Sangay:'}</span>
                  <span className="text-gray-900 font-semibold">{payment.branch}</span>
                </div>
                {payment.failure_reason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
                    <p className="text-sm text-red-800 font-semibold mb-1">{language === 'en' ? 'Failure Reason:' : 'Dahilan ng Pagkabigo:'}</p>
                    <p className="text-sm text-red-700">{payment.failure_reason}</p>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-gray-700 font-medium">{language === 'en' ? 'Status:' : 'Katayuan:'}</span>
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
                <p className="text-sm text-blue-900 font-bold mb-2">{language === 'en' ? 'What to do next' : 'Ano ang Susunod na Gagawin'}</p>
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
              onClick={() => navigate(appendLanguageParam('/pay-taxes', language))}
              className="w-full bg-accent hover:bg-blue-600 text-white py-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center justify-center text-lg"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {language === 'en' ? 'Start New Payment' : 'Magsimula ng Bagong Bayad'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-primary hover:bg-blue-800 text-white py-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg text-lg"
            >
              {language === 'en' ? 'Return to Home' : 'Bumalik sa Home'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PaymentFailed;
