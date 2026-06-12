import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatUtc8DateTime } from '../../utils/dateTime';
import { getEmailValidationMessage } from '../../utils/validation';
import SystemMessageModal from '../../components/SystemMessageModal';

const API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const QUEUE_ANALYSIS_REFRESH_INTERVAL_MS = 15000;
const STATUS_LABELS = {
  en: {
    title: 'Queue Status',
    service: 'Service',
    window: 'Window',
    nowServing: 'Now Serving',
    waiting: 'Waiting',
    active: 'Active',
    estWait: 'Est. Wait',
    noActiveQueue: 'No active queue',
    waitingForNextCall: 'Waiting for next call',
  },
  tl: {
    title: 'Katayuan ng Pila',
    service: 'Serbisyo',
    window: 'Window',
    nowServing: 'Kasalukuyan',
    waiting: 'Naghihintay',
    active: 'Aktibo',
    estWait: 'Tantyang Hintay',
    noActiveQueue: 'Walang aktibong pila',
    waitingForNextCall: 'Naghihintay ng susunod',
  },
};

const QueueRegistration = () => {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [services, setServices] = useState([]);
  const [queueAnalysis, setQueueAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [queueResult, setQueueResult] = useState(null);
  const [language, setLanguage] = useState('en');
  const [systemStatus, setSystemStatus] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [immediateAvailability, setImmediateAvailability] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [messageModal, setMessageModal] = useState(null);
  
  const [formData, setFormData] = useState({
    service_type: '',
    taxpayer_name: '',
    contact_number: '',
    email: '',
    queue_type: 'immediate',
    appointment_time: ''
  });

  useEffect(() => {
    fetchBranchAndServices();
  }, [branchId]);

  useEffect(() => {
    if (!branchId) {
      return;
    }
    const fetchImmediateAvailability = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/public/branches/${branchId}/immediate-availability`);
        setImmediateAvailability(response.data);
        if (!response.data?.is_available && formData.queue_type === 'immediate') {
          setFormData((current) => ({ ...current, queue_type: 'appointment' }));
          setStatusMessage(response.data.message || DEFAULT_DISABLED_MESSAGE);
        }
      } catch (error) {
        console.error('Failed to fetch immediate queue availability:', error);
      }
    };
    fetchImmediateAvailability();
  }, [branchId]);

  useEffect(() => {
    if (formData.service_type) {
      analyzeQueue();
    }
  }, [formData.service_type]);

  useEffect(() => {
    if (!branchId || !formData.service_type) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      analyzeQueue({ silent: true });
    }, QUEUE_ANALYSIS_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [branchId, formData.service_type]);

  const selectedService = services.find((service) => service.name === formData.service_type) || null;

  useEffect(() => {
    if (!selectedService?.requires_appointment) {
      return;
    }

    setFormData((current) => (
      current.queue_type === 'appointment'
        ? current
        : { ...current, queue_type: 'appointment' }
    ));
  }, [selectedService]);

  const fetchBranchAndServices = async () => {
    try {
      const branchRes = await axios.get(`${API_BASE_URL}/public/branches/${branchId}`);
      const statusRes = await axios.get(`${API_BASE_URL}/public/system-status`, {
        params: { branch_id: branchId }
      });
      setBranch(branchRes.data);
      setServices(branchRes.data.services || []);
      setSystemStatus(statusRes.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      if (error.response?.status === 503 || error.response?.status === 403) {
        setStatusMessage(error.response?.data?.detail || DEFAULT_DISABLED_MESSAGE);
      }
      setLoading(false);
    }
  };

  const analyzeQueue = async ({ silent = false } = {}) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/public/queue/analyze`, null, {
        params: {
          branch_id: branchId,
          service_type: formData.service_type
        }
      });
      setQueueAnalysis(response.data);
    } catch (error) {
      console.error('Failed to analyze queue:', error);
      if (!silent && error.response?.data?.detail) {
        setStatusMessage(error.response.data.detail);
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value, { required: false }));
    }
  };

  const handleRegister = async () => {
    if (!systemStatus?.queueEnabled || !systemStatus?.enabledServices?.length) {
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Queue Unavailable' : 'Hindi Available ang Pila',
        message: systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE,
      });
      return;
    }

    if (selectedService?.requires_appointment && formData.queue_type !== 'appointment') {
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Appointment Required' : 'Kailangan ng Appointment',
        message: language === 'en'
          ? 'Immediate queueing is unavailable because this service requires an appointment schedule. Please choose Appointment queueing.'
          : 'Hindi available ang immediate queueing dahil kailangan ng appointment schedule para sa serbisyong ito.',
      });
      return;
    }

    if (formData.queue_type === 'immediate' && immediateAvailability && !immediateAvailability.is_available) {
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Immediate Queue Unavailable' : 'Hindi Available ang Immediate Queue',
        message: immediateAvailability.message || DEFAULT_DISABLED_MESSAGE,
      });
      return;
    }

    if (!formData.service_type) {
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Service Required' : 'Kailangan ng Serbisyo',
        message: language === 'en' ? 'Please select a service type.' : 'Mangyaring pumili ng uri ng serbisyo.',
      });
      return;
    }

    if (formData.queue_type === 'appointment' && !formData.appointment_time) {
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Appointment Time Required' : 'Kailangan ng Oras ng Appointment',
        message: language === 'en' ? 'Please select an appointment time.' : 'Mangyaring pumili ng oras ng tipanan.',
      });
      return;
    }

    const nextEmailError = getEmailValidationMessage(formData.email, { required: false });
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setMessageModal({
        tone: 'warning',
        title: language === 'en' ? 'Invalid Email' : 'Maling Email',
        message: language === 'en' ? 'Please correct the highlighted email field.' : 'Pakisuri ang email field.',
      });
      return;
    }

    setRegistering(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/public/queue/register`, {
        branch_id: parseInt(branchId),
        ...formData
      });
      setQueueResult(response.data);
    } catch (error) {
      console.error('Failed to register queue:', error);
    } finally {
      setRegistering(false);
    }
  };

  const getQueueLevelColor = (level) => {
    if (level === 'low') return 'bg-green-100 text-green-800 border-green-300';
    if (level === 'moderate') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const statusLabels = STATUS_LABELS[language] || STATUS_LABELS.en;
  const queueUnavailable = systemStatus && (!systemStatus.queueEnabled || systemStatus.maintenanceMode);
  const disabledMessage = systemStatus?.disabledMessage || statusMessage || DEFAULT_DISABLED_MESSAGE;
  const currentServingQueueLabel = queueAnalysis?.current_serving_queue || statusLabels.noActiveQueue;
  const currentServingStatusLabel = queueAnalysis?.current_serving_status || statusLabels.waitingForNextCall;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="border-4 border-blue-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">{language === 'en' ? 'Loading...' : 'Naglo-load...'}</p>
        </div>
      </div>
    );
  }

  if (queueResult) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            
            <h2 className="text-3xl font-bold text-gray-800 mb-4">
              {language === 'en' ? 'Registration Successful!' : 'Matagumpay ang Pagpaparehistro!'}
            </h2>
            
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
              <p className="text-sm text-gray-600 mb-2">{language === 'en' ? 'Your Queue Number' : 'Iyong Numero sa Pila'}</p>
              <p className="text-4xl font-bold text-blue-600 mb-4">{queueResult.queue_number}</p>
              
              <div className="grid grid-cols-2 gap-4 text-left">
                <div>
                  <p className="text-sm text-gray-600">{language === 'en' ? 'Branch' : 'Sangay'}</p>
                  <p className="font-semibold text-gray-800">{queueResult.branch_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{language === 'en' ? 'Service' : 'Serbisyo'}</p>
                  <p className="font-semibold text-gray-800">{queueResult.service_type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{language === 'en' ? 'Est. Wait Time' : 'Tinatayang Oras'}</p>
                  <p className="font-semibold text-gray-800">{queueResult.estimated_wait_time} min</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{language === 'en' ? 'Type' : 'Uri'}</p>
                  <p className="font-semibold text-gray-800 capitalize">{queueResult.queue_type}</p>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-semibold text-yellow-800 mb-2">
                {language === 'en' ? '⏰ Recommended Arrival Time' : '⏰ Inirerekomendang Oras ng Pagdating'}
              </p>
              <p className="text-lg font-bold text-gray-800">
                {formatUtc8DateTime(queueResult.recommended_arrival)}
              </p>
            </div>

            {queueResult.appointment_time && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                <p className="text-sm font-semibold text-purple-800 mb-2">
                  {language === 'en' ? '📅 Appointment Time' : '📅 Oras ng Tipanan'}
                </p>
                <p className="text-lg font-bold text-gray-800">
                  {formatUtc8DateTime(queueResult.appointment_time)}
                </p>
              </div>
            )}

            <p className="text-gray-600 mb-6">{queueResult.message}</p>

            <div className="flex gap-4">
              <button
                onClick={() => navigate(`/public/branch/${branchId}`)}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700"
              >
                {language === 'en' ? 'Back to Branch' : 'Bumalik sa Sangay'}
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 bg-gray-600 text-white py-3 rounded-lg font-semibold hover:bg-gray-700"
              >
                {language === 'en' ? 'Print' : 'I-print'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">
                {language === 'en' ? 'Queue Registration' : 'Pagpaparehistro sa Pila'}
              </h1>
              <p className="text-gray-600 mt-1">{branch?.name}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage('en')}
                className={`px-4 py-2 rounded ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                EN
              </button>
              <button
                onClick={() => setLanguage('tl')}
                className={`px-4 py-2 rounded ${language === 'tl' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                TL
              </button>
            </div>
          </div>
        </div>

        {(queueUnavailable || statusMessage) && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
            <p className="whitespace-pre-line font-semibold">{disabledMessage}</p>
          </div>
        )}

        {/* Queue Analysis */}
        {queueAnalysis && (
          <div className={`border-2 rounded-xl p-6 mb-6 ${getQueueLevelColor(queueAnalysis.queue_level)}`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">{statusLabels.title}</h3>
                <p className="mt-1 text-sm opacity-75">
                  {queueAnalysis.service_type} • {queueAnalysis.window_label}
                </p>
              </div>
              <div className="rounded-full bg-white/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                {queueAnalysis.queue_level}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg bg-white/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{statusLabels.nowServing}</p>
                <p className="mt-2 text-2xl font-bold">{currentServingQueueLabel}</p>
                <p className="mt-1 text-xs capitalize opacity-75">{currentServingStatusLabel}</p>
              </div>
              <div className="rounded-lg bg-white/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{statusLabels.waiting}</p>
                <p className="mt-2 text-2xl font-bold">{queueAnalysis.current_waiting}</p>
              </div>
              <div className="rounded-lg bg-white/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{statusLabels.active}</p>
                <p className="mt-2 text-2xl font-bold">{queueAnalysis.current_serving}</p>
              </div>
              <div className="rounded-lg bg-white/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{statusLabels.estWait}</p>
                <p className="mt-2 text-2xl font-bold">{queueAnalysis.estimated_wait_time} min</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium opacity-80">
              <span className="rounded-full bg-white/40 px-3 py-1">{statusLabels.service}: {queueAnalysis.service_type}</span>
              <span className="rounded-full bg-white/40 px-3 py-1">{statusLabels.window}: {queueAnalysis.assigned_window_number}</span>
            </div>
            <div className="mt-4 pt-4 border-t border-current border-opacity-20">
              <p className="text-sm font-semibold">
                {language === 'en' ? '⏰ Recommended Arrival:' : '⏰ Inirerekomendang Pagdating:'}
              </p>
              <p className="text-lg font-bold">
                {formatUtc8DateTime(queueAnalysis.recommended_arrival)}
              </p>
            </div>
          </div>
        )}

        {/* Registration Form */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            {language === 'en' ? 'Registration Form' : 'Form ng Pagpaparehistro'}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Service Type *' : 'Uri ng Serbisyo *'}
              </label>
              <select
                name="service_type"
                value={formData.service_type}
                onChange={handleInputChange}
                disabled={queueUnavailable}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">{language === 'en' ? 'Select Service' : 'Pumili ng Serbisyo'}</option>
                {services.map((service) => (
                  <option key={service.id} value={service.name}>
                    {service.name} (~{service.average_time} min)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Queue Type' : 'Uri ng Pila'}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="queue_type"
                    value="immediate"
                    checked={formData.queue_type === 'immediate'}
                    onChange={handleInputChange}
                    disabled={queueUnavailable || selectedService?.requires_appointment || (immediateAvailability && !immediateAvailability.is_available)}
                    className="mr-2"
                  />
                  <span>{language === 'en' ? 'Immediate' : 'Agad'}</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="queue_type"
                    value="appointment"
                    checked={formData.queue_type === 'appointment'}
                    onChange={handleInputChange}
                    disabled={queueUnavailable}
                    className="mr-2"
                  />
                  <span>{language === 'en' ? 'Appointment' : 'Tipanan'}</span>
                </label>
              </div>
              {immediateAvailability && !immediateAvailability.is_available && (
                <p className="mt-2 whitespace-pre-line text-sm text-amber-700">
                  {immediateAvailability.message || 'This branch is currently unavailable for the selected queue service based on its published operating schedule. Please choose another branch, service, or available schedule.'}
                </p>
              )}
              {selectedService?.requires_appointment && (
                <p className="mt-2 whitespace-pre-line text-sm text-amber-700">
                  Immediate queueing is unavailable because this service requires an appointment schedule. Please choose Appointment queueing.
                </p>
              )}
            </div>

            {formData.queue_type === 'appointment' && (
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  {language === 'en' ? 'Appointment Date & Time' : 'Petsa at Oras ng Tipanan'}
                </label>
                <input
                  type="datetime-local"
                  name="appointment_time"
                  value={formData.appointment_time}
                  onChange={handleInputChange}
                  disabled={queueUnavailable}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Name (Optional)' : 'Pangalan (Opsyonal)'}
              </label>
              <input
                type="text"
                name="taxpayer_name"
                value={formData.taxpayer_name}
                onChange={handleInputChange}
                disabled={queueUnavailable}
                placeholder={language === 'en' ? 'Your name' : 'Iyong pangalan'}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Contact Number (Optional)' : 'Numero ng Kontak (Opsyonal)'}
              </label>
              <input
                type="tel"
                name="contact_number"
                value={formData.contact_number}
                onChange={handleInputChange}
                disabled={queueUnavailable}
                placeholder={language === 'en' ? '09XX XXX XXXX' : '09XX XXX XXXX'}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Email (Optional)' : 'Email (Opsyonal)'}
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                disabled={queueUnavailable}
                placeholder={language === 'en' ? 'your.email@example.com' : 'iyong.email@halimbawa.com'}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
              />
              {emailError ? (
                <p className="mt-2 text-sm text-red-600">{emailError}</p>
              ) : null}
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={() => navigate(`/public/branch/${branchId}`)}
              className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold"
            >
              {language === 'en' ? 'Cancel' : 'Kanselahin'}
            </button>
            <button
              onClick={handleRegister}
              disabled={registering || !formData.service_type || queueUnavailable}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {registering ? (language === 'en' ? 'Registering...' : 'Nagrerehistro...') : (language === 'en' ? 'Register' : 'Magrehistro')}
            </button>
          </div>
        </div>
      </div>
      <SystemMessageModal
        open={Boolean(messageModal)}
        tone={messageModal?.tone}
        title={messageModal?.title}
        message={messageModal?.message}
        onClose={() => setMessageModal(null)}
      />
    </div>
  );
};

export default QueueRegistration;
