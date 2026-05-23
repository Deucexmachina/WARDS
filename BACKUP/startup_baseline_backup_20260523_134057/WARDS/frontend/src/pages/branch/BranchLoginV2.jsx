import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import { getBranchPortalPath } from '../../utils/auth';
import PasswordField from '../../components/PasswordField';

const API_URL = 'http://localhost:8000';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';

const BranchLoginV2 = () => {
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
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
    localStorage.setItem('branchToken', data.access_token);
    localStorage.setItem('branchUser', JSON.stringify(data.user));
    navigate(getBranchPortalPath(data.user), { replace: true });
  };

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/branch/auth/login`, {
        username,
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
      const response = await axios.post(`${API_URL}/api/branch/auth/login`, {
        username,
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
      const response = await axios.post(`${API_URL}/api/branch/auth/setup-mfa`, {
        username,
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
    <div className="min-h-screen bg-gradient-to-br from-purple-700 via-slate-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">Branch Portal</h2>
          <p className="text-gray-600 mt-2">Microsoft Authenticator MFA</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {step === 'credentials' && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Password</label>
              <PasswordField
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>

            {showMfaSetup && (
              <button
                type="button"
                onClick={handleSetupMFA}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition shadow-lg"
              >
                Enable MFA
              </button>
            )}
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={handleTotpSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">TOTP Code</label>
              <input
                type="text"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-center text-2xl font-mono tracking-widest"
                placeholder="000000"
                maxLength="6"
                required
                autoComplete="one-time-code"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('credentials')}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-3 rounded-lg font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50 shadow-lg"
              >
                {loading ? 'Verifying...' : 'Login'}
              </button>
            </div>
          </form>
        )}

        {step === 'setup' && mfaSetupData && (
          <div className="space-y-5">
            <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
              <p className="text-sm font-semibold">MFA setup started. Scan this QR code with Microsoft Authenticator.</p>
            </div>
            <div className="flex justify-center">
              <img src={mfaSetupData.qr_code} alt="MFA QR code" className="border-4 border-purple-500 rounded-lg" />
            </div>
            <code className="block bg-gray-100 p-3 rounded text-xs break-all">{mfaSetupData.manual_entry_key}</code>
            <button
              type="button"
              onClick={() => setStep('credentials')}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold"
            >
              Return to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BranchLoginV2;
