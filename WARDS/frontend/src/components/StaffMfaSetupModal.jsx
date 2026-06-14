import { useState } from 'react';
import { unifiedAuthAPI } from '../services/api';

const StaffMfaSetupModal = ({ isOpen, user, portal, onLogout, onSuccess }) => {
  const [step, setStep] = useState('prompt');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const identifier = user?.email || user?.username;

  const resetState = () => {
    setStep('prompt');
    setPassword('');
    setTotpCode('');
    setMfaSetupData(null);
    setError('');
    setLoading(false);
  };

  const handleSetup = async () => {
    if (!password) {
      setError('Please enter your password to continue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await unifiedAuthAPI.setupMfa({
        identifier,
        password,
        portal,
      });
      setMfaSetupData(response.data);
      setStep('qr');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start MFA setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!totpCode || totpCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await unifiedAuthAPI.verifyMfaSetup({
        identifier,
        password,
        portal,
        totp_code: totpCode,
      });
      resetState();
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.detail || 'Verification failed. Please try again.');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl md:p-8">
        {step === 'prompt' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900">Set Up Multi-Factor Authentication</h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              To keep your account secure, you must set up Microsoft Authenticator before you can continue using the portal.
            </p>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onLogout}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Log Out
              </button>
              <button
                type="button"
                onClick={() => { setStep('password'); setError(''); }}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Set Up MFA
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Confirm Your Password</h2>
            <p className="text-sm text-slate-600">Please enter your password to proceed with MFA setup.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              placeholder="Enter your password"
              autoFocus
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onLogout}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Log Out
              </button>
              <button
                type="button"
                onClick={handleSetup}
                disabled={loading}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? 'Setting up...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {step === 'qr' && mfaSetupData && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Scan QR Code</h2>
            <p className="text-sm text-slate-600">
              Scan this QR code in Microsoft Authenticator, then enter the 6-digit code below.
            </p>
            <div className="flex justify-center">
              <img
                src={mfaSetupData.qr_code}
                alt="MFA QR code"
                className="w-44 h-44 rounded-xl border-4 border-white shadow-lg object-contain"
              />
            </div>
            <code className="block break-all rounded-lg bg-slate-100 p-2 text-xs text-slate-600 text-center">
              {mfaSetupData.manual_entry_key}
            </code>
            <input
              type="text"
              inputMode="numeric"
              value={totpCode}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                setTotpCode(next);
                setError('');
              }}
              maxLength={6}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onLogout}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Log Out
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={loading || totpCode.length !== 6}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffMfaSetupModal;
