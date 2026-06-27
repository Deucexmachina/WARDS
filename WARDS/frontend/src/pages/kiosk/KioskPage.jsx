import { useState, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_HOST } from '../../services/api';

export default function KioskPage() {
  const [searchParams] = useSearchParams();
  const { branchId: branchIdParam } = useParams();
  const [step, setStep] = useState('loading'); // loading, error, services, name, ticket
  const [services, setServices] = useState([]);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [taxpayerName, setTaxpayerName] = useState('');
  const [nameError, setNameError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(10);

  const branchId = branchIdParam || searchParams.get('branch');
  const token = searchParams.get('token') || localStorage.getItem('kiosk_token');

  useEffect(() => {
    if (!branchId || !token) {
      setError('Invalid kiosk link. Please contact branch staff.');
      setStep('error');
      return;
    }
    localStorage.setItem('kiosk_token', token);
    loadServices();
  }, [branchId, token]);

  const loadServices = async () => {
    try {
      const res = await axios.get(`${API_HOST}/api/kiosk/services`, {
        headers: { 'X-Kiosk-Token': token },
      });
      setServices(res.data.services || []);
      setBranchName(res.data.branch_name || '');
      setStep('services');
    } catch (err) {
      setError(err.response?.data?.detail || 'Kiosk is not available. Please contact branch staff.');
      setStep('error');
    }
  };

  const validateName = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Full name is required.';
    if (trimmed.length < 2) return 'Name must be at least 2 characters.';
    if (/\d/.test(trimmed)) return 'Name must not contain numbers.';
    if (!/^[A-Za-z\s]+$/.test(trimmed)) return 'Name must contain letters and spaces only.';
    return '';
  };

  const handleSelectService = (serviceType) => {
    setSelectedService(serviceType);
    setTaxpayerName('');
    setNameError('');
    setError('');
    setStep('name');
  };

  const handleGetTicket = async () => {
    const validation = validateName(taxpayerName);
    if (validation) {
      setNameError(validation);
      return;
    }
    setNameError('');
    setError('');
    setLoading(true);

    try {
      const res = await axios.post(
        `${API_HOST}/api/kiosk/ticket`,
        { service_type: selectedService, taxpayer_name: taxpayerName.trim() },
        { headers: { 'X-Kiosk-Token': token, 'Content-Type': 'application/json' } }
      );
      setTicket(res.data);
      setStep('ticket');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate ticket. Please try again.');
      setStep('services');
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = () => {
    setTicket(null);
    setSelectedService(null);
    setTaxpayerName('');
    setNameError('');
    setError('');
    setCountdown(10);
    setStep('services');
  };

  // Auto-return to services after 10 seconds on ticket screen
  useEffect(() => {
    if (step !== 'ticket') return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleRestart();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#0f2f5f] border-t-transparent"></div>
          <p className="text-slate-600 text-lg font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="text-center max-w-md bg-white rounded-2xl p-8 shadow-lg border border-slate-200">
          <div className="text-red-500 text-5xl mb-4">⚠</div>
          <p className="text-slate-700 text-lg font-medium mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-[#0f2f5f] text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (step === 'services') {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 py-6 px-6 shadow-sm">
          <h1 className="text-3xl font-bold text-center text-[#0f2f5f]">{branchName}</h1>
          <p className="text-center text-slate-500 mt-1 text-base">Select a window to get your queue number</p>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-5xl">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4 text-center font-medium">
                {error}
              </div>
            )}

            {services.length === 0 ? (
              <div className="text-center text-slate-500 bg-white rounded-xl p-8 border border-slate-200 shadow-sm">
                <p className="text-xl">No windows available at this time.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                {services.map((svc) => (
                  <button
                    key={svc.service_type}
                    onClick={() => handleSelectService(svc.service_type)}
                    disabled={loading}
                    className="relative flex flex-col justify-between p-6 bg-white hover:bg-blue-50 border-2 border-slate-200 hover:border-[#0f2f5f] rounded-2xl text-left transition-all disabled:opacity-50 active:scale-[0.98] shadow-sm h-full"
                  >
                    {/* Top row: label + window badge */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-2xl font-bold text-[#0f2f5f]">{svc.label}</div>
                        <div className="text-slate-500 text-sm mt-0.5">{svc.description || svc.service_type}</div>
                      </div>
                      <div className="shrink-0 bg-[#0f2f5f] text-white text-xs font-bold px-3 py-1 rounded-full">
                        Window {svc.assigned_window_number || '–'}
                      </div>
                    </div>

                    {/* Bottom: live counts always at same position */}
                    <div className="flex flex-wrap gap-2 mt-auto pt-2">
                      <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 text-xs font-semibold text-amber-800">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        {svc.waiting_count} waiting
                      </span>
                      {svc.serving_count > 0 && (
                        <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-xs font-semibold text-blue-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          {svc.serving_count} serving
                        </span>
                      )}
                      {svc.current_serving_queue_number && (
                        <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 text-xs font-semibold text-emerald-800">
                          Now: {svc.current_serving_queue_number}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        <footer className="bg-white border-t border-slate-200 py-3 px-6 text-center text-slate-400 text-sm">
          WARDS Queue Kiosk
        </footer>
      </div>
    );
  }

  if (step === 'name') {
    const selected = services.find((s) => s.service_type === selectedService);
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="w-full max-w-lg bg-white rounded-3xl p-8 md:p-10 shadow-xl border border-slate-200">
          <button
            onClick={() => setStep('services')}
            className="mb-4 text-sm text-slate-500 hover:text-[#0f2f5f] flex items-center gap-1"
          >
            ← Back
          </button>

          <div className="text-center mb-6">
            <div className="text-slate-500 text-sm font-medium mb-1">
              {selected?.label} — Window {selected?.assigned_window_number || '–'}
            </div>
            <h2 className="text-2xl font-bold text-[#0f2f5f]">Enter Your Full Name</h2>
          </div>

          <div className="space-y-4">
            <div>
              <input
                type="text"
                value={taxpayerName}
                onChange={(e) => {
                  setTaxpayerName(e.target.value);
                  if (nameError) setNameError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGetTicket();
                }}
                placeholder="Juan Dela Cruz"
                autoFocus
                className={`w-full px-5 py-4 text-lg border-2 rounded-xl outline-none transition-colors ${
                  nameError
                    ? 'border-red-300 focus:border-red-500 bg-red-50'
                    : 'border-slate-200 focus:border-[#0f2f5f] bg-white'
                }`}
              />
              {nameError && (
                <p className="mt-2 text-sm text-red-600 font-medium">{nameError}</p>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Letters and spaces only. No numbers or special characters.
              </p>
            </div>

            <button
              onClick={handleGetTicket}
              disabled={loading || !taxpayerName.trim()}
              className="w-full px-6 py-4 bg-[#0f2f5f] text-white rounded-xl font-bold text-lg hover:bg-slate-800 transition-colors shadow-md disabled:bg-slate-300"
            >
              {loading ? 'Generating Ticket...' : 'Get Queue Number'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'ticket') {
    const aheadCount = ticket?.waiting_count ?? 0;
    const servingCount = ticket?.serving_count ?? 0;
    const estimatedWait = ticket?.estimated_wait_minutes;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="w-full max-w-2xl bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-slate-200 text-center">
          <div className="text-slate-500 text-lg font-medium mb-2">Your Queue Number</div>
          <div className="text-7xl md:text-8xl font-black text-[#0f2f5f] mb-6 tracking-wider">
            {ticket?.queue_number}
          </div>

          {/* Live status badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-5 py-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
              </span>
              <span className="text-amber-800 font-semibold text-sm">
                {aheadCount} {aheadCount === 1 ? 'person' : 'people'} ahead
              </span>
            </div>
            {servingCount > 0 && (
              <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-5 py-2.5">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span className="text-blue-800 font-semibold text-sm">
                  {servingCount} {servingCount === 1 ? 'window' : 'windows'} serving
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 mb-8">
            <div className="text-xl font-semibold text-slate-700">{ticket?.branch_name}</div>
            <div className="text-slate-500">
              {services.find((s) => s.service_type === selectedService)?.label || selectedService}
            </div>
            {estimatedWait !== null && estimatedWait !== undefined && (
              <div className="text-slate-600 text-base">
                Estimated wait: <span className="text-[#0f2f5f] font-bold">{estimatedWait} minutes</span>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-8">
            <button
              onClick={handleRestart}
              disabled={loading}
              className="px-10 py-4 bg-[#0f2f5f] text-white hover:bg-slate-800 rounded-2xl font-bold text-lg transition-colors shadow-md"
            >
              Get Another Ticket
            </button>
          </div>
        </div>

        <div className="mt-6 text-slate-400 text-sm">
          Please wait for your number to be called.
        </div>
        <div className="mt-2 text-slate-400 text-xs">
          Returning to start in {countdown} second{countdown !== 1 ? 's' : ''}...
        </div>
      </div>
    );
  }

  return null;
}
