import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { buildManilaDateTimeValue, formatUtc8DateTime, parseManilaDateTimeValue } from '../../utils/dateTime';
import { getStoredPublicUser, PUBLIC_USER_STORAGE_EVENT } from '../../utils/publicSession';
import { usePublicLanguage } from '../../utils/publicLanguage';
import { printQueueTicket } from '../../utils/queueTicketPrint';
import {
  getEmailValidationMessage,
  normalizeCitizenFullName,
  normalizePhilippineContactDigits,
  toCanonicalPhilippineContactNumber,
  validateCitizenFullName,
  validatePhilippineContactDigits,
} from '../../utils/validation';
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_QUEUE_MESSAGE = 'You already have an active queue request. Please complete or cancel your current queue before registering for another one.';
const ACTIVE_QUEUE_CONTEXT_STORAGE_KEY = 'wardsActiveQueueContext';
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

const formatAppointmentAvailabilityMessage = (availability) => {
  if (!availability) {
    return 'Appointments are currently unavailable for the selected branch on this date/time. Please choose another available schedule.';
  }

  if (availability.message) {
    return availability.message;
  }

  switch (availability.status) {
    case 'past_date':
      return 'The selected appointment date has already passed. Please choose a current or future date.';
    case 'before_effective_date':
      return 'The branch schedule for this service is not active yet. Please choose the effective date or a later available date.';
    case 'weekly_closure':
      return 'This branch does not accept appointments on the selected day. Please choose another available date.';
    case 'holiday':
      return 'The branch is closed on the selected date due to a holiday. Please choose another available date.';
    case 'unavailable':
      return 'Appointments are unavailable on the selected date due to a branch closure. Please choose another available date.';
    case 'fully_booked':
      return 'All appointment slots for the selected date are already full. Please choose another available date or branch.';
    default:
      return 'Appointments are currently unavailable for the selected branch on this date/time. Please choose another available schedule.';
  }
};

const serviceIcons = {
  'Real Property Tax': 'RPT',
  'Business Tax': 'BTX',
  'Miscellaneous Tax': 'MSC',
};

const serviceIconLabels = {
  'Miscellaneous Tax': 'MSC',
  'Business Tax': 'BT',
  'Real Property Tax': 'RPT',
  'Community Tax Certificate': 'CTC',
  'Professional Tax Receipt': 'PTR',
  'Market': 'MAR',
  MISC: 'MSC',
  BT: 'BT',
  RPT: 'RPT',
  CTC: 'CTC',
  PTR: 'PTR',
  MARKET: 'MAR',
};

const serviceDisplayNames = {
  'Miscellaneous Tax': 'MISCELLANEOUS',
  'Business Tax': 'BUSINESS TAX',
  'Real Property Tax': 'REAL PROPERTY TAX',
  'Community Tax Certificate': 'COMMUNITY TAX CERTIFICATE',
  'Professional Tax Receipt': 'PROFESSIONAL TAX RECEIPT',
  'Market': 'MARKET',
  MISC: 'MISCELLANEOUS',
  BT: 'BUSINESS TAX',
  RPT: 'REAL PROPERTY TAX',
  CTC: 'COMMUNITY TAX CERTIFICATE',
  PTR: 'PROFESSIONAL TAX RECEIPT',
  MARKET: 'MARKET',
};

const getServiceDisplayName = (name) => {
  if (!name) return '';
  const clean = name.replace(/ Window$/i, '').trim();
  const exact = serviceDisplayNames[clean] || serviceDisplayNames[name];
  if (exact) return exact;
  const upper = serviceDisplayNames[clean.toUpperCase()] || serviceDisplayNames[name.toUpperCase()];
  if (upper) return upper;
  return name;
};

const getServiceIconLabel = (name) => {
  if (!name) return '';
  const clean = name.replace(/ Window$/i, '').trim();
  const exact = serviceIcons[clean] || serviceIconLabels[clean] || serviceIcons[name] || serviceIconLabels[name];
  if (exact) return exact;
  const upper = serviceIconLabels[clean.toUpperCase()] || serviceIconLabels[name.toUpperCase()];
  if (upper) return upper;
  return clean.slice(0, 3).toUpperCase();
};

