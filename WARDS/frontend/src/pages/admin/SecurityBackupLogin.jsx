import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';

import { API_HOST } from '../../services/api';

const clearSecuritySession = () => {
  localStorage.removeItem('securityAuthenticated');
  localStorage.removeItem('securityAuthenticatedAt');
  sessionStorage.removeItem('securityAuthenticated');
  sessionStorage.removeItem('securityAuthenticatedAt');
};

const SecurityBackupLogin = () => {
  useState(() => {
    clearSecuritySession();
    return null;
  });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [step, setStep] = useState('credentials');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const currentAdmin = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const isSuperadmin = currentAdmin?.internal_role === 'superadmin';

  useEffect(() => {
    if (!localStorage.getItem('adminToken')) {
      navigate('/login', { replace: true });
      return;
    }
    clearSecuritySession();
  }, [navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const currentEmail = String(currentAdmin?.email || '').toLowerCase();
      if (normalizedIdentifier && currentEmail && normalizedIdentifier !== currentEmail) {
        setError('Use the same admin account that is already signed in to the main dashboard.');
        return;
      }

      const response = await axios.post(`${API_HOST}/api/auth/unified/login`, {
        identifier,
        password,
        portal: 'admin',
        totp_code: step === 'totp' ? totpCode : undefined,
      });

      if (response.data.requires_mfa) {
        setStep('totp');
        return;
      }

      if (response.data.portal !== 'admin') {
        setError('Only main office admin or superadmin accounts can access the Security Dashboard.');
        return;
      }

      if (currentAdmin?.id && response.data.user?.id && Number(response.data.user.id) !== Number(currentAdmin.id)) {
        setError('Security Dashboard re-authentication must use the same admin account that opened the main dashboard.');
        clearSecuritySession();
        return;
      }

      localStorage.setItem('adminToken', response.data.access_token);
      localStorage.setItem('adminUser', JSON.stringify(response.data.user));
      if (!localStorage.getItem('adminAuthenticatedAt')) {
        localStorage.setItem('adminAuthenticatedAt', new Date(Date.now() - 1000).toISOString());
      }
      sessionStorage.setItem('securityAuthenticated', 'true');
      sessionStorage.setItem('securityAuthenticatedAt', new Date().toISOString());
      import('./BackupRecovery');
      navigate('/admin/backup', { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail || 'Security Dashboard login failed.';
      if (String(detail).toLowerCase().includes('mfa not configured')) {
        setError('MFA is required. Set up Microsoft Authenticator in the main WARDS login first.');
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setTotpCode('');
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Security Dashboard</h1>
          <p className="mt-2 text-gray-600">
            {step === 'totp' ? 'MFA required for secured recovery access' : 'Backup & Recovery secured access'}
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {step === 'credentials' && (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Email Address</label>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder="admin@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500"
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Checking account...' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={submit} className="space-y-5">
            <div className="text-center">
              <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
              <p className="mt-2 text-xs text-gray-500">
                Use the current code from Microsoft Authenticator. If the code fails, check that your device time is set automatically and try again.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Authenticator Code</label>
              <input
                type="text"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder="000000"
                maxLength="6"
                autoComplete="one-time-code"
                required
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={backToCredentials}
                className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-800 transition hover:bg-gray-300"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Login'}
              </button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <Link to="/admin" className="text-sm font-semibold text-slate-600 hover:text-primary">
            Return to {isSuperadmin ? 'superadmin' : 'main admin'} dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SecurityBackupLogin;
