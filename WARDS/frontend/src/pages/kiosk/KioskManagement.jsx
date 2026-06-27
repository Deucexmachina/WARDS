import { useState, useEffect } from 'react';
import api from '../../services/api';

export default function KioskManagement() {
  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [kioskUrl, setKioskUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [confirmAction, setConfirmAction] = useState(null); // 'disable' | 'regenerate' | null

  const confirmConfig = {
    disable: {
      title: 'Disable Kiosk',
      description: 'This will immediately stop all tablets from working. Citizens will no longer be able to queue from the kiosk.',
      confirmText: 'Disable Kiosk',
      confirmClass: 'bg-red-600 hover:bg-red-700',
      icon: (
        <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
    },
    regenerate: {
      title: 'Regenerate URL',
      description: 'This will invalidate the current tablet URL and generate a new one. You will need to update the tablet with the new link. All waiting, serving, and completed queues remain intact.',
      confirmText: 'Regenerate URL',
      confirmClass: 'bg-amber-600 hover:bg-amber-700',
      icon: (
        <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
    },
  };

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

  const handleDisable = () => setConfirmAction('disable');
  const handleRegenerate = () => setConfirmAction('regenerate');

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    setConfirmAction(null);
    setLoading(true);
    try {
      if (confirmAction === 'disable') {
        await api.post('/kiosk/admin/disable');
        setKioskEnabled(false);
        setKioskUrl('');
        setMessage({ text: 'Kiosk disabled.', type: 'success' });
      } else if (confirmAction === 'regenerate') {
        const res = await api.post('/kiosk/admin/regenerate');
        setKioskUrl(res.data.kiosk_url);
        setMessage({ text: 'New kiosk URL generated. Update the tablet with the new URL.', type: 'success' });
      }
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || `Failed to ${confirmAction} kiosk`, type: 'error' });
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

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                {confirmConfig[confirmAction].icon}
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">
                {confirmConfig[confirmAction].title}
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                {confirmConfig[confirmAction].description}
              </p>
            </div>
            <div className="flex gap-3 border-t border-slate-100 p-4">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeConfirmedAction}
                disabled={loading}
                className={`flex-1 px-4 py-2.5 rounded-xl text-white font-medium transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed ${confirmConfig[confirmAction].confirmClass}`}
              >
                {loading ? 'Processing...' : confirmConfig[confirmAction].confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
