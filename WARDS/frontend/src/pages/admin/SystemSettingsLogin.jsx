import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  clearSettingsSession,
  isSettingsRoleAllowed,
  startSettingsSession,
} from '../../utils/settingsSecurity';
import { AUTH_GRADIENTS } from '../../utils/authTheme';

const API_URL = 'http://localhost:8000';

const SystemSettingsLogin = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [step, setStep] = useState('credentials');
  const [error, setError] = useState('');
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [totpError, setTotpError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const currentAdmin = useMemo(() => JSON.parse(localStorage.getItem('adminUser') || '{}'), []);
  const isSuperadmin = currentAdmin?.internal_role === 'superadmin';
  const adminRoleLabel = isSuperadmin ? 'Superadmin' : 'Main Admin';

  const getIdentifierLabel = () => 'Email Address';
  const validateIdentifier = (value) => (String(value || '').trim() ? '' : `Please enter your ${getIdentifierLabel()}.`);
  const validatePassword = (value) => (String(value || '') ? '' : 'Please enter your Password.');
  const validateTotpCode = (value) => {
    const trimmedValue = String(value || '').trim();
    if (!trimmedValue) {
      return 'Please enter your Authenticator Code.';
    }
    if (!/^\d{6}$/.test(trimmedValue)) {
      return 'Please enter a valid 6-digit authenticator code.';
    }
    return '';
  };

  const normalizeLoginErrorMessage = (message) => {
    const normalizedMessage = String(message || '').trim();
    const lowerMessage = normalizedMessage.toLowerCase();

    if (!normalizedMessage) {
      return 'Login failed. Please try again.';
    }
    if (lowerMessage.includes('invalid credentials')) {
      return 'Invalid Email Address or Password.';
    }
    if (lowerMessage === 'account is not active') {
      return 'This account is currently inactive. Please contact an administrator.';
    }
    return normalizedMessage;
  };

  useEffect(() => {
    let active = true;

    const verifyAccess = async () => {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        navigate('/login', { replace: true });
        return;
      }

      clearSettingsSession();

      if (!isSettingsRoleAllowed(currentAdmin)) {
        navigate('/admin', { replace: true });
        return;
      }

      try {
        await axios.get(`${API_URL}/api/settings/access`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (accessError) {
        if (active) {
          navigate('/admin', { replace: true });
        }
      }
    };

    verifyAccess();

    return () => {
      active = false;
    };
  }, [currentAdmin, navigate]);

  const submit = async (event) => {
    event.preventDefault();
    if (step === 'credentials') {
      const nextIdentifierError = validateIdentifier(identifier);
      const nextPasswordError = validatePassword(password);
      setIdentifierError(nextIdentifierError);
      setPasswordError(nextPasswordError);
      setTotpError('');
      if (nextIdentifierError && nextPasswordError) {
        setError(`Please enter your ${getIdentifierLabel()} and Password.`);
        return;
      }
      if (nextIdentifierError || nextPasswordError) {
        setError(nextIdentifierError || nextPasswordError);
        return;
      }
    } else {
      const nextTotpError = validateTotpCode(totpCode);
      setTotpError(nextTotpError);
      if (nextTotpError) {
        setError(nextTotpError);
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const currentEmail = String(currentAdmin?.email || '').toLowerCase();

      if (normalizedIdentifier && currentEmail && normalizedIdentifier !== currentEmail) {
        setError('Use the same admin account that is already signed in to the main dashboard.');
        return;
      }

      const response = await axios.post(`${API_URL}/api/auth/unified/login`, {
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
        setError('Only Super Admin and Main Admin accounts can access System Settings.');
        clearSettingsSession();
        return;
      }

      if (currentAdmin?.id && response.data.user?.id && Number(response.data.user.id) !== Number(currentAdmin.id)) {
        setError('System Settings re-authentication must use the same admin account that opened the dashboard.');
        clearSettingsSession();
        return;
      }

      if (!isSettingsRoleAllowed(response.data.user)) {
        setError('Only Super Admin and Main Admin accounts can access System Settings.');
        clearSettingsSession();
        return;
      }

      localStorage.setItem('adminToken', response.data.access_token);
      localStorage.setItem('adminUser', JSON.stringify(response.data.user));
      if (!localStorage.getItem('adminAuthenticatedAt')) {
        localStorage.setItem('adminAuthenticatedAt', new Date(Date.now() - 1000).toISOString());
      }
      startSettingsSession();
      navigate('/admin/settings', { replace: true });
    } catch (err) {
      const detail = normalizeLoginErrorMessage(err.response?.data?.detail || 'Login failed. Please try again.');
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
    setTotpError('');
  };

  return (
    <div className={`flex min-h-screen items-center justify-center bg-gradient-to-br ${AUTH_GRADIENTS.admin} p-4`}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{adminRoleLabel}</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">System Settings</h1>
          {step === 'totp' ? (
            <p className="mt-2 text-gray-600">MFA required for secured settings access</p>
          ) : null}
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {step === 'credentials' && (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">{getIdentifierLabel()}</label>
              <input
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setIdentifierError(validateIdentifier(event.target.value));
                  setError('');
                }}
                aria-invalid={identifierError ? 'true' : 'false'}
                className={`w-full rounded-xl border-2 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 ${
                  identifierError
                    ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500/20'
                    : 'border-gray-200 focus:ring-blue-500'
                }`}
                placeholder="admin@example.com"
                autoComplete="email"
                required
              />
              {identifierError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{identifierError}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError(validatePassword(event.target.value));
                    setError('');
                  }}
                  aria-invalid={passwordError ? 'true' : 'false'}
                  className={`w-full rounded-xl border-2 px-4 py-3 pr-12 outline-none transition focus:border-transparent focus:ring-2 ${
                    passwordError
                      ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500/20'
                      : 'border-gray-200 focus:ring-blue-500'
                  }`}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className={`absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 ${password ? '' : 'hidden'}`}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {passwordError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{passwordError}</p>
              ) : null}
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
          <form onSubmit={submit} noValidate className="space-y-5">
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
                onChange={(event) => {
                  const nextValue = event.target.value.replace(/\D/g, '').slice(0, 6);
                  setTotpCode(nextValue);
                  setTotpError(validateTotpCode(nextValue));
                  setError('');
                }}
                aria-invalid={totpError ? 'true' : 'false'}
                className={`w-full rounded-xl border-2 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none transition focus:border-transparent focus:ring-2 ${
                  totpError
                    ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500/20'
                    : 'border-gray-200 focus:ring-blue-500'
                }`}
                placeholder="000000"
                maxLength="6"
                autoComplete="one-time-code"
                required
              />
              {totpError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{totpError}</p>
              ) : null}
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

export default SystemSettingsLogin;
