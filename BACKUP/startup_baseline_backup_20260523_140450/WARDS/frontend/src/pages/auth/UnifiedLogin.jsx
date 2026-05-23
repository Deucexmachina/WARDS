import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';

import { getPortalHome, getStoredPortal, persistSession } from '../../utils/auth';

const API_URL = 'http://localhost:8000';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';
const CAPTCHA_THRESHOLD = 3;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 2 * 60 * 1000;

const portalCopy = {
  public: {
    title: 'Citizen Access',
    subtitle: 'Email and password with reCAPTCHA protection',
    accent: 'from-green-600 via-green-700 to-emerald-800',
    button: 'bg-green-600 hover:bg-green-700',
  },
  admin: {
    title: 'Main Office Admin',
    subtitle: 'MFA required for secured access',
    accent: 'from-blue-900 via-blue-800 to-slate-900',
    button: 'bg-blue-600 hover:bg-blue-700',
  },
  branch: {
    title: 'Branch Office',
    subtitle: 'MFA required for staff and branch admins',
    accent: 'from-indigo-800 via-slate-800 to-purple-900',
    button: 'bg-purple-600 hover:bg-purple-700',
  },
  default: {
    title: 'WARDS Login',
    subtitle: '',
    accent: 'from-slate-900 via-blue-900 to-teal-800',
    button: 'bg-slate-900 hover:bg-slate-800',
  },
};

const EyeIcon = ({ open }) => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {open ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.956 9.956 0 012.2-3.592M6.223 6.223A9.965 9.965 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.97 9.97 0 01-4.132 5.411M15 12a3 3 0 00-4.755-2.455M9.88 9.88A3 3 0 0014.12 14.12M3 3l18 18" />
      </>
    )}
  </svg>
);

