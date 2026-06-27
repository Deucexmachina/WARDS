import { useState, useEffect } from 'react';
import api from '../../services/api';

export default function KioskManagement() {
  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [kioskUrl, setKioskUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await api.get('/kiosk/admin');
      setKioskEnabled(res.data.kiosk_enabled);
      setKioskUrl(res.data.kiosk_url || '');
    } catch (err) {
      setMessage({ text: 'Failed to load kiosk status', type: 'error' });
    }
  };

  const handleEnable = async () => {
    setLoading(true);
    try {
      const res = await api.post('/kiosk/admin/enable');
      setKioskEnabled(true);
      setKioskUrl(res.data.kiosk_url);
      setMessage({ text: 'Kiosk enabled. Copy the URL below and open it on the tablet.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to enable kiosk', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Disable kiosk? This will immediately stop all tablets from working.')) return;
    setLoading(true);
    try {
      await api.post('/kiosk/admin/disable');
      setKioskEnabled(false);
      setKioskUrl('');
      setMessage({ text: 'Kiosk disabled.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to disable kiosk', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm('Regenerate token? This will invalidate the current tablet URL.')) return;
    setLoading(true);
    try {
      const res = await api.post('/kiosk/admin/regenerate');
      setKioskUrl(res.data.kiosk_url);
      setMessage({ text: 'New kiosk URL generated. Update the tablet with the new URL.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to regenerate token', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fullUrl = kioskUrl ? `${window.location.origin}${kioskUrl}` : '';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Kiosk Management</h1>

      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-700">Kiosk Status</h2>
            <p className="text-sm text-slate-500">
              {kioskEnabled
                ? 'Kiosk is active. Citizens can queue from the branch tablet.'
                : 'Kiosk is disabled. Enable it to generate a tablet URL.'}
            </p>
          </div>
          <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
            kioskEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
          }`}>
            {kioskEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div className="flex gap-3">
          {!kioskEnabled ? (
            <button
              onClick={handleEnable}
              disabled={loading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 font-medium"
            >
              {loading ? 'Enabling...' : 'Enable Kiosk'}
            </button>
          ) : (
            <>
              <button
                onClick={handleRegenerate}
                disabled={loading}
                className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-slate-400 font-medium"
              >
                {loading ? 'Regenerating...' : 'Regenerate URL'}
              </button>
              <button
                onClick={handleDisable}
                disabled={loading}
                className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-slate-400 font-medium"
              >
                Disable Kiosk
              </button>
            </>
          )}
        </div>
      </div>

      {kioskEnabled && fullUrl && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Tablet URL</h2>
          <p className="text-sm text-slate-500 mb-4">
            Open this URL on the kiosk tablet (Chrome fullscreen mode recommended).
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={fullUrl}
              readOnly
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono text-slate-700 select-all"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(fullUrl);
                setMessage({ text: 'URL copied to clipboard!', type: 'success' });
              }}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-medium text-sm"
            >
              Copy
            </button>
          </div>
          <div className="mt-4">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open Kiosk in New Tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
