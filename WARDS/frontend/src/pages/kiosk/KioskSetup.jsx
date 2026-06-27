import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_HOST } from '../../services/api';

export default function KioskSetup() {
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Check if already paired
  useEffect(() => {
    const existingToken = localStorage.getItem('kiosk_device_token');
    const existingBranch = localStorage.getItem('kiosk_branch_id');
    if (existingToken && existingBranch) {
      navigate(`/kiosk/${existingBranch}`);
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!/^\d{6}$/.test(pairingCode)) {
      setError('Please enter a valid 6-digit pairing code.');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_HOST}/api/kiosk/verify`, {
        pairing_code: pairingCode,
      });

      const { device_token, branch_id } = response.data;
      localStorage.setItem('kiosk_device_token', device_token);
      localStorage.setItem('kiosk_branch_id', String(branch_id));

      navigate(`/kiosk/${branch_id}`);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Invalid or expired pairing code.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white p-4">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">WARDS Kiosk</h1>
          <p className="text-slate-400">Enter the pairing code provided by branch staff</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Pairing Code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full px-4 py-4 text-center text-3xl tracking-[0.5em] font-mono bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
              placeholder="000000"
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
            disabled={loading || pairingCode.length !== 6}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-colors"
          >
            {loading ? 'Pairing...' : 'Pair Kiosk'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Contact branch staff to generate a pairing code.
        </p>
      </div>
    </div>
  );
}
