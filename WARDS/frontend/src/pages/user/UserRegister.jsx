import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

import { getBranchPortalPath } from '../../utils/auth';
import {
  getEmailValidationMessage,
  normalizeCitizenFullName,
  normalizePhilippineContactDigits,
  validateCitizenFullName,
  validatePhilippineContactDigits,
  validateStrongPassword,
} from '../../utils/validation';

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

const UserRegister = () => {
  const [formData, setFormData] = useState({
    email: '',
    full_name: '',
    contact_number: '',
    address: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [fullNameError, setFullNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();

  const API_URL = 'http://localhost:8000';

  const redirectByRole = (role) => {
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

  const redirectByUser = (user) => {
    if (user.role === 'branch') {
      navigate(getBranchPortalPath(user), { replace: true });
      return;
    }

    redirectByRole(user.role);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
    setSuccessMessage('');

    if (name === 'password') {
      setPasswordError(validateStrongPassword(value));
    }

    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }

    if (name === 'full_name') {
      setFullNameError(validateCitizenFullName(value));
    }

    if (name === 'contact_number') {
      const normalizedDigits = normalizePhilippineContactDigits(value);
      setFormData((current) => ({ ...current, contact_number: normalizedDigits }));
      setContactError(validatePhilippineContactDigits(normalizedDigits));
      return;
    }

    if (name === 'confirmPassword' || name === 'password' || name === 'email') {
      setError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const nextEmailError = getEmailValidationMessage(formData.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      setLoading(false);
      return;
    }

    const nextFullNameError = validateCitizenFullName(formData.full_name);
    if (nextFullNameError) {
      setFullNameError(nextFullNameError);
      setError('Please correct the highlighted full name field.');
      setLoading(false);
      return;
    }

    const nextContactError = validatePhilippineContactDigits(formData.contact_number);
    if (nextContactError) {
      setContactError(nextContactError);
      setError('Please correct the highlighted contact number field.');
      setLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    const passwordValidationError = validateStrongPassword(formData.password);
    if (passwordValidationError) {
      setPasswordError(passwordValidationError);
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/user/auth/register`, {
        email: formData.email.trim(),
        full_name: normalizeCitizenFullName(formData.full_name),
        contact_number: `+63${normalizePhilippineContactDigits(formData.contact_number)}`,
        address: formData.address,
        password: formData.password
      });

      if (response.data.requires_email_verification) {
        sessionStorage.setItem(
          'pendingCitizenVerification',
          JSON.stringify({
            email: formData.email.trim(),
            fullName: formData.full_name,
            source: 'register',
            message: response.data.message || 'We sent a 6-digit verification code to your email. Enter it to activate your account.',
            resendAvailableInSeconds: response.data.resend_available_in_seconds || 120,
          }),
        );
        navigate('/user/verify-email', {
          replace: true,
          state: {
            email: formData.email.trim(),
            fullName: formData.full_name,
            source: 'register',
            message: response.data.message || 'We sent a 6-digit verification code to your email. Enter it to activate your account.',
            resendAvailableInSeconds: response.data.resend_available_in_seconds || 120,
          },
        });
        return;
      }

      localStorage.setItem('userToken', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      redirectByUser(response.data.user);
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 via-green-700 to-green-800 flex items-center justify-center p-4">
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">Create Account</h2>
          <p className="text-gray-600 mt-2">Register as a Citizen</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
            <p className="text-sm font-semibold">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Full Name</label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                fullNameError ? 'border-red-500 bg-red-50' : 'border-gray-300'
              }`}
              required
            />
            {fullNameError ? (
              <p className="mt-2 text-sm font-semibold text-red-600">{fullNameError}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Email Address</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
              className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
              }`}
              required
            />
            {emailError ? (
              <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Contact Number</label>
            <div className={`flex overflow-hidden rounded-lg border-2 ${contactError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
              <span className="flex items-center bg-gray-100 px-4 font-semibold text-gray-700">+63</span>
              <input
                type="tel"
                name="contact_number"
                value={formData.contact_number}
                onChange={handleChange}
                inputMode="numeric"
                maxLength={10}
                placeholder="9202717703"
                className="w-full px-4 py-3 focus:outline-none"
                required
              />
            </div>
            {contactError ? (
              <p className="mt-2 text-sm font-semibold text-red-600">{contactError}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-500">Enter exactly 10 digits after +63.</p>
            )}
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Address (Optional)</label>
            <input
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                required
              />
              {formData.password ? (
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
            {passwordError && (
              <p className="mt-2 text-sm font-semibold text-red-600">{passwordError}</p>
            )}
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                required
              />
              {formData.confirmPassword ? (
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-500 transition hover:text-gray-700"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  <EyeIcon open={showConfirmPassword} />
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50 shadow-lg"
          >
            {loading ? 'Creating Account...' : 'Register'}
          </button>

          <div className="text-center space-y-3">
            <p className="text-gray-600 text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-green-600 font-semibold hover:text-green-700">
                Login here
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

export default UserRegister;
