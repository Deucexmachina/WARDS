import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';

import { getPortalHome, getStoredPortal, persistSession } from '../../utils/auth';
import { unifiedAuthAPI } from '../../services/api';
import { AUTH_GRADIENTS } from '../../utils/authTheme';
import cityHall from '../../assets/branding/qc_city_hall.jpg';

import { API_HOST } from '../../services/api';
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';
const CAPTCHA_THRESHOLD = 3;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 2 * 60 * 1000;

const portalCopy = {
  public: {
    title: 'Citizen Access',
    badge: 'Citizen Portal',
    subtitle: 'Sign in to your citizen account',
    accent: AUTH_GRADIENTS.public,
    badgeBg: 'bg-green-100 text-green-700',
    button: 'bg-green-600 hover:bg-green-700 shadow-green-200',
    focusRing: 'focus:ring-green-500',
    overlay: 'from-green-900/75 to-emerald-700/55',
    captionColor: 'text-green-200',
    captionBody: 'text-green-100',
  },
  admin: {
    title: 'Main Office Admin',
    badge: 'Admin Portal',
    subtitle: 'MFA required for secured access',
    accent: AUTH_GRADIENTS.admin,
    badgeBg: 'bg-blue-100 text-blue-700',
    button: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200',
    focusRing: 'focus:ring-blue-500',
    overlay: 'from-blue-900/75 to-blue-700/55',
    captionColor: 'text-blue-200',
    captionBody: 'text-blue-100',
  },
  branch: {
    title: 'Branch Office',
    badge: 'Branch Portal',
    subtitle: 'MFA required for staff and branch admins',
    accent: AUTH_GRADIENTS.branch,
    badgeBg: 'bg-purple-100 text-purple-700',
    button: 'bg-purple-600 hover:bg-purple-700 shadow-purple-200',
    focusRing: 'focus:ring-purple-500',
    overlay: 'from-purple-900/75 to-indigo-700/55',
    captionColor: 'text-purple-200',
    captionBody: 'text-purple-100',
  },
  default: {
    title: 'WARDS Login',
    badge: 'Portal Login',
    subtitle: 'Sign in to continue',
    accent: AUTH_GRADIENTS.default,
    badgeBg: 'bg-slate-100 text-slate-700',
    button: 'bg-slate-900 hover:bg-slate-800 shadow-slate-300',
    focusRing: 'focus:ring-slate-500',
    overlay: 'from-slate-900/75 to-teal-800/55',
    captionColor: 'text-slate-300',
    captionBody: 'text-slate-200',
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
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [totpError, setTotpError] = useState('');
  const [recoveryOtpCode, setRecoveryOtpCode] = useState('');
  const [recoveryOtpError, setRecoveryOtpError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

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

  const validateRecoveryOtpCode = (value) => {
    const trimmedValue = String(value || '').trim();
    if (!trimmedValue) {
      return 'Please enter the verification code from your email.';
    }
    if (!/^\d{6}$/.test(trimmedValue)) {
      return 'Please enter a valid 6-digit verification code.';
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

  const getSubmissionPortal = (fallbackPortal = detectedPortal) => {
    if (preferredPortal) {
      return preferredPortal;
    }

    const explicitPortal = searchParams.get('portal');
    if (explicitPortal) {
      return explicitPortal;
    }

    if (fallbackPortal && fallbackPortal !== 'default' && fallbackPortal !== 'unknown') {
      return fallbackPortal;
    }

    return undefined;
  };

  const lockDetectedPortal = (portal) => {
    if (!portal || portal === 'default' || portal === 'unknown') {
      return;
    }

    setDetectedPortal(portal);
    sessionStorage.setItem('loginPortal', portal);
    if (portal === 'public') {
      sessionStorage.removeItem('redirectAfterLogin');
    }
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
    if (preferredPortal === 'public' || searchParams.get('portal') === 'public') {
      sessionStorage.setItem('loginPortal', 'public');
      sessionStorage.removeItem('redirectAfterLogin');
      setDetectedPortal('public');
      return;
    }
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
      const response = await axios.post(`${API_HOST}/api/auth/unified/setup-mfa`, {
        identifier,
        password,
        portal: requestedPortal,
      });

      if (response.data.portal) {
        lockDetectedPortal(response.data.portal);
      } else if (requestedPortal) {
        lockDetectedPortal(requestedPortal);
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
      const response = await axios.post(`${API_HOST}/api/auth/unified/login`, {
        identifier,
        password,
        portal: getSubmissionPortal(),
        recaptcha_token: recaptchaToken || undefined,
      });

      lockDetectedPortal(response.data.portal);

      if (response.data.requires_mfa) {
        const latestGuardState = readGuardState(identifier, response.data.portal);
        if (latestGuardState.lockedUntil && latestGuardState.lockedUntil > Date.now()) {
          setError(getLockMessage(latestGuardState.lockedUntil));
          setRequiresCaptcha(true);
          return;
        }
        setStep('totp');
        setRequiresCaptcha(false);
        return;
      }

      clearGuardState(identifier);
      persistSession(response.data);
      if (response.data.portal === 'public' && response.data.mfa_setup_required) {
        sessionStorage.setItem('wards:publicMfaPrompt', 'true');
      }
      redirectAfterLogin(response.data.portal);
    } catch (err) {
      const portal = getSubmissionPortal() || 'default';
      const detail = normalizeLoginErrorMessage(err.response?.data?.detail || 'Login failed. Please try again.');
      const requiresEmailVerification = err.response?.data?.requires_email_verification === true
        || err.response?.headers?.['x-requires-email-verification'] === 'true';

      if (requiresEmailVerification) {
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

      lockDetectedPortal(portal);
      const updatedGuardState = registerFailedAttempt(identifier, portal || getActivePortal());
      setError(updatedGuardState.lockedUntil ? getLockMessage(updatedGuardState.lockedUntil) : detail);

      if (
        detail.toLowerCase().includes('captcha') ||
        updatedGuardState.attempts >= CAPTCHA_THRESHOLD
      ) {
        setRequiresCaptcha(true);
      }

      if (detail.toLowerCase().includes('mfa not configured')) {
        await prepareMfaSetup(portal || getActivePortal(), true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (event) => {
    event.preventDefault();
    const nextTotpError = validateTotpCode(totpCode);
    setTotpError(nextTotpError);
    if (nextTotpError) {
      setError(nextTotpError);
      return;
    }

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
      const response = await axios.post(`${API_HOST}/api/auth/unified/login`, {
        identifier,
        password,
        portal: getSubmissionPortal(),
        totp_code: totpCode,
        recaptcha_token: recaptchaToken || undefined,
      });

      clearGuardState(identifier);
      persistSession(response.data);
      redirectAfterLogin(response.data.portal);
    } catch (err) {
      const portal = getSubmissionPortal() || detectedPortal;
      lockDetectedPortal(portal);
      const detail = normalizeLoginErrorMessage(err.response?.data?.detail || 'Invalid TOTP code. Please try again.');
      const updatedGuardState = registerFailedAttempt(identifier, portal || getActivePortal());
      setError(updatedGuardState.lockedUntil ? getLockMessage(updatedGuardState.lockedUntil) : detail);
      setTotpCode('');
      if (
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

  const handleSendRecoveryOtp = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await unifiedAuthAPI.sendMfaRecoveryOtp({
        identifier,
        password,
        portal: getSubmissionPortal(),
      });
      setStep('recovery-otp');
      setNotice(response.data.message);
      setNoticeType('info');
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to send recovery code. Please try again.';
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecoveryOtp = async (event) => {
    event.preventDefault();
    const nextError = validateRecoveryOtpCode(recoveryOtpCode);
    setRecoveryOtpError(nextError);
    if (nextError) {
      setError(nextError);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await unifiedAuthAPI.verifyMfaRecoveryOtp({
        identifier,
        password,
        portal: getSubmissionPortal(),
        otp_code: recoveryOtpCode,
      });
      setMfaSetupData(response.data);
      setStep('recovery-setup');
      setRecoveryOtpCode('');
      setRecoveryOtpError('');
    } catch (err) {
      const detail = err.response?.data?.detail || 'Verification failed. Please check the code and try again.';
      setError(detail);
      setRecoveryOtpCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySetupVerify = async (event) => {
    event.preventDefault();
    const nextTotpError = validateTotpCode(totpCode);
    setTotpError(nextTotpError);
    if (nextTotpError) {
      setError(nextTotpError);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    try {
      await axios.post(`${API_HOST}/api/auth/unified/verify-mfa-setup`, {
        identifier,
        password,
        portal: getSubmissionPortal(),
        totp_code: totpCode,
      });

      const loginResponse = await axios.post(`${API_HOST}/api/auth/unified/login`, {
        identifier,
        password,
        portal: getSubmissionPortal(),
        totp_code: totpCode,
        recaptcha_token: recaptchaToken || undefined,
      });

      clearGuardState(identifier);
      persistSession(loginResponse.data);
      redirectAfterLogin(loginResponse.data.portal);
    } catch (err) {
      const detail = normalizeLoginErrorMessage(err.response?.data?.detail || 'Setup verification failed. Please try again.');
      setError(detail);
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  const copy = portalCopy[detectedPortal] || portalCopy.default;
  const showPasswordToggle = step === 'credentials' && Boolean(password);

  return (
    <div className={`min-h-screen bg-gradient-to-br ${copy.accent} flex items-center justify-center p-6`}>
      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden flex h-[640px]">

        {/* Left — Login Form */}
        <div className="flex flex-col justify-center w-full md:w-[60%] px-6 py-8 md:px-10 md:py-12">
          <div className="mb-8">
            <span className={`inline-block text-xs font-semibold tracking-widest uppercase px-3 py-1 rounded-full mb-3 ${copy.badgeBg}`}>
              {copy.badge}
            </span>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">Welcome back</h1>
            <p className="text-gray-500 text-sm mt-1">{copy.subtitle}</p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className={`mb-5 px-4 py-3 rounded-xl border text-sm ${noticeType === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
              <p className="font-semibold">{notice}</p>
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} noValidate className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{getIdentifierLabel()}</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    setIdentifierError(validateIdentifier(event.target.value));
                    setError('');
                  }}
                  aria-invalid={identifierError ? 'true' : 'false'}
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:border-transparent transition ${copy.focusRing} ${identifierError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                />
                {identifierError && <p className="mt-1.5 text-xs font-medium text-red-600">{identifierError}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
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
                    className={`w-full px-4 py-2.5 text-sm border rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:border-transparent transition ${copy.focusRing} ${showPasswordToggle ? 'pr-12' : ''} ${passwordError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                  {showPasswordToggle && (
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 transition"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  )}
                </div>
                {passwordError && <p className="mt-1.5 text-xs font-medium text-red-600">{passwordError}</p>}
                <div className="mt-2 text-right">
                  <Link
                    to={`/forgot-password${getActivePortal() ? `?portal=${getActivePortal()}` : ''}`}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>

              {requiresCaptcha && RECAPTCHA_SITE_KEY && (
                <div className="flex justify-center">
                  <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setRecaptchaToken} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (requiresCaptcha && RECAPTCHA_SITE_KEY && !recaptchaToken)}
                className={`w-full ${copy.button} text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md mt-1`}
              >
                {loading ? 'Checking account…' : 'Continue'}
              </button>

              {showMfaSetup && (
                <button
                  type="button"
                  onClick={handleSetupMfa}
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md shadow-emerald-200"
                >
                  Set Up MFA
                </button>
              )}

              <div className="pt-2 text-center space-y-2">
                <p className="text-xs text-gray-500">
                  Don't have an account?{' '}
                  <Link to="/user/register" className="text-green-600 font-semibold hover:text-green-700">
                    Register as a citizen
                  </Link>
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors"
                >
                  ← Back to Home
                </button>
              </div>
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotpSubmit} noValidate className="space-y-5">
              <div className={`text-center px-4 py-3 rounded-xl ${copy.badgeBg} bg-opacity-60`}>
                <p className="text-xs font-medium">Open Microsoft Authenticator and enter the 6-digit code</p>
                <p className="mt-1 text-xs opacity-75">If the code fails, check your device time is set automatically.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Authenticator Code</label>
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
                  className={`w-full px-4 py-3 border rounded-xl text-center text-2xl tracking-[0.5em] font-mono bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:border-transparent transition ${copy.focusRing} ${totpError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                  placeholder="000000"
                  required
                  maxLength="6"
                  autoComplete="one-time-code"
                />
                <p className={`mt-1.5 text-xs font-medium min-h-[1.25rem] ${totpError ? 'text-red-600' : 'invisible'}`}>{totpError || '\u00A0'}</p>
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={handleSendRecoveryOtp}
                    disabled={loading}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    Lost access to your authenticator?
                  </button>
                </div>
              </div>

              {requiresCaptcha && RECAPTCHA_SITE_KEY && (
                <div className="flex justify-center">
                  <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setRecaptchaToken} />
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setTotpCode(''); }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6 || (requiresCaptcha && RECAPTCHA_SITE_KEY && !recaptchaToken)}
                  className={`flex-1 ${copy.button} text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md`}
                >
                  {loading ? 'Signing in…' : 'Login'}
                </button>
              </div>
            </form>
          )}

          {step === 'setup' && mfaSetupData && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm">
                Scan this QR code in Microsoft Authenticator, then sign in again.
              </div>
              <div className="flex justify-center">
                <img src={mfaSetupData.qr_code} alt="MFA QR code" className="w-44 h-44 rounded-xl border-4 border-white shadow-lg object-contain" />
              </div>
              <code className="block bg-slate-100 text-slate-700 p-3 rounded-xl text-xs break-all">{mfaSetupData.manual_entry_key}</code>
              <button
                type="button"
                onClick={() => { setStep('credentials'); setMfaSetupData(null); setError(''); }}
                className={`w-full ${copy.button} text-white py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md`}
              >
                Return to Login
              </button>
            </div>
          )}

          {step === 'recovery-otp' && (
            <form onSubmit={handleVerifyRecoveryOtp} noValidate className="space-y-5">
              <div className={`text-center px-4 py-3 rounded-xl ${copy.badgeBg} bg-opacity-60`}>
                <p className="text-xs font-medium">Enter the verification code sent to your registered email address to reset your MFA setup.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Verification Code</label>
                <input
                  type="text"
                  value={recoveryOtpCode}
                  onChange={(event) => {
                    const nextValue = event.target.value.replace(/\D/g, '').slice(0, 6);
                    setRecoveryOtpCode(nextValue);
                    setRecoveryOtpError(validateRecoveryOtpCode(nextValue));
                    setError('');
                  }}
                  aria-invalid={recoveryOtpError ? 'true' : 'false'}
                  className={`w-full px-4 py-3 border rounded-xl text-center text-2xl tracking-[0.5em] font-mono bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:border-transparent transition ${copy.focusRing} ${recoveryOtpError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                  placeholder="000000"
                  required
                  maxLength="6"
                  autoComplete="one-time-code"
                />
                <p className={`mt-1.5 text-xs font-medium min-h-[1.25rem] ${recoveryOtpError ? 'text-red-600' : 'invisible'}`}>{recoveryOtpError || '\u00A0'}</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setStep('totp'); setRecoveryOtpCode(''); setRecoveryOtpError(''); setError(''); }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || recoveryOtpCode.length !== 6}
                  className={`flex-1 ${copy.button} text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md`}
                >
                  {loading ? 'Verifying…' : 'Continue'}
                </button>
              </div>
            </form>
          )}

          {step === 'recovery-setup' && mfaSetupData && (
            <form onSubmit={handleRecoverySetupVerify} noValidate className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm">
                Your old MFA setup has been reset. Please scan the new QR code using Microsoft Authenticator to secure your account again.
              </div>
              <div className="flex justify-center">
                <img src={mfaSetupData.qr_code} alt="MFA QR code" className="w-44 h-44 rounded-xl border-4 border-white shadow-lg object-contain" />
              </div>
              <code className="block bg-slate-100 text-slate-700 p-3 rounded-xl text-xs break-all">{mfaSetupData.manual_entry_key}</code>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Authenticator Code</label>
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
                  className={`w-full px-4 py-3 border rounded-xl text-center text-2xl tracking-[0.5em] font-mono bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:border-transparent transition ${copy.focusRing} ${totpError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                  placeholder="000000"
                  required
                  maxLength="6"
                  autoComplete="one-time-code"
                />
                <p className={`mt-1.5 text-xs font-medium min-h-[1.25rem] ${totpError ? 'text-red-600' : 'invisible'}`}>{totpError || '\u00A0'}</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setMfaSetupData(null); setTotpCode(''); setTotpError(''); setError(''); }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className={`flex-1 ${copy.button} text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md`}
                >
                  {loading ? 'Completing…' : 'Complete Setup'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right — City Hall Image */}
        <div className="hidden md:block w-[40%] relative">
          <img
            src={cityHall}
            alt="Quezon City Hall"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className={`absolute inset-0 bg-gradient-to-br ${copy.overlay}`} />
        </div>

      </div>
    </div>
  );
};

export default UnifiedLogin;
