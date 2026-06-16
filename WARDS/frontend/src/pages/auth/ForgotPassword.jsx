import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { getEmailValidationMessage } from '../../utils/validation';

import { API_HOST } from '../../services/api';
const PASSWORD_RULE_MESSAGE = 'Password must be more than 12 characters long and include at least one uppercase letter, one lowercase letter, and at least one number or special character.';

const getPasswordValidationMessage = (value) => {
  if (value.length <= 12) {
    return PASSWORD_RULE_MESSAGE;
  }
  if (!/[A-Z]/.test(value)) {
    return PASSWORD_RULE_MESSAGE;
  }
  if (!/[a-z]/.test(value)) {
    return PASSWORD_RULE_MESSAGE;
  }
  if (!/[\d\W]/.test(value)) {
    return PASSWORD_RULE_MESSAGE;
  }
  return '';
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

const portalCopy = {
  public: {
    title: 'Citizen Password Recovery',
    subtitle: 'Reset your citizen account password securely through email verification.',
    accent: 'from-green-600 via-green-700 to-emerald-800',
    button: 'bg-green-600 hover:bg-green-700',
    link: '/user/login',
  },
  admin: {
    title: 'Main Admin Password Recovery',
    subtitle: 'Send a secure reset link to the registered main admin email address.',
    accent: 'from-blue-900 via-blue-800 to-slate-900',
    button: 'bg-blue-600 hover:bg-blue-700',
    link: '/login?portal=admin',
  },
  branch: {
    title: 'Branch Account Password Recovery',
    subtitle: 'Send a secure reset link to the registered branch email address.',
    accent: 'from-indigo-800 via-slate-800 to-purple-900',
    button: 'bg-purple-600 hover:bg-purple-700',
    link: '/login?portal=branch',
  },
  default: {
    title: 'Forgot Password',
    subtitle: 'Use your registered email address to receive a secure password reset link.',
    accent: 'from-slate-900 via-blue-900 to-teal-800',
    button: 'bg-slate-900 hover:bg-slate-800',
    link: '/login',
  },
};

const ForgotPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const portal = searchParams.get('portal') || 'default';
  const copy = portalCopy[portal] || portalCopy.default;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordHint = useMemo(
    () => 'Password must be 8-12 characters with uppercase, lowercase, and at least one number or special character.',
    [],
  );

  const getForgotPasswordEmailError = (value) => {
    if (!String(value || '').trim()) {
      return 'Please enter your Email Address.';
    }

    return getEmailValidationMessage(value, { required: false }).replace('Please enter a valid email address.', 'Please enter a valid Email Address.');
  };

  const getNewPasswordError = (value) => {
    if (!String(value || '')) {
      return 'Please enter your New Password.';
    }

    return getPasswordValidationMessage(value);
  };

  const getConfirmPasswordError = (nextPassword, nextConfirmPassword) => {
    if (!String(nextConfirmPassword || '')) {
      return 'Please confirm your New Password.';
    }

    return nextPassword === nextConfirmPassword ? '' : 'Passwords do not match.';
  };

  const handleRequestReset = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const nextEmailError = getForgotPasswordEmailError(email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError(nextEmailError);
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_HOST}/api/auth/unified/request-password-reset`, {
        email,
        portal: portal === 'default' ? undefined : portal,
      });
      setSuccessMessage(response.data.message || 'If the email exists, a password reset link has been sent.');
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'Unable to send the password reset email right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const nextPasswordError = getNewPasswordError(password);
    const nextConfirmPasswordError = getConfirmPasswordError(password, confirmPassword);
    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmPasswordError);

    if (nextPasswordError) {
      setError(nextPasswordError);
      setLoading(false);
      return;
    }

    if (nextConfirmPasswordError) {
      setError(nextConfirmPasswordError);
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_HOST}/api/auth/unified/reset-password`, {
        token,
        new_password: password,
      });
      setSuccessMessage(response.data.message || 'Password reset successful. You can now sign in with your new password.');
      setPassword('');
      setConfirmPassword('');
    } catch (resetError) {
      setError(resetError.response?.data?.detail || 'Unable to reset the password with this link.');
    } finally {
      setLoading(false);
    }
  };

  const showPasswordToggle = Boolean(password);
  const showConfirmPasswordToggle = Boolean(confirmPassword);

  return (
    <div className={`min-h-screen bg-gradient-to-br ${copy.accent} flex items-center justify-center p-4`}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{copy.title}</h1>
          <p className="text-gray-600 mt-2">{copy.subtitle}</p>
        </div>

        {error ? (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        ) : null}

        {successMessage ? (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-xl">
            <p className="text-sm font-semibold">{successMessage}</p>
          </div>
        ) : null}

        {token && !successMessage ? (
          <form onSubmit={handleResetPassword} noValidate className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPassword(nextValue);
                    setPasswordError(getNewPasswordError(nextValue));
                    setConfirmPasswordError(getConfirmPasswordError(nextValue, confirmPassword));
                    setError('');
                  }}
                  aria-invalid={passwordError ? 'true' : 'false'}
                  className={`w-full border-2 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent ${
                    showPasswordToggle ? 'px-4 py-3 pr-12' : 'px-4 py-3'
                  } ${passwordError ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500/20' : 'border-gray-200 focus:ring-blue-500'}`}
                  autoComplete="new-password"
                  required
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
              {passwordError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{passwordError}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setConfirmPassword(nextValue);
                    setConfirmPasswordError(getConfirmPasswordError(password, nextValue));
                    setError('');
                  }}
                  aria-invalid={confirmPasswordError ? 'true' : 'false'}
                  className={`w-full border-2 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent ${
                    showConfirmPasswordToggle ? 'px-4 py-3 pr-12' : 'px-4 py-3'
                  } ${confirmPasswordError ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500/20' : 'border-gray-200 focus:ring-blue-500'}`}
                  autoComplete="new-password"
                  required
                />
                {showConfirmPasswordToggle ? (
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-500 transition hover:text-gray-700"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showConfirmPassword} />
                  </button>
                ) : null}
              </div>
              {confirmPasswordError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{confirmPasswordError}</p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full ${copy.button} text-white py-3 rounded-xl font-semibold transition disabled:opacity-50`}
            >
              {loading ? 'Updating password...' : 'Set New Password'}
            </button>
          </form>
        ) : !token ? (
          <form onSubmit={handleRequestReset} noValidate className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Registered Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(getForgotPasswordEmailError(event.target.value));
                  setError('');
                }}
                aria-invalid={emailError ? 'true' : 'false'}
                className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  emailError ? 'border-red-500 bg-red-50' : 'border-gray-200'
                }`}
                placeholder="name@example.com"
                autoComplete="email"
                required
              />
              {emailError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full ${copy.button} text-white py-3 rounded-xl font-semibold transition disabled:opacity-50`}
            >
              {loading ? 'Sending reset link...' : 'Send Password Reset Email'}
            </button>
          </form>
        ) : null}

        <div className="mt-8 text-center">
          <Link to={copy.link} className="text-sm text-gray-600 hover:text-gray-800 font-semibold">
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
