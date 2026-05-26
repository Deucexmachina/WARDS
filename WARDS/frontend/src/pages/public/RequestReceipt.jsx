import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import axios from 'axios';
import { paymentAPI, receiptAPI } from '../../services/api';
import { getEmailValidationMessage } from '../../utils/validation';

const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';
const ACTIVE_RECEIPT_REQUEST_STORAGE_KEY = 'activeReceiptRequestId';
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

const RequestReceipt = () => {
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState({
    taxpayerName: '',
    taxType: 'RPT',
    requestType: 'Immediate',
    branchId: '',
    txnDate: '',
    refNumber: '',
    email: '',
    appointmentDate: '',
    appointmentSlot: '',
  });
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
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
    setRequestStatus(null);
    setPaymentMethod('gcash');
    setError('');
    setNameError('');
    setFormData({
      taxpayerName: '',
      taxType: 'RPT',
      requestType: 'Immediate',
      branchId: '',
      txnDate: '',
      refNumber: '',
      email: storedUser?.email || '',
      appointmentDate: '',
      appointmentSlot: '',
    });
    setAppointmentError('');
    setAppointmentAvailability(null);
  };

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

    const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
    if (storedUser?.email) {
      setFormData((current) => ({ ...current, email: storedUser.email }));
    }

    fetchBranches();
  }, []);

  useEffect(() => {
    const activeRequestId = localStorage.getItem(ACTIVE_RECEIPT_REQUEST_STORAGE_KEY);
    if (!activeRequestId) {
      return;
    }

    receiptAPI.getRequestStatus(activeRequestId)
      .then((response) => {
        setRequestStatus(response.data);
        if (['Released', 'Completed'].includes(response.data?.overallStatus || response.data?.status)) {
          localStorage.removeItem(ACTIVE_RECEIPT_REQUEST_STORAGE_KEY);
        }
      })
      .catch(() => {
        localStorage.removeItem(ACTIVE_RECEIPT_REQUEST_STORAGE_KEY);
      });
  }, []);

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
  }, [selectedBranch, formData.requestType, formData.appointmentSlot, todayDate]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
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

    setLoading(true);
    setError('');

    try {
      const response = await receiptAPI.requestCopy({
        ...formData,
        appointmentDate: formData.requestType === 'Appointment' ? todayDate : null,
        appointmentSlot: formData.requestType === 'Appointment' ? formData.appointmentSlot : null,
      });
      setRequestStatus(response.data);
      localStorage.setItem(ACTIVE_RECEIPT_REQUEST_STORAGE_KEY, response.data.requestId);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit receipt request.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayFee = async () => {
    if (!systemStatus?.paymentGatewayEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }

    if (!requestStatus?.requestId) {
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

      const initiateResponse = await receiptAPI.payRequestFee(requestStatus.requestId, { paymentMethod });
      const paymentResponse = await paymentAPI.processPayment({
        refNumber: initiateResponse.data.paymentRefNumber,
        paymentMethod,
      });

      if (paymentResponse.data.checkoutUrl) {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.location.replace(paymentResponse.data.checkoutUrl);
          navigate(`/payment/status?ref=${encodeURIComponent(paymentResponse.data.refNumber || initiateResponse.data.paymentRefNumber)}`);
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
                <label className="block text-gray-700 font-semibold mb-2">Taxpayer Name</label>
                <input
                  type="text"
                  name="taxpayerName"
                  value={formData.taxpayerName}
                  onChange={handleInputChange}
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                  placeholder="Enter your full name"
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${nameError ? 'border-red-400' : 'border-gray-300'}`}
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
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                  max={todayDate}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
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
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
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
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
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
                  disabled={systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode)}
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
                </div>
                {appointmentAvailability?.is_available && appointmentAvailability?.time_settings && (
                  <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    Choose only from branch operating hours: Monday to Friday, 8:00 AM to 5:00 PM; Saturday, 8:00 AM to 12:00 PM.
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
                placeholder="your.email@example.com"
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                  emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
              />
              {emailError && <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>}
            </div>

            <button
              onClick={handleSubmitRequest}
              disabled={loading || (systemStatus && (!systemStatus.receiptRequestEnabled || systemStatus.maintenanceMode))}
              className="w-full bg-accent hover:bg-blue-600 text-white py-4 rounded-lg font-semibold transition duration-300 shadow-lg text-lg disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Submit Request'}
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

              {!requestStatus.feePaid && (
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

              {!requestStatus.feePaid ? (
                <button
                  onClick={() => navigate('/request-receipt')}
                  className="mt-6 w-full bg-blue-50 hover:bg-blue-100 text-blue-900 py-3 rounded-lg font-semibold transition duration-300 border border-blue-200"
                >
                  Continue Request Receipt
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

              <button
                onClick={resetForAnotherRequest}
                className="mt-6 w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-3 rounded-lg font-semibold transition duration-300 border border-gray-300"
              >
                Request Another Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default RequestReceipt;
