import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import { getBranchPortalPath } from '../../utils/auth';
import { getEmailValidationMessage } from '../../utils/validation';
import PasswordField from '../../components/PasswordField';

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
    <div className="min-h-screen bg-gradient-to-br from-green-600 via-green-700 to-green-800 flex items-center justify-center p-4">
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">Public Portal Login</h2>
          <p className="text-gray-600 mt-2">Sign in to continue</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(getEmailValidationMessage(event.target.value));
              }}
              className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
              }`}
              required
              autoComplete="email"
            />
            {emailError ? (
              <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Password</label>
            <PasswordField
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg"
          >
            {loading ? 'Signing in...' : 'Login'}
          </button>

          <div className="text-center space-y-3">
            <p className="text-gray-600 text-sm">
              Need a public account?{' '}
              <Link to="/user/register" className="text-green-600 font-semibold hover:text-green-700">
                Register here
              </Link>
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-green-600 hover:text-green-800 text-sm font-semibold"
            >
              Back to Home
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserLogin;
