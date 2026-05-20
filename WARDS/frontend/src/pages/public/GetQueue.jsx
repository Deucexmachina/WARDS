import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import { getEmailValidationMessage } from '../../utils/validation';

const PH_MOBILE_PATTERN = /^(?:\+63|63|0)9\d{9}$/;
const NAME_PATTERN = /^[A-Za-z.\-' ]+$/;
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_QUEUE_MESSAGE = 'You already have an active queue request. Please complete or cancel your current queue before registering for another one.';

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

const validateTaxpayerName = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Please enter your name';
  }

  if (!NAME_PATTERN.test(trimmed)) {
    return 'Name must contain letters only';
  }

  return '';
};

const validatePhilippineMobile = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Please enter your contact number';
  }

  const normalized = trimmed.replace(/[\s()-]/g, '');
  if (!PH_MOBILE_PATTERN.test(normalized)) {
    return 'Please enter a valid Philippine mobile number';
  }

  return '';
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
  const [language, setLanguage] = useState('en');
  const [nameError, setNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [appointmentError, setAppointmentError] = useState('');
  const [formError, setFormError] = useState('');
  const [systemStatus, setSystemStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [appointmentAvailability, setAppointmentAvailability] = useState(null);
  const [appointmentAvailabilityLoading, setAppointmentAvailabilityLoading] = useState(false);
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
    try {
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (storedUser) {
        setFormData((current) => ({
          ...current,
          taxpayer_name: current.taxpayer_name || storedUser.full_name || '',
          contact_number: current.contact_number || storedUser.contact_number || '',
          email: current.email || storedUser.email || '',
        }));
      }
    } catch {
      // Ignore malformed local user storage and keep manual entry available.
    }
  }, []);

  useEffect(() => {
    if (selectedBranch && formData.service_type) {
      analyzeQueue();
    }
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
  }, [selectedBranch, formData.queue_type, formData.appointment_date, formData.service_type]);

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
      const [branchesRes, servicesRes] = await Promise.all([
        api.get('/public/branches'),
        api.get('/public/services')
      ]);
      const statusRes = await api.get('/public/system-status');
      setBranches(branchesRes.data);
      setServices(servicesRes.data);
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

  const analyzeQueue = async () => {
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
      if (error.response?.data?.detail) {
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
      setContactError(validatePhilippineMobile(value));
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

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setQueueAnalysis(null);
    setFormError('');
    setAppointmentAvailability(null);
    setAppointmentError('');
    setFormData((current) => ({
      ...current,
      appointment_date: '',
      appointment_slot: '',
    }));
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

    const isoValue = `${formData.appointment_date}T${formData.appointment_slot}:00`;
    const appointmentDateTime = new Date(isoValue);
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
        taxpayer_name: formData.taxpayer_name,
        contact_number: formData.contact_number,
        email: formData.email,
        queue_type: formData.queue_type,
        appointment_time: appointmentDateTime,
      });
      setQueueResult(response.data);
    } catch (error) {
      console.error('Failed to register queue:', error);
      setFormError(
        error.response?.data?.detail === ACTIVE_QUEUE_MESSAGE
          ? ACTIVE_QUEUE_MESSAGE
          : error.response?.data?.detail || (language === 'en' ? 'Failed to register. Please try again.' : 'Nabigo ang pagpaparehistro. Subukan muli.')
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

    const receiptWindow = window.open('', '_blank', 'width=900,height=700');
    if (!receiptWindow) {
      setFormError('Unable to open the print preview. Please allow pop-ups and try again.');
      return;
    }

    const recommendedArrival = queueResult.recommended_arrival
      ? formatUtc8DateTime(queueResult.recommended_arrival)
      : 'N/A';
    const appointmentLabel = queueResult.appointment_time
      ? formatUtc8DateTime(queueResult.appointment_time)
      : 'Not applicable';

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Queue Receipt - ${queueResult.queue_number}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
            .sheet { max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 18px; padding: 28px; box-sizing: border-box; }
            .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px; }
            .title { font-size: 26px; font-weight: 700; margin: 0 0 6px; }
            .subtitle { font-size: 14px; color: #475569; margin: 0; }
            .queue-card { background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 16px; padding: 18px; margin-bottom: 20px; text-align: center; }
            .queue-number { font-size: 38px; font-weight: 800; color: #2563eb; margin: 10px 0 0; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
            .field { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; background: #ffffff; }
            .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin-bottom: 6px; font-weight: 700; }
            .value { font-size: 16px; font-weight: 600; color: #0f172a; line-height: 1.45; word-break: break-word; }
            .note { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; border-radius: 14px; padding: 14px 16px; font-size: 14px; line-height: 1.6; }
            @page { size: A4; margin: 12mm; }
            @media print {
              body { background: #ffffff; padding: 0; }
              .sheet { border: none; border-radius: 0; padding: 0; max-width: none; }
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="header">
              <p class="title">Queue Registration Receipt</p>
              <p class="subtitle">WARDS Queueing Module</p>
            </div>
            <div class="queue-card">
              <div class="label">Queue Number</div>
              <div class="queue-number">${queueResult.queue_number}</div>
            </div>
            <div class="grid">
              <div class="field"><div class="label">Branch</div><div class="value">${queueResult.branch_name}</div></div>
              <div class="field"><div class="label">Service</div><div class="value">${queueResult.service_type}</div></div>
              <div class="field"><div class="label">Queue Type</div><div class="value">${queueResult.queue_type}</div></div>
              <div class="field"><div class="label">Estimated Wait Time</div><div class="value">${queueResult.estimated_wait_time} min</div></div>
              <div class="field"><div class="label">Recommended Arrival</div><div class="value">${recommendedArrival}</div></div>
              <div class="field"><div class="label">Appointment Time</div><div class="value">${appointmentLabel}</div></div>
              <div class="field"><div class="label">Name</div><div class="value">${formData.taxpayer_name}</div></div>
              <div class="field"><div class="label">Contact Number</div><div class="value">${formData.contact_number}</div></div>
            </div>
            <div class="note">${queueResult.message}</div>
          </div>
          <script>
            window.onload = function () {
              window.print();
              window.onafterprint = function () { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    receiptWindow.document.close();
  };

  const getQueueLevelColor = (level) => {
    if (level === 'low') return 'bg-green-100 text-green-800 border-green-300';
    if (level === 'moderate') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

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
                onClick={() => navigate('/')}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700"
              >
                {language === 'en' ? 'Return to Home Page' : 'Bumalik sa Home Page'}
              </button>
              <button
                onClick={handlePrintReceipt}
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
            <button
              onClick={() => setLanguage(language === 'en' ? 'tl' : 'en')}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700"
            >
              {language === 'en' ? 'TL' : 'EN'}
            </button>
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
              {language === 'en' ? 'Step 1: Select Branch' : 'Hakbang 1: Pumili ng Sangay'}
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
                    {language === 'en' ? 'Selected Branch:' : 'Napiling Sangay:'} {selectedBranch.name}
                  </p>
                  <p className="text-sm text-blue-600">{selectedBranch.location}</p>
                </div>
                <button
                  onClick={() => setSelectedBranch(null)}
                  className="text-blue-600 hover:text-blue-800 font-semibold"
                >
                  {language === 'en' ? 'Change' : 'Palitan'}
                </button>
              </div>
            </div>

            {queueAnalysis && (
              <div className={`border-2 rounded-xl p-6 mb-6 ${getQueueLevelColor(queueAnalysis.queue_level)}`}>
                <h3 className="text-xl font-bold mb-4">
                  {language === 'en' ? 'Current Queue Status' : 'Kasalukuyang Katayuan ng Pila'}
                </h3>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm opacity-75">{language === 'en' ? 'Waiting' : 'Naghihintay'}</p>
                    <p className="text-2xl font-bold">{queueAnalysis.current_waiting}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-75">{language === 'en' ? 'Being Served' : 'Pinagsisilbihan'}</p>
                    <p className="text-2xl font-bold">{queueAnalysis.current_serving}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-75">{language === 'en' ? 'Est. Wait' : 'Tinatayang Hintay'}</p>
                    <p className="text-2xl font-bold">{queueAnalysis.estimated_wait_time} min</p>
                  </div>
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
                    {language === 'en' ? 'Service Type *' : 'Uri ng Serbisyo *'}
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
                            {serviceIcons[service.name] || service.name.slice(0, 3).toUpperCase()}
                          </div>
                          <div className="text-lg font-bold mb-1">{service.name}</div>
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
                      {language === 'en' ? 'Appointment Date & Time' : 'Petsa at Oras ng Tipanan'}
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
                    {language === 'en' ? 'Name *' : 'Pangalan *'}
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
                    {language === 'en' ? 'Contact Number *' : 'Numero ng Kontak *'}
                  </label>
                  <input
                    type="tel"
                    name="contact_number"
                    value={formData.contact_number}
                    onChange={handleInputChange}
                    disabled={queueUnavailable}
                    placeholder="09XXXXXXXXX"
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                      contactError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    required
                  />
                  {contactError && (
                    <p className="mt-2 text-sm text-red-600">
                      {language === 'en' ? contactError : 'Mangyaring maglagay ng wastong Philippine mobile number'}
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
                  onClick={() => setSelectedBranch(null)}
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
