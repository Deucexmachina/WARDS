import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { API_HOST } from '../../services/api';

export default function KioskInterface() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState('loading'); // loading, unlock, services, ticket, error
  const [services, setServices] = useState([]);
  const [branchName, setBranchName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [loading, setLoading] = useState(false);

  const deviceToken = localStorage.getItem('kiosk_device_token');
  const storedBranchId = localStorage.getItem('kiosk_branch_id');

  // Validate device token on mount
  useEffect(() => {
    if (!deviceToken) {
      navigate('/kiosk-setup');
      return;
    }
    if (storedBranchId && storedBranchId !== branchId) {
      navigate(`/kiosk/${storedBranchId}`);
      return;
    }
    loadServices();
  }, [branchId, deviceToken, navigate, storedBranchId]);

  const loadServices = async () => {
    try {
      const res = await axios.get(`${API_HOST}/api/kiosk/services/${branchId}`);
      setServices(res.data.services || []);
      setBranchName(res.data.branch_name || '');
      setStep('unlock');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load kiosk services.');
      setStep('error');
    }
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await axios.post(`${API_HOST}/api/kiosk/unlock`, {
        branch_id: parseInt(branchId),
        pin,
      });
      setStep('services');
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid PIN. Please contact branch staff.');
    } finally {
      setLoading(false);
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
        { headers: { Authorization: `Bearer ${deviceToken}` } }
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

  const handleBack = () => {
    setTicket(null);
    setSelectedService(null);
    setError('');
    setStep('services');
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
          <div className="text-red-400 text-xl mb-4">⚠</div>
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

  if (step === 'unlock') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white p-4">
        <div className="w-full max-w-md bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">{branchName}</h1>
            <p className="text-slate-400">Enter today's kiosk PIN to continue</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Daily PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={10}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="w-full px-4 py-4 text-center text-3xl tracking-[0.3em] font-mono bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
                placeholder="••••"
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-colors"
            >
              {loading ? 'Unlocking...' : 'Unlock Kiosk'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'services') {
    return (
      <div className="flex flex-col min-h-screen bg-slate-900 text-white">
        <header className="bg-slate-800 border-b border-slate-700 py-6 px-8">
          <h1 className="text-3xl font-bold text-center">{branchName}</h1>
          <p className="text-center text-slate-400 mt-1">Select a service to get your queue number</p>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-4xl">
            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg text-sm mb-6 text-center">
                {error}
              </div>
            )}

            {services.length === 0 ? (
              <div className="text-center text-slate-400">
                <p className="text-xl">No services available at this branch.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {services.map((svc) => (
                  <button
                    key={svc.service_type}
                    onClick={() => handleGetTicket(svc.service_type)}
                    disabled={loading}
                    className="p-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-2xl font-semibold mb-2">{svc.label}</div>
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
        <div className="w-full max-w-lg bg-slate-800 rounded-2xl p-10 shadow-2xl border border-slate-700 text-center">
          <div className="text-slate-400 text-lg mb-4">Your Queue Number</div>
          <div className="text-7xl font-bold text-blue-400 mb-6 tracking-wider">
            {ticket?.queue_number}
          </div>

          <div className="space-y-3 mb-8">
            <div className="text-xl">{ticket?.branch_name}</div>
            <div className="text-slate-400">{services.find(s => s.service_type === selectedService)?.label || selectedService}</div>
            {ticket?.estimated_wait_minutes !== null && (
              <div className="text-slate-300">
                Estimated wait: <span className="text-white font-semibold">{ticket?.estimated_wait_minutes} minutes</span>
              </div>
            )}
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={handleRestart}
              disabled={loading}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-lg transition-colors"
            >
              Get Another Ticket
            </button>
          </div>
        </div>

        <div className="mt-8 text-slate-500 text-sm">
          Please wait for your number to be called.
        </div>
      </div>
    );
  }

  return null;
}