const UnifiedLogin = ({ preferredPortal = null }) => {
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info');
  const [step, setStep] = useState('credentials');
  const [detectedPortal, setDetectedPortal] = useState('default');
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const getRequestedPortal = () => {
    if (preferredPortal) {
      return preferredPortal;
    }

    const explicitPortal = searchParams.get('portal');
    if (explicitPortal) {
      return explicitPortal;
    }

    const pendingRedirect = sessionStorage.getItem('redirectAfterLogin');
    const sessionPortal = sessionStorage.getItem('loginPortal');
    if (pendingRedirect && sessionPortal) {
      return sessionPortal;
    }

    return null;
  };

  const getActivePortal = () => {
    const requestedPortal = getRequestedPortal();
    if (requestedPortal) {
      return requestedPortal;
    }

    if (detectedPortal && detectedPortal !== 'default') {
      return detectedPortal;
    }

    return null;
  };

  const getTrackingKey = (value, portal = getActivePortal()) => {
    return `loginGuard:${portal || 'default'}:${value.trim().toLowerCase()}`;
  };

  const getSharedStaffTrackingKey = (value) => {
    return `loginGuard:staff:${value.trim().toLowerCase()}`;
  };

  const shouldUseSharedStaffGuard = (portal) => {
    return !portal || portal === 'default' || portal === 'unknown' || portal === 'admin' || portal === 'branch';
  };

  const mergeGuardState = (...states) => {
    return states.reduce(
      (merged, state) => ({
        attempts: Math.max(merged.attempts, Number(state?.attempts || 0)),
        lockedUntil: Math.max(merged.lockedUntil || 0, state?.lockedUntil || 0) || null,
      }),
      { attempts: 0, lockedUntil: null },
    );
  };

  const readGuardState = (value, portal = getActivePortal()) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return { attempts: 0, lockedUntil: null };
    }

    try {
      const readStateForKey = (storageKey) => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
          return { attempts: 0, lockedUntil: null };
        }

        const parsed = JSON.parse(raw);
        if (parsed.lockedUntil && parsed.lockedUntil <= Date.now()) {
          localStorage.removeItem(storageKey);
          return { attempts: 0, lockedUntil: null };
        }

        return {
          attempts: Number(parsed.attempts || 0),
          lockedUntil: parsed.lockedUntil || null,
        };
      };

      const exactState = readStateForKey(getTrackingKey(normalized, portal));
      const sharedState = shouldUseSharedStaffGuard(portal)
        ? readStateForKey(getSharedStaffTrackingKey(normalized))
        : { attempts: 0, lockedUntil: null };

      return mergeGuardState(exactState, sharedState);
    } catch {
      return { attempts: 0, lockedUntil: null };
    }
  };

  const writeGuardState = (value, nextState, portal = getActivePortal()) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    localStorage.setItem(getTrackingKey(normalized, portal), JSON.stringify(nextState));
    if (shouldUseSharedStaffGuard(portal)) {
      localStorage.setItem(getSharedStaffTrackingKey(normalized), JSON.stringify(nextState));
    }
  };

  const clearGuardState = (value, portal = getActivePortal()) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    localStorage.removeItem(getTrackingKey(normalized, portal));
    localStorage.removeItem(getTrackingKey(normalized, 'default'));
    localStorage.removeItem(getTrackingKey(normalized, 'unknown'));
    localStorage.removeItem(getTrackingKey(normalized, 'admin'));
    localStorage.removeItem(getTrackingKey(normalized, 'branch'));
    localStorage.removeItem(getSharedStaffTrackingKey(normalized));
  };

  const getLockMessage = (lockedUntil) => {
    const remainingMs = Math.max(0, lockedUntil - Date.now());
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return `Account is locked. Please try again in ${seconds} seconds.`;
  };

  const registerFailedAttempt = (value, portal = getActivePortal()) => {
    const current = readGuardState(value, portal);
    const nextAttempts = current.attempts + 1;
    const lockedUntil = nextAttempts >= LOCKOUT_THRESHOLD ? Date.now() + LOCKOUT_DURATION_MS : null;
    const nextState = { attempts: nextAttempts, lockedUntil };
    writeGuardState(value, nextState, portal);

    if (nextAttempts >= CAPTCHA_THRESHOLD) {
      setRequiresCaptcha(true);
    }

    return nextState;
  };

  useEffect(() => {
    const requestedPortal = getRequestedPortal();
    const pendingRedirect = sessionStorage.getItem('redirectAfterLogin');
    const portal = getStoredPortal();
    if (portal && !requestedPortal) {
      navigate(getPortalHome(portal), { replace: true });
      return;
    }
    if (pendingRedirect && requestedPortal === 'branch') {
      setDetectedPortal('branch');
      return;
    }
    if (requestedPortal) {
      setDetectedPortal(requestedPortal);
      return;
    }
    setDetectedPortal('default');
  }, [navigate, searchParams]);

  useEffect(() => {
    const requestedPortal = getRequestedPortal();
    const loginMessage = sessionStorage.getItem('loginMessage');
    const loginMessageType = sessionStorage.getItem('loginMessageType');
    if (requestedPortal && detectedPortal === 'default') {
      setDetectedPortal(requestedPortal);
    }
    if (loginMessage && location.pathname === '/login') {
      if (loginMessageType === 'success') {
        setNotice(loginMessage);
        setNoticeType('success');
      } else {
        setError(loginMessage);
      }
      sessionStorage.removeItem('loginMessage');
      sessionStorage.removeItem('loginMessageType');
    }
  }, [detectedPortal, error, location.pathname, searchParams]);

  useEffect(() => {
    const guardState = readGuardState(identifier);
    setRequiresCaptcha(guardState.attempts >= CAPTCHA_THRESHOLD);
  }, [identifier, detectedPortal, searchParams]);

  const redirectAfterLogin = (portal) => {
    const redirectTarget = sessionStorage.getItem('redirectAfterLogin');
    sessionStorage.removeItem('loginPortal');

    if (portal === 'branch' && redirectTarget) {
      sessionStorage.removeItem('redirectAfterLogin');
      sessionStorage.removeItem('loginMessage');
      navigate(redirectTarget, { replace: true });
      return;
    }

    if (portal === 'public') {
      const publicRedirectTarget = redirectTarget || '/';
      sessionStorage.removeItem('redirectAfterLogin');
      sessionStorage.removeItem('loginMessage');
      navigate(publicRedirectTarget, { replace: true });
      return;
    }

    sessionStorage.removeItem('redirectAfterLogin');
    sessionStorage.removeItem('loginMessage');
    navigate(getPortalHome(portal), { replace: true });
  };

  const prepareMfaSetup = async (portalOverride = getActivePortal(), preserveLoading = false) => {
    const requestedPortal = portalOverride && portalOverride !== 'default' ? portalOverride : undefined;

    if (!preserveLoading) {
      setLoading(true);
    }
    setError('');
    setNotice('');

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/setup-mfa`, {
        identifier,
        password,
        portal: requestedPortal,
      });

      if (response.data.portal) {
        setDetectedPortal(response.data.portal);
      } else if (requestedPortal) {
        setDetectedPortal(requestedPortal);
      }

      clearGuardState(identifier, requestedPortal);
      setShowMfaSetup(false);
      setMfaSetupData(response.data);
      setStep('setup');
      setNotice('MFA setup started. Scan the QR code with Microsoft Authenticator, then sign in again.');
      setNoticeType('success');
      return true;
    } catch (err) {
      setShowMfaSetup(true);
      setError(err.response?.data?.detail || 'Failed to start MFA setup.');
      return false;
    } finally {
      if (!preserveLoading) {
        setLoading(false);
      }
    }
  };

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    const guardState = readGuardState(identifier);
    if (guardState.lockedUntil && guardState.lockedUntil > Date.now()) {
      setError(getLockMessage(guardState.lockedUntil));
      setRequiresCaptcha(true);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setShowMfaSetup(false);

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/login`, {
        identifier,
        password,
        portal: preferredPortal === 'public' ? 'public' : undefined,
        recaptcha_token: recaptchaToken || undefined,
      });

      setDetectedPortal(response.data.portal);

      if (response.data.requires_mfa) {
        const latestGuardState = readGuardState(identifier, response.data.portal);
        if (latestGuardState.lockedUntil && latestGuardState.lockedUntil > Date.now()) {
          setError(getLockMessage(latestGuardState.lockedUntil));
          setRequiresCaptcha(true);
          return;
        }
        setStep('totp');
        setRequiresCaptcha(response.data.requires_captcha || false);
        return;
      }

      clearGuardState(identifier);
      persistSession(response.data);
      redirectAfterLogin(response.data.portal);
    } catch (err) {
      const portal = err.response?.headers?.['x-auth-portal'] || 'default';
      const detail = err.response?.data?.detail || 'Login failed. Please try again.';
      const requiresEmailVerification = err.response?.headers?.['x-requires-email-verification'] === 'true';

      if (requiresEmailVerification && portal === 'public') {
        const normalizedEmail = identifier.trim();
        sessionStorage.setItem(
          'pendingCitizenVerification',
          JSON.stringify({
            email: normalizedEmail,
            source: 'login',
            message: detail,
            resendAvailableInSeconds: 0,
          }),
        );
        navigate('/user/verify-email', {
          replace: true,
          state: {
            email: normalizedEmail,
            source: 'login',
            message: detail,
            resendAvailableInSeconds: 0,
          },
        });
        return;
      }

      setDetectedPortal(portal);
      const updatedGuardState = registerFailedAttempt(identifier, portal || getActivePortal());
      setError(updatedGuardState.lockedUntil ? getLockMessage(updatedGuardState.lockedUntil) : detail);

      if (
        err.response?.headers?.['x-requires-captcha'] === 'true' ||
        detail.toLowerCase().includes('captcha') ||
        updatedGuardState.attempts >= CAPTCHA_THRESHOLD
      ) {
        setRequiresCaptcha(true);
      }

      if (
        err.response?.headers?.['x-requires-mfa-setup'] === 'true' ||
        detail.toLowerCase().includes('mfa not configured')
      ) {
        await prepareMfaSetup(portal || getActivePortal(), true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (event) => {
    event.preventDefault();
    const guardState = readGuardState(identifier);
    if (guardState.lockedUntil && guardState.lockedUntil > Date.now()) {
      setError(getLockMessage(guardState.lockedUntil));
      setRequiresCaptcha(true);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/login`, {
        identifier,
        password,
        portal: preferredPortal === 'public' ? 'public' : undefined,
        totp_code: totpCode,
        recaptcha_token: recaptchaToken || undefined,
      });

      clearGuardState(identifier);
      persistSession(response.data);
      redirectAfterLogin(response.data.portal);
    } catch (err) {
      const portal = err.response?.headers?.['x-auth-portal'] || detectedPortal;
      setDetectedPortal(portal || 'default');
      const detail = err.response?.data?.detail || 'Invalid TOTP code. Please try again.';
      const updatedGuardState = registerFailedAttempt(identifier, portal || getActivePortal());
      setError(updatedGuardState.lockedUntil ? getLockMessage(updatedGuardState.lockedUntil) : detail);
      setTotpCode('');
      if (
        err.response?.headers?.['x-requires-captcha'] === 'true' ||
        detail.toLowerCase().includes('captcha') ||
        updatedGuardState.attempts >= CAPTCHA_THRESHOLD
      ) {
        setRequiresCaptcha(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetupMfa = async () => {
    await prepareMfaSetup(getActivePortal());
  };

  const copy = portalCopy[detectedPortal] || portalCopy.default;
  const showPasswordToggle = step === 'credentials' && Boolean(password);

  return (
    <div className={`min-h-screen bg-gradient-to-br ${copy.accent} flex items-center justify-center p-4`}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{copy.title}</h1>
          <p className="text-gray-600 mt-2">{copy.subtitle}</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {notice && (
          <div className={`mb-6 p-4 rounded-xl border ${noticeType === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            <p className="text-sm font-semibold">{notice}</p>
          </div>
        )}

        {step === 'credentials' && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email or Username</label>
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="name@example.com or staff username"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`w-full border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    showPasswordToggle ? 'px-4 py-3 pr-12' : 'px-4 py-3'
                  }`}
                  required
                  autoComplete="current-password"
                />
                {showPasswordToggle ? (
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-500 transition hover:text-gray-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 text-right">
                <Link
                  to={`/forgot-password${getActivePortal() ? `?portal=${getActivePortal()}` : ''}`}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Forgot Password?
                </Link>
              </div>
            </div>

            {requiresCaptcha && (
              <div className="flex justify-center">
                <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setRecaptchaToken} />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (requiresCaptcha && !recaptchaToken)}
              className={`w-full ${copy.button} text-white py-3 rounded-xl font-semibold transition disabled:opacity-50`}
            >
              {loading ? 'Checking account...' : 'Continue'}
            </button>

            {showMfaSetup && (
              <button
                type="button"
                onClick={handleSetupMfa}
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-semibold transition disabled:opacity-50"
              >
                Set Up MFA
              </button>
            )}
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={handleTotpSubmit} className="space-y-5">
            <div className="text-center">
              <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
              <p className="mt-2 text-xs text-gray-500">
                Use the current code from Microsoft Authenticator. If the code fails, check that your device time is set automatically and try again.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Authenticator Code</label>
              <input
                type="text"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="000000"
                required
                maxLength="6"
                autoComplete="one-time-code"
              />
            </div>

            {requiresCaptcha && (
              <div className="flex justify-center">
                <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setRecaptchaToken} />
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setTotpCode('');
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-3 rounded-xl font-semibold transition"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6 || (requiresCaptcha && !recaptchaToken)}
                className={`flex-1 ${copy.button} text-white py-3 rounded-xl font-semibold transition disabled:opacity-50`}
              >
                {loading ? 'Signing in...' : 'Login'}
              </button>
            </div>
          </form>
        )}

        {step === 'setup' && mfaSetupData && (
          <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl">
              <p className="text-sm font-semibold">Scan this QR code in Microsoft Authenticator, then sign in again.</p>
            </div>

            <div className="flex justify-center">
              <img src={mfaSetupData.qr_code} alt="MFA QR code" className="w-56 h-56 rounded-xl border-4 border-white shadow-lg" />
            </div>

            <code className="block bg-slate-100 text-slate-700 p-3 rounded-xl text-xs break-all">
              {mfaSetupData.manual_entry_key}
            </code>

            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setMfaSetupData(null);
                setError('');
              }}
              className={`w-full ${copy.button} text-white py-3 rounded-xl font-semibold transition`}
            >
              Return to Login
            </button>
          </div>
        )}

        <div className="mt-8 text-center space-y-3">
          <p className="text-sm text-gray-600">
            Public users can still create an account here.
          </p>
          <Link to="/user/register" className="text-green-600 hover:text-green-700 font-semibold text-sm">
            Register as a citizen
          </Link>
          <div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-sm text-gray-500 hover:text-gray-700 font-semibold"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedLogin;
