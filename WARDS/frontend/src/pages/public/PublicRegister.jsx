import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { setStoredPublicUser } from '../../utils/publicSession';

import {
  getEmailValidationMessage,
  normalizeCitizenFullName,
  normalizePhilippineContactDigits,
  validateCitizenFullName,
  validatePhilippineContactDigits,
  validateStrongPassword,
} from '../../utils/validation';
import PasswordField from '../../components/PasswordField';

const API_BASE_URL = 'http://localhost:8000/api';

const PublicRegister = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    full_name: '',
    contact_number: '',
    password: '',
    confirm_password: ''
  });
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [fullNameError, setFullNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
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
    setError('');
    setSuccessMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const nextEmailError = getEmailValidationMessage(formData.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      return;
    }

    if (formData.password !== formData.confirm_password) {
      setError('Passwords do not match');
      return;
    }

    const nextFullNameError = validateCitizenFullName(formData.full_name);
    if (nextFullNameError) {
      setFullNameError(nextFullNameError);
      setError('Please correct the highlighted full name field.');
      return;
    }

    const nextContactError = validatePhilippineContactDigits(formData.contact_number);
    if (nextContactError) {
      setContactError(nextContactError);
      setError('Please correct the highlighted contact number field.');
      return;
    }

    const passwordError = validateStrongPassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    try {
      const { confirm_password, ...registerData } = formData;
      const response = await axios.post(`${API_BASE_URL}/public/auth/register`, {
        ...registerData,
        email: registerData.email.trim(),
        full_name: normalizeCitizenFullName(registerData.full_name),
        contact_number: `+63${normalizePhilippineContactDigits(registerData.contact_number)}`,
      });

      if (response.data.requires_email_verification) {
        setSuccessMessage(response.data.message || 'Verification email sent. Please verify your email before logging in.');
        setFormData({
          email: '',
          full_name: '',
          contact_number: '',
          password: '',
          confirm_password: ''
        });
        return;
      }

      localStorage.setItem('publicToken', response.data.access_token);
      setStoredPublicUser(response.data.user);

      const redirectTo = localStorage.getItem('redirectAfterLogin') || '/';
      localStorage.removeItem('redirectAfterLogin');
      navigate(redirectTo);
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Create Account</h2>
            <p className="text-gray-600">Register to access queue registration and receipt requests</p>
          </div>

          {error && (
            <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
              <p className="font-semibold">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="mb-6 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
              <p className="font-semibold">{successMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">Full Name *</label>
              <input
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleInputChange}
                placeholder="Juan Dela Cruz"
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  fullNameError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
                required
              />
              {fullNameError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{fullNameError}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Email Address *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="your.email@example.com"
                pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
                required
              />
              {emailError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Contact Number *</label>
              <div className={`flex overflow-hidden rounded-lg border ${contactError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
                <span className="flex items-center bg-gray-100 px-4 font-semibold text-gray-700">+63</span>
                <input
                  type="tel"
                  name="contact_number"
                  value={formData.contact_number}
                  onChange={handleInputChange}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="912 345 6789"
                  className="w-full px-4 py-3 focus:outline-none"
                  required
                />
              </div>
              {contactError ? (
                <p className="mt-2 text-sm font-semibold text-red-600">{contactError}</p>
              ) : (
                <p className="mt-2 text-sm text-gray-500">Enter exactly 10 digits after +63, starting with 9.</p>
              )}
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Password *</label>
              <PasswordField
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="More than 12 chars with uppercase, lowercase, and number or special char"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Confirm Password *</label>
              <PasswordField
                name="confirm_password"
                value={formData.confirm_password}
                onChange={handleInputChange}
                placeholder="Re-enter password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Account...' : 'Register'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Already have an account?{' '}
              <Link to="/public-login" className="text-blue-600 font-semibold hover:text-blue-700">
                Login here
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link to="/" className="text-gray-500 hover:text-gray-700">
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicRegister;
