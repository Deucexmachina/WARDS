import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import { getBranchPortalPath } from '../../utils/auth';
import { getEmailValidationMessage } from '../../utils/validation';
import PasswordField from '../../components/PasswordField';
import cityHall from '../../assets/branding/qc_city_hall.jpg';

const API_URL = 'http://localhost:8000';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';

const redirectByRole = (role, navigate) => {
  if (role === 'admin') {
    navigate('/admin-dashboard', { replace: true });
    return;
  }
  if (role === 'branch') {
    navigate('/branch-dashboard', { replace: true });
    return;
  }
  navigate('/', { replace: true });
};

const redirectByUser = (user, navigate) => {
  if (user.role === 'branch') {
    navigate(getBranchPortalPath(user), { replace: true });
    return;
  }

  redirectByRole(user.role, navigate);
};

const UserLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const nextEmailError = getEmailValidationMessage(email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/user/auth/login`, {
        email,
        password,
        recaptcha_token: recaptchaToken || undefined,
      });

      localStorage.setItem('userToken', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      redirectByUser(response.data.user, navigate);
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your credentials.');
      if (
        err.response?.headers?.['x-requires-captcha'] === 'true' ||
        err.response?.data?.detail?.toLowerCase().includes('captcha')
      ) {
        setRequiresCaptcha(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex min-h-[520px]">

        {/* Left — Login Form */}
        <div className="flex flex-col justify-center w-full md:w-1/2 px-10 py-12">
          {/* Header */}
          <div className="mb-8">
            <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold tracking-widest uppercase px-3 py-1 rounded-full mb-3">
              Citizen Portal
            </span>
            <h2 className="text-3xl font-bold text-gray-900 leading-tight">Welcome back</h2>
            <p className="text-gray-500 text-sm mt-1">Sign in to your account to continue</p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(getEmailValidationMessage(e.target.value));
                }}
                placeholder="you@example.com"
                className={`w-full px-4 py-2.5 text-sm border rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition ${
                  emailError ? 'border-red-400 bg-red-50' : 'border-gray-200'
                }`}
                required
                autoComplete="email"
              />
              {emailError && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{emailError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
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
              className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 shadow-md shadow-green-200 mt-1"
            >
              {loading ? 'Signing in…' : 'Login'}
            </button>

            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="text-gray-500 text-sm">
                Don&apos;t have an account?{' '}
                <Link to="/user/register" className="text-green-600 font-semibold hover:text-green-700 transition-colors">
                  Register here
                </Link>
              </p>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
              >
                ← Back to Home
              </button>
            </div>
          </form>
        </div>

        {/* Right — City Hall Image */}
        <div className="hidden md:block w-1/2 relative">
          <img
            src={cityHall}
            alt="Quezon City Hall"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-green-900/70 to-emerald-700/50" />
        </div>

      </div>
    </div>
  );
};

export default UserLogin;
