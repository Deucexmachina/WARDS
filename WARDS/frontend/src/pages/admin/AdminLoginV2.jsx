import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import PasswordField from '../../components/PasswordField';
import cityHall from '../../assets/branding/qc_city_hall.jpg';

const API_URL = 'http://localhost:8000';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';

const AdminLoginV2 = () => {
  const [step, setStep] = useState('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const storeAndRedirect = (data) => {
    localStorage.setItem('adminToken', data.access_token);
    localStorage.setItem('adminUser', JSON.stringify(data.user));
    localStorage.setItem('adminAuthenticatedAt', new Date().toISOString());
    localStorage.removeItem('securityAuthenticated');
    localStorage.removeItem('securityAuthenticatedAt');
    sessionStorage.removeItem('securityAuthenticated');
    sessionStorage.removeItem('securityAuthenticatedAt');
    navigate('/admin-dashboard', { replace: true });
  };

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/admin/auth/login`, {
        email,
        password,
        recaptcha_token: recaptchaToken || undefined,
      });

      if (response.data.requires_mfa) {
        setStep('totp');
        setRequiresCaptcha(response.data.requires_captcha || false);
        return;
      }

      storeAndRedirect(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Login failed. Please check your credentials.';
      setError(detail);
      if (
        err.response?.headers?.['x-requires-captcha'] === 'true' ||
        detail.toLowerCase().includes('captcha')
      ) {
        setRequiresCaptcha(true);
      }
      if (
        err.response?.headers?.['x-requires-mfa-setup'] === 'true' ||
        detail.toLowerCase().includes('mfa not configured')
      ) {
        setShowMfaSetup(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/admin/auth/login`, {
        email,
        password,
        totp_code: totpCode,
        recaptcha_token: recaptchaToken || undefined,
      });
      storeAndRedirect(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid TOTP code. Please try again.');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupMFA = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/admin/auth/setup-mfa`, {
        email,
        password,
      });
      setMfaSetupData(response.data);
      setStep('setup');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to setup MFA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex min-h-[560px]">

        {/* Left — Login Form */}
        <div className="flex flex-col justify-center w-full md:w-1/2 px-6 py-8 md:px-10 md:py-12">
          {/* Header */}
          <div className="mb-8">
            <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold tracking-widest uppercase px-3 py-1 rounded-full mb-3">
              Admin Portal
            </span>
            <h2 className="text-3xl font-bold text-gray-900 leading-tight">Welcome back</h2>
            <p className="text-gray-500 text-sm mt-1">Sign in with your admin credentials</p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <PasswordField
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  required
                  autoComplete="current-password"
                />
              </div>

              {requiresCaptcha && (
                <div className="flex justify-center">
                  <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setRecaptchaToken} />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (requiresCaptcha && !recaptchaToken)}
                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md shadow-blue-200 mt-1"
              >
                {loading ? 'Verifying…' : 'Continue'}
              </button>

              {showMfaSetup && (
                <button
                  type="button"
                  onClick={handleSetupMFA}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md shadow-green-200"
                >
                  Enable MFA
                </button>
              )}
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotpSubmit} className="space-y-5">
              <div className="text-center bg-blue-50 rounded-xl px-4 py-3 mb-2">
                <p className="text-xs text-blue-600 font-medium">Open Microsoft Authenticator and enter the 6-digit code</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Authenticator Code</label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-2xl font-mono tracking-[0.5em] bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  placeholder="000000"
                  maxLength="6"
                  required
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep('credentials')}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md shadow-blue-200"
                >
                  {loading ? 'Verifying…' : 'Login'}
                </button>
              </div>
            </form>
          )}

          {step === 'setup' && mfaSetupData && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
                Scan this QR code with Microsoft Authenticator to enable MFA.
              </div>
              <div className="flex justify-center">
                <img src={mfaSetupData.qr_code} alt="MFA QR code" className="border-4 border-blue-500 rounded-xl w-40 h-40 object-contain" />
              </div>
              <code className="block bg-gray-100 p-3 rounded-xl text-xs break-all text-gray-600">{mfaSetupData.manual_entry_key}</code>
              <button
                type="button"
                onClick={() => setStep('credentials')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                Return to Login
              </button>
            </div>
          )}
        </div>

        {/* Right — City Hall Image */}
        <div className="hidden md:block w-1/2 relative">
          <img
            src={cityHall}
            alt="Quezon City Hall"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/70 to-blue-700/50" />
        </div>

      </div>
    </div>
  );
};

export default AdminLoginV2;
