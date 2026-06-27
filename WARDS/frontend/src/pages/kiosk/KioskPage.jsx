import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_HOST } from '../../services/api';

export default function KioskPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState('loading'); // loading, error, services, ticket
  const [services, setServices] = useState([]);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [loading, setLoading] = useState(false);

  const branchId = searchParams.get('branch');
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
    setStep('services');
  };

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white">
        <div className="text-2xl animate-pulse">Loading...</div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white p-4">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-4xl mb-4">⚠</div>
          <p className="text-lg mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (step === 'services') {
    return (
      <div className="flex flex-col min-h-screen bg-slate-900 text-white">
        <header className="bg-slate-800 border-b border-slate-700 py-8 px-8">
          <h1 className="text-4xl font-bold text-center">{branchName}</h1>
          <p className="text-center text-slate-400 mt-2 text-lg">Tap a service to get your queue number</p>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-5xl">
            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg text-sm mb-6 text-center">
                {error}
              </div>
            )}

            {services.length === 0 ? (
              <div className="text-center text-slate-400">
                <p className="text-xl">No services available.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {services.map((svc) => (
                  <button
                    key={svc.service_type}
                    onClick={() => handleGetTicket(svc.service_type)}
                    disabled={loading}
                    className="p-10 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-2xl text-left transition-colors disabled:opacity-50 active:scale-[0.98]"
                  >
                    <div className="text-3xl font-semibold mb-2">{svc.label}</div>
                    <div className="text-slate-400 text-sm">{svc.service_type}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        <footer className="bg-slate-800 border-t border-slate-700 py-4 px-8 text-center text-slate-500 text-sm">
          WARDS Queue Kiosk
        </footer>
      </div>
    );
  }

  if (step === 'ticket') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-4">
        <div className="w-full max-w-2xl bg-slate-800 rounded-3xl p-12 shadow-2xl border border-slate-700 text-center">
          <div className="text-slate-400 text-xl mb-4">Your Queue Number</div>
          <div className="text-8xl font-bold text-blue-400 mb-8 tracking-wider">
            {ticket?.queue_number}
          </div>

          <div className="space-y-3 mb-10">
            <div className="text-2xl">{ticket?.branch_name}</div>
            <div className="text-slate-400">{services.find(s => s.service_type === selectedService)?.label || selectedService}</div>
            {ticket?.estimated_wait_minutes !== null && (
              <div className="text-slate-300 text-lg">
                Estimated wait: <span className="text-white font-semibold">{ticket?.estimated_wait_minutes} minutes</span>
              </div>
            )}
          </div>

          <button
            onClick={handleRestart}
            disabled={loading}
            className="px-10 py-5 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-xl transition-colors"
          >
            Get Another Ticket
          </button>
        </div>

        <div className="mt-8 text-slate-500 text-sm">
          Please wait for your number to be called.
        </div>
      </div>
    );
  }

  return null;
}
