import { useState, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_HOST } from '../../services/api';

export default function KioskPage() {
  const [searchParams] = useSearchParams();
  const { branchId: branchIdParam } = useParams();
  const [step, setStep] = useState('loading'); // loading, error, services, ticket
  const [services, setServices] = useState([]);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveAhead, setLiveAhead] = useState(null);

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

  const handleGetTicket = async (serviceType) => {
    setSelectedService(serviceType);
    setError('');
    setLoading(true);

    try {
      const res = await axios.post(
        `${API_HOST}/api/kiosk/ticket`,
        { service_type: serviceType },
        { headers: { 'X-Kiosk-Token': token, 'Content-Type': 'application/json' } }
      );
      setTicket(res.data);
      setLiveAhead(res.data.waiting_count);
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
    setError('');
    setLiveAhead(null);
    setStep('services');
  };

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
          <p className="text-center text-slate-500 mt-1 text-base">Select a service to get your queue number</p>
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
                <p className="text-xl">No services available at this time.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.map((svc) => (
                  <button
                    key={svc.service_type}
                    onClick={() => handleGetTicket(svc.service_type)}
                    disabled={loading}
                    className="p-8 bg-white hover:bg-blue-50 border-2 border-slate-200 hover:border-[#0f2f5f] rounded-2xl text-left transition-all disabled:opacity-50 active:scale-[0.98] shadow-sm"
                  >
                    <div className="text-2xl font-bold text-[#0f2f5f] mb-1">{svc.label}</div>
                    <div className="text-slate-500 text-sm">{svc.service_type}</div>
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
              {services.find(s => s.service_type === selectedService)?.label || selectedService}
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
      </div>
    );
  }

  return null;
}
