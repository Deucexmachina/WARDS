import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';

export default function KioskManagement() {
  const { branchSlug } = useParams();
  const [devices, setDevices] = useState([]);
  const [kioskName, setKioskName] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [branchId, setBranchId] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    fetchBranchId().then(() => loadDevices());
  }, []);

  const fetchBranchId = async () => {
    try {
      const res = await api.get('/branch/dashboard');
      setBranchId(res.data?.branch?.id);
    } catch (err) {
      setMessage({ text: 'Failed to load branch info', type: 'error' });
    }
  };

  const loadDevices = async () => {
    try {
      const res = await api.get('/kiosk/devices');
      setDevices(res.data || []);
    } catch (err) {
      setMessage({ text: 'Failed to load kiosk devices', type: 'error' });
    }
  };

  const handleGeneratePairingCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPairingCode('');
    try {
      const res = await api.post('/kiosk/pair', {
        branch_id: branchId,
        name: kioskName || 'Kiosk',
      });
      setPairingCode(res.data.pairing_code);
      setMessage({ text: `Pairing code generated: ${res.data.pairing_code}`, type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to generate pairing code', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/kiosk/pin', { pin });
      setMessage({ text: 'Daily kiosk PIN updated successfully', type: 'success' });
      setPin('');
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to set PIN', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleUnpair = async (deviceId) => {
    if (!window.confirm('Are you sure you want to unpair this kiosk device?')) return;
    setLoading(true);
    try {
      await api.post(`/kiosk/unpair/${deviceId}`);
      setMessage({ text: 'Device unpaired successfully', type: 'success' });
      loadDevices();
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to unpair device', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Kiosk Management</h1>

      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Daily PIN */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Daily Kiosk PIN</h2>
        <p className="text-sm text-slate-500 mb-4">
          Set a 4-10 digit PIN that staff must enter on the kiosk each morning to unlock it.
        </p>
        <form onSubmit={handleSetPin} className="flex gap-3">
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="Enter new PIN"
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed font-medium"
          >
            Set PIN
          </button>
        </form>
      </div>

      {/* Generate Pairing Code */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Pair New Kiosk Device</h2>
        <p className="text-sm text-slate-500 mb-4">
          Enter a name for the kiosk (e.g., &quot;Main Entrance&quot;) and generate a pairing code.
          Staff will enter this code on the tablet to pair it to this branch.
        </p>
        <form onSubmit={handleGeneratePairingCode} className="flex gap-3">
          <input
            type="text"
            value={kioskName}
            onChange={(e) => setKioskName(e.target.value)}
            placeholder="Kiosk name (e.g., Main Entrance)"
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed font-medium"
          >
            Generate Code
          </button>
        </form>

        {pairingCode && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
            <div className="text-sm text-green-700 mb-1">Pairing Code (valid 10 minutes)</div>
            <div className="text-4xl font-bold text-green-800 tracking-[0.3em]">{pairingCode}</div>
          </div>
        )}
      </div>

      {/* Paired Devices */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Paired Kiosk Devices</h2>
        {devices.length === 0 ? (
          <p className="text-slate-500 text-sm">No kiosk devices have been paired to this branch yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Paired</th>
                  <th className="px-4 py-3 font-medium">Last Active</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{device.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        device.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : device.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {device.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {device.paired_at ? new Date(device.paired_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleUnpair(device.id)}
                        disabled={loading}
                        className="text-red-600 hover:text-red-800 text-sm font-medium disabled:text-slate-400"
                      >
                        Unpair
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