const validateTaxpayerName = (value) => {
  return validateCitizenFullName(value).replace('Full name', 'Name');
};

const validatePhilippineMobile = (value) => {
  return validatePhilippineContactDigits(value).replace('Contact number is required.', 'Please enter your contact number');
};

const getUtc8TodayDate = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

const buildAlertContent = (message) => {
  const normalized = String(message || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!normalized.length) {
    return { lead: '', items: [] };
  }

  const items = normalized
    .filter((line) => /^[•\-*]/.test(line))
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean);

  if (items.length) {
    const lead = normalized.find((line) => !/^[•\-*]/.test(line)) || 'Please review the branch availability details below.';
    return { lead, items };
  }

  return { lead: normalized.join(' '), items: [] };
};

const InlineAlert = ({ tone = 'red', title, message, className = '' }) => {
  if (!message) {
    return null;
  }

  const { lead, items } = buildAlertContent(message);
  const toneStyles = tone === 'amber'
    ? {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-900',
      title: 'text-amber-900',
      body: 'text-amber-800',
      bullet: 'bg-amber-500',
    }
    : {
      wrapper: 'border-red-200 bg-red-50 text-red-900',
      title: 'text-red-900',
      body: 'text-red-800',
      bullet: 'bg-red-500',
    };

  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${toneStyles.wrapper} ${className}`.trim()}>
      {title ? <p className={`text-sm font-semibold ${toneStyles.title}`}>{title}</p> : null}
      {lead ? <p className={`${title ? 'mt-2' : ''} text-sm leading-6 ${toneStyles.body}`.trim()}>{lead}</p> : null}
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={`${title || 'alert'}-${index}`} className={`flex items-start gap-3 text-sm leading-6 ${toneStyles.body}`}>
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${toneStyles.bullet}`}></span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const GetQueue = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [queueAnalysis, setQueueAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [queueResult, setQueueResult] = useState(null);
  const [language, setLanguage] = usePublicLanguage();
  const [nameError, setNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [appointmentError, setAppointmentError] = useState('');
  const [formError, setFormError] = useState('');
  const [systemStatus, setSystemStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [appointmentAvailability, setAppointmentAvailability] = useState(null);
  const [appointmentAvailabilityLoading, setAppointmentAvailabilityLoading] = useState(false);
  const [appointmentAvailabilityRefreshKey, setAppointmentAvailabilityRefreshKey] = useState(0);
  const [immediateAvailability, setImmediateAvailability] = useState(null);
  const todayDate = useMemo(() => getUtc8TodayDate(), []);
  const preselectedService = searchParams.get('service') || '';
  const preselectedQueueType = searchParams.get('queueType') || 'immediate';
  
  const [formData, setFormData] = useState({
    service_type: preselectedService,
    taxpayer_name: '',
    contact_number: '',
    email: '',
    queue_type: preselectedQueueType === 'appointment' ? 'appointment' : 'immediate',
    appointment_date: '',
    appointment_slot: '',
  });
  const selectedService = useMemo(
    () => services.find((service) => service.name === formData.service_type) || null,
    [services, formData.service_type],
  );

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const syncStoredUser = () => {
      try {
        const storedUser = getStoredPublicUser() || {};
        setFormData((current) => ({
          ...current,
          taxpayer_name: current.taxpayer_name || storedUser.full_name || '',
          contact_number: current.contact_number || normalizePhilippineContactDigits(storedUser.contact_number || ''),
          email: current.email || storedUser.email || '',
        }));
      } catch {
        // Ignore malformed local user storage and keep manual entry available.
      }
    };

    syncStoredUser();
    window.addEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
    window.addEventListener('focus', syncStoredUser);
    return () => {
      window.removeEventListener(PUBLIC_USER_STORAGE_EVENT, syncStoredUser);
      window.removeEventListener('focus', syncStoredUser);
    };
  }, []);

  useEffect(() => {
    if (selectedBranch && formData.service_type) {
      analyzeQueue();
    }
  }, [selectedBranch, formData.service_type]);

  useEffect(() => {
    if (!selectedBranch || !formData.service_type) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      analyzeQueue({ silent: true });
    }, QUEUE_ANALYSIS_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [selectedBranch, formData.service_type]);

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

  useEffect(() => {
    if (formData.queue_type !== 'appointment') {
      setAppointmentAvailability(null);
      setAppointmentError('');
      return;
    }

    if (!selectedBranch || !formData.appointment_date) {
      setAppointmentAvailability(null);
      return;
    }

    let isActive = true;

    const fetchAppointmentAvailability = async () => {
      try {
        setAppointmentAvailabilityLoading(true);
        const response = await api.get(`/public/branches/${selectedBranch.id}/appointment-availability`, {
          params: {
            date: formData.appointment_date,
            service_type: formData.service_type || undefined,
          },
        });
        if (!isActive) {
          return;
        }

        setAppointmentAvailability(response.data);
        if (!response.data?.is_available) {
          setAppointmentError(formatAppointmentAvailabilityMessage(response.data));
          setFormData((current) => ({ ...current, appointment_slot: '' }));
        } else {
          const slotStillValid = response.data.available_slots?.some((slot) => slot.value === formData.appointment_slot);
          if (!slotStillValid) {
            setFormData((current) => ({ ...current, appointment_slot: '' }));
          }
          setAppointmentError('');
        }
      } catch (availabilityError) {
        console.error('Failed to load appointment availability:', availabilityError);
        if (!isActive) {
          return;
        }
        setAppointmentAvailability(null);
        setAppointmentError(
          availabilityError.response?.data?.detail || 'Appointments are currently unavailable for the selected branch on this date/time. Please choose another available schedule.'
        );
        setFormData((current) => ({ ...current, appointment_slot: '' }));
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
  }, [selectedBranch, formData.queue_type, formData.appointment_date, formData.service_type, appointmentAvailabilityRefreshKey]);

  useEffect(() => {
    if (!selectedBranch) {
      setImmediateAvailability(null);
      return;
    }

    let isActive = true;
    const fetchImmediateAvailability = async () => {
      try {
        const response = await api.get(`/public/branches/${selectedBranch.id}/immediate-availability`, {
          params: {
            service_type: formData.service_type || undefined,
          },
        });
        if (!isActive) {
          return;
        }
        setImmediateAvailability(response.data);
        if (!response.data?.is_available && formData.queue_type === 'immediate') {
          setFormData((current) => ({ ...current, queue_type: 'appointment' }));
        }
      } catch (availabilityError) {
        if (!isActive) {
          return;
        }
        console.error('Failed to load immediate queue availability:', availabilityError);
        setImmediateAvailability(null);
      }
    };

    fetchImmediateAvailability();
    return () => {
      isActive = false;
    };
  }, [selectedBranch, formData.service_type]);

  const fetchData = async () => {
    try {
      const [branchesRes, statusRes] = await Promise.all([
        api.get('/public/branches'),
        api.get('/public/system-status'),
      ]);
      setBranches(branchesRes.data);
      setServices([]);
      setSystemStatus(statusRes.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      if (error.response?.status === 503 || error.response?.status === 403) {
        setLoadError(error.response?.data?.detail || DEFAULT_DISABLED_MESSAGE);
      } else {
        setLoadError('Failed to load queue registration data.');
      }
      setLoading(false);
    }
  };

  const analyzeQueue = async ({ silent = false } = {}) => {
    try {
      const response = await api.post('/public/queue/analyze', null, {
        params: {
          branch_id: selectedBranch.id,
          service_type: formData.service_type
        }
      });
      setQueueAnalysis(response.data);
    } catch (error) {
      console.error('Failed to analyze queue:', error);
      if (!silent && error.response?.data?.detail) {
        setLoadError(error.response.data.detail);
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
      ...(name === 'appointment_date' ? { appointment_slot: '' } : {}),
    }));
    setFormError('');

    if (name === 'taxpayer_name') {
      setNameError(validateTaxpayerName(value));
    }

    if (name === 'contact_number') {
      const normalizedDigits = normalizePhilippineContactDigits(value);
      setFormData((current) => ({
        ...current,
        contact_number: normalizedDigits,
        ...(name === 'appointment_date' ? { appointment_slot: '' } : {}),
      }));
      setContactError(validatePhilippineMobile(normalizedDigits));
      return;
    }

    if (name === 'appointment_date') {
      if (!value) {
        setAppointmentError('');
        setAppointmentAvailability(null);
        return;
      }
      setAppointmentError('');
    }

    if (name === 'appointment_slot') {
      setAppointmentError('');
    }

    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value, { required: false }));
    }
  };

  const handleBranchSelect = async (branch) => {
    try {
      const response = await api.get(`/public/branches/${branch.id}`);
      setSelectedBranch(response.data);
      setServices(response.data.services || []);
      setQueueAnalysis(null);
      setFormError('');
      setAppointmentAvailability(null);
      setAppointmentError('');
      setFormData((current) => ({
        ...current,
        service_type: (response.data.services || []).some((service) => service.name === current.service_type) ? current.service_type : '',
        appointment_date: '',
        appointment_slot: '',
      }));
    } catch (error) {
      setLoadError(error.response?.data?.detail || 'Failed to load branch services.');
    }
  };

  const buildAppointmentDateTime = () => {
    if (formData.queue_type !== 'appointment') {
      return null;
    }

    if (!formData.appointment_date) {
      setAppointmentError('Please select an appointment date.');
      return null;
    }

    if (!formData.appointment_slot) {
      setAppointmentError('Please select an appointment time.');
      return null;
    }

    const isoValue = buildManilaDateTimeValue(formData.appointment_date, formData.appointment_slot);
    const appointmentDateTime = parseManilaDateTimeValue(isoValue);
    const now = new Date();

    if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime < now) {
      setAppointmentError('Appointment date and time must be from the current date onward.');
      return null;
    }

    if (!appointmentAvailability?.is_available) {
      setAppointmentError(formatAppointmentAvailabilityMessage(appointmentAvailability));
      return null;
    }

    const slotStillAvailable = appointmentAvailability?.available_slots?.some((slot) => slot.value === formData.appointment_slot);
    if (!slotStillAvailable) {
      setAppointmentError('The selected appointment slot is no longer available. Please choose another available time.');
      return null;
    }

    setAppointmentError('');
    return isoValue;
  };

  const handleRegister = async () => {
    if (!selectedBranch) {
      setFormError(language === 'en' ? 'Please select a branch.' : 'Mangyaring pumili ng sangay.');
      return;
    }

    if (!formData.service_type) {
      setFormError(language === 'en' ? 'Please select a service type.' : 'Mangyaring pumili ng uri ng serbisyo.');
      return;
    }

    if (!formData.taxpayer_name) {
      setFormError(language === 'en' ? 'Please enter your name.' : 'Mangyaring ilagay ang inyong pangalan.');
      return;
    }

    const taxpayerNameError = validateTaxpayerName(formData.taxpayer_name);
    if (taxpayerNameError) {
      setNameError(
        language === 'en'
          ? taxpayerNameError
          : 'Ang pangalan ay dapat mga letra lamang'
      );
      setFormError(language === 'en' ? 'Please correct the name field before continuing.' : 'Pakisuri ang name field bago magpatuloy.');
      return;
    }

    if (!formData.contact_number) {
      setFormError(language === 'en' ? 'Please enter your contact number.' : 'Mangyaring ilagay ang inyong numero ng kontak.');
      return;
    }

    const contactValidationError = validatePhilippineMobile(formData.contact_number);
    if (contactValidationError) {
      setContactError(
        language === 'en'
          ? contactValidationError
          : 'Mangyaring maglagay ng wastong Philippine mobile number'
      );
      setFormError(language === 'en' ? 'Please correct the contact number before continuing.' : 'Pakisuri ang contact number bago magpatuloy.');
      return;
    }

    const nextEmailError = getEmailValidationMessage(formData.email, { required: false });
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setFormError(language === 'en' ? 'Please correct the highlighted email field before continuing.' : 'Pakisuri ang email field bago magpatuloy.');
      return;
    }

    if (!systemStatus?.queueEnabled) {
      setFormError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }

    if (selectedService?.requires_appointment && formData.queue_type !== 'appointment') {
      setFormError('Queue registration failed: Immediate queueing is unavailable because this service requires an appointment schedule. Please choose Appointment queueing.');
      return;
    }

    if (formData.queue_type === 'immediate' && immediateAvailability && !immediateAvailability.is_available) {
      setFormError(immediateAvailability.message || DEFAULT_DISABLED_MESSAGE);
      return;
    }

    const appointmentDateTime = buildAppointmentDateTime();
    if (formData.queue_type === 'appointment' && !appointmentDateTime) {
      return;
    }

    setRegistering(true);
    setFormError('');
    try {
      const response = await api.post('/public/queue/register', {
        branch_id: selectedBranch.id,
        service_type: formData.service_type,
        taxpayer_name: normalizeCitizenFullName(formData.taxpayer_name),
        contact_number: toCanonicalPhilippineContactNumber(formData.contact_number),
        email: formData.email,
        queue_type: formData.queue_type,
        appointment_time: appointmentDateTime,
      });
      sessionStorage.setItem(ACTIVE_QUEUE_CONTEXT_STORAGE_KEY, JSON.stringify({
        queueNumber: response.data.queue_number,
        queueType: response.data.queue_type,
        appointmentTime: response.data.appointment_time,
        branchId: selectedBranch.id,
        branchName: response.data.branch_name,
        serviceType: response.data.service_type,
        taxpayerName: normalizeCitizenFullName(formData.taxpayer_name),
        email: formData.email,
      }));
      if (formData.queue_type === 'appointment' && formData.appointment_slot) {
        setAppointmentAvailability((current) => (
          current
            ? {
                ...current,
                available_slots: (current.available_slots || []).filter((slot) => slot.value !== formData.appointment_slot),
              }
            : current
        ));
      }
      setQueueResult(response.data);
    } catch (error) {
      console.error('Failed to register queue:', error);
      const errorDetail = error.response?.data?.detail || '';
      if (
        formData.queue_type === 'appointment'
        && (
          errorDetail.includes('appointment slot')
          || errorDetail.includes('no longer available')
          || errorDetail.includes('choose another available time')
        )
      ) {
        setFormData((current) => ({ ...current, appointment_slot: '' }));
        setAppointmentError(errorDetail);
        setAppointmentAvailabilityRefreshKey((current) => current + 1);
      }
      setFormError(
        errorDetail === ACTIVE_QUEUE_MESSAGE
          ? ACTIVE_QUEUE_MESSAGE
          : errorDetail || (language === 'en' ? 'Failed to register. Please try again.' : 'Nabigo ang pagpaparehistro. Subukan muli.')
      );
    } finally {
      setRegistering(false);
    }
  };

  const resetForm = () => {
    setQueueResult(null);
    setSelectedBranch(null);
    setQueueAnalysis(null);
    setNameError('');
    setContactError('');
    setAppointmentError('');
    setAppointmentAvailability(null);
    setFormData({
      service_type: '',
      taxpayer_name: '',
      contact_number: '',
      email: '',
      queue_type: 'immediate',
      appointment_date: '',
      appointment_slot: '',
    });
  };

  const handlePrintReceipt = () => {
    if (!queueResult) {
      return;
    }
    const opened = printQueueTicket();
    if (!opened) {
      setFormError('Unable to print. Please try again.');
    }
  };

  const getQueueLevelColor = (level) => {
    if (level === 'low') return 'bg-green-100 text-green-800 border-green-300';
    if (level === 'moderate') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const statusLabels = STATUS_LABELS[language] || STATUS_LABELS.en;
  const currentServingQueueLabel = queueAnalysis?.current_serving_queue || statusLabels.noActiveQueue;
  const currentServingStatusLabel = queueAnalysis?.current_serving_status || statusLabels.waitingForNextCall;

  const queueUnavailable = systemStatus && (!systemStatus.queueEnabled || systemStatus.maintenanceMode);
  const disabledMessage = systemStatus?.disabledMessage || loadError || DEFAULT_DISABLED_MESSAGE;

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
          <div className="bg-white rounded-xl shadow-lg p-8 text-center" data-print-ticket>
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => navigate('/')}
                className="w-full bg-blue-600 px-4 py-3 rounded-lg font-semibold text-white hover:bg-blue-700"
              >
                {language === 'en' ? 'Return to Home Page' : 'Bumalik sa Home Page'}
              </button>
              <button
                onClick={handlePrintReceipt}
                className="w-full bg-gray-600 px-4 py-3 rounded-lg font-semibold text-white hover:bg-gray-700"
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
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">
                {language === 'en' ? 'Get Queue Number' : 'Kumuha ng Numero sa Pila'}
              </h1>
              <p className="text-gray-600 mt-1">
                {language === 'en' ? 'Register online and skip the line' : 'Magrehistro online at laktawan ang pila'}
              </p>
            </div>
          </div>
        </div>

        {(queueUnavailable || loadError) && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
            <p className="whitespace-pre-line font-semibold">{disabledMessage}</p>
          </div>
        )}

        {/* Step 1: Select Branch */}
        {!selectedBranch && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {language === 'en' ? 'Step 1: Select Branch' : 'Hakbang 1: Pumili ng Sangay ng Opisina'}
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => handleBranchSelect(branch)}
                  disabled={queueUnavailable}
                  className="bg-gray-50 border-2 border-gray-200 hover:border-blue-500 rounded-lg p-4 text-left transition"
                >
                  <h3 className="font-bold text-gray-800 mb-2">{branch.name}</h3>
                  <p className="text-sm text-gray-600 mb-3">{branch.location}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                      {language === 'en' ? 'Waiting:' : 'Naghihintay:'}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      branch.queue_level === 'low' ? 'bg-green-100 text-green-800' :
                      branch.queue_level === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {branch.current_waiting} ({branch.queue_level})
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Registration Form */}
        {selectedBranch && (
          <>
            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 mb-6 rounded">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold text-blue-800">
                    {language === 'en' ? 'Selected Branch:' : 'Napiling Sangay ng Opisina:'} {selectedBranch.name}
                  </p>
                  <p className="text-sm text-blue-600">{selectedBranch.location}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedBranch(null);
                    setServices([]);
                  }}
                  className="text-blue-600 hover:text-blue-800 font-semibold"
                >
                  {language === 'en' ? 'Change' : 'Palitan'}
                </button>
              </div>
            </div>

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
              </div>
            )}

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">
                {language === 'en' ? 'Step 2: Service Details' : 'Hakbang 2: Detalye ng Serbisyo'}
              </h2>

              {formError && (
                <InlineAlert
                  className="mb-5"
                  title="Queue registration could not continue"
                  message={formError}
                />
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-3">
                    {language === 'en' ? 'Service Type' : 'Uri ng Serbisyo'}
                  </label>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {services.map((service) => (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, service_type: service.name })}
                        disabled={queueUnavailable}
                        className={`p-4 rounded-lg border-2 transition ${
                          formData.service_type === service.name
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <div className="text-center">
                          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                            {getServiceIconLabel(service.name)}
                          </div>
                          <div className="text-lg font-bold mb-1">{getServiceDisplayName(service.name)}</div>
                          <div className="text-sm opacity-75">~{service.average_time} min</div>
                        </div>
                      </button>
                    ))}
                  </div>
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
                        disabled={queueUnavailable || selectedService?.requires_appointment || (selectedBranch && immediateAvailability && !immediateAvailability.is_available)}
                        className="mr-2"
                      />
                      <span>{language === 'en' ? 'Immediate' : 'Agaran'}</span>
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
                      <span>{language === 'en' ? 'Appointment' : 'Takdang-Araw'}</span>
                    </label>
                  </div>
                  {formData.queue_type === 'immediate' && selectedBranch && immediateAvailability && !immediateAvailability.is_available ? (
                    <InlineAlert
                      tone="amber"
                      className="mt-3"
                      title="Immediate queueing is unavailable"
                      message={immediateAvailability.message || 'This branch is currently unavailable for the selected queue service based on its published operating schedule. Please choose another branch, service, or available schedule.'}
                    />
                  ) : null}
                  {selectedService?.requires_appointment && formData.queue_type !== 'appointment' ? (
                    <InlineAlert
                      tone="amber"
                      className="mt-3"
                      title="Appointment schedule required"
                      message="Immediate queueing is unavailable because this service requires an appointment schedule. Please choose Appointment queueing."
                    />
                  ) : null}
                </div>

                {formData.queue_type === 'appointment' && (
                  <div>
                    <label className="block text-gray-700 font-semibold mb-2">
                      {language === 'en' ? 'Appointment Date & Time' : 'Petsa at Oras ng Takdang-Araw'}
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <input
                        type="date"
                        name="appointment_date"
                        min={todayDate}
                        value={formData.appointment_date}
                        onChange={handleInputChange}
                        disabled={queueUnavailable}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        required
                      />
                      <select
                        name="appointment_slot"
                        value={formData.appointment_slot}
                        onChange={handleInputChange}
                        disabled={queueUnavailable || !formData.appointment_date || appointmentAvailabilityLoading || !appointmentAvailability?.is_available}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">{language === 'en' ? 'Select time' : 'Pumili ng oras'}</option>
                        {(appointmentAvailability?.available_slots || []).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      {appointmentAvailabilityLoading
                        ? 'Loading available appointment slots for the selected branch...'
                        : appointmentAvailability?.time_settings
                        ? `Available appointment window: ${appointmentAvailability.time_settings.opening_time} to ${appointmentAvailability.time_settings.closing_time}. Last appointment cutoff: ${appointmentAvailability.time_settings.last_appointment_time}.`
                        : language === 'en'
                        ? 'Select a date to view the published appointment schedule for this branch.'
                        : 'Pumili ng petsa para makita ang available na appointment schedule ng sangay na ito.'}
                    </p>
                    <InlineAlert
                      className="mt-3"
                      title="Appointment availability notice"
                      message={appointmentError}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">
                    {language === 'en' ? 'Name' : 'Pangalan'}
                  </label>
                  <input
                    type="text"
                    name="taxpayer_name"
                    value={formData.taxpayer_name}
                    onChange={handleInputChange}
                    disabled={queueUnavailable}
                    placeholder={language === 'en' ? 'Your name' : 'Iyong pangalan'}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                      nameError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    required
                  />
                  {nameError && (
                    <p className="mt-2 text-sm text-red-600">
                      {language === 'en' ? nameError : 'Ang pangalan ay dapat mga letra lamang'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">
                    {language === 'en' ? 'Contact Number' : 'Numero ng Kontak'}
                  </label>
                  <div className={`flex overflow-hidden rounded-lg border ${
                    contactError ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  } ${queueUnavailable ? 'bg-gray-100' : ''}`}>
                    <span className="flex items-center bg-gray-100 px-4 font-semibold text-gray-700">+63</span>
                    <input
                      type="tel"
                      name="contact_number"
                      value={formData.contact_number}
                      onChange={handleInputChange}
                      disabled={queueUnavailable}
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="9123456789"
                      className="w-full px-4 py-3 focus:outline-none"
                      required
                    />
                  </div>
                  {contactError && (
                    <p className="mt-2 text-sm text-red-600">
                      {language === 'en' ? contactError : 'Mangyaring maglagay ng wastong Philippine mobile number'}
                    </p>
                  )}
                  {!contactError && (
                    <p className="mt-2 text-sm text-gray-500">
                      {language === 'en' ? 'Enter exactly 10 digits after +63, starting with 9.' : 'Maglagay ng eksaktong 10 digit pagkatapos ng +63, na nagsisimula sa 9.'}
                    </p>
                  )}
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
                    placeholder="your.email@example.com"
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
                  onClick={() => {
                    setSelectedBranch(null);
                    setServices([]);
                  }}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold"
                >
                  {language === 'en' ? 'Back' : 'Bumalik'}
                </button>
                <button
                  onClick={handleRegister}
                  disabled={registering || !formData.service_type || queueUnavailable}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {registering ? (language === 'en' ? 'Registering...' : 'Nagrerehistro...') : (language === 'en' ? 'Get Queue Number' : 'Kumuha ng Numero')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GetQueue;
