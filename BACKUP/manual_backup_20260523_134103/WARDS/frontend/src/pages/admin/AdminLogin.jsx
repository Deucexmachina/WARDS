import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PasswordField from '../../components/PasswordField';

const AdminLogin = () => {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const navigate = useNavigate();

  const API_URL = 'http://localhost:8000';

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/admin/auth/request-otp`, {
        username,
        password
      });

      setOtpCode(response.data.otp);
      setStep(2);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to request OTP. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/admin/auth/login`, {
        username,
        password,
        otp
      });

      localStorage.setItem('adminToken', response.data.access_token);
      localStorage.setItem('adminUser', JSON.stringify(response.data.user));
      
      navigate('/admin');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your OTP.');
      if (err.response?.status === 403 || err.response?.status === 429) {
        setStep(1);
        setOtp('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep(1);
    setOtp('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black opacity-20"></div>
      
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-blue-600 p-4 rounded-full">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-800">Admin Portal</h2>
          <p className="text-gray-600 mt-2">City Treasurer's Office - WARDS</p>
          <div className="mt-4 inline-block bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 rounded">
            <p className="text-sm font-semibold">🔒 Secure Admin Access Only</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"></path>
              </svg>
              <p className="text-sm font-semibold">{error}</p>
            </div>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleRequestOTP} className="space-y-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-gray-700">Step 1: Enter Credentials</h3>
              <p className="text-sm text-gray-500">We'll send you a one-time password</p>
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                </svg>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="Enter admin username"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                </svg>
                Password
              </label>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="Enter admin password"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Requesting OTP...
                </span>
              ) : (
                'Request OTP'
              )}
            </button>

            <div className="text-center mt-6">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="text-blue-600 hover:text-blue-800 text-sm font-semibold"
              >
                ← Back to Public Portal
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-gray-700">Step 2: Verify OTP</h3>
              <p className="text-sm text-gray-500">Enter the 6-digit code</p>
            </div>

            {otpCode && (
              <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded mb-4">
                <p className="text-sm font-semibold">✓ OTP Generated Successfully</p>
                <p className="text-xs mt-1">For testing: <span className="font-mono font-bold text-lg">{otpCode}</span></p>
                <p className="text-xs mt-1 text-green-600">In production, this will be sent via email/SMS</p>
              </div>
            )}

            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                </svg>
                One-Time Password
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-center text-2xl font-mono tracking-widest"
                placeholder="000000"
                required
                maxLength="6"
                autoComplete="one-time-code"
              />
              <p className="text-xs text-gray-500 mt-2 text-center">OTP expires in 5 minutes</p>
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-semibold transition duration-300"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Verify & Login'
                )}
              </button>
            </div>
          </form>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="text-center text-xs text-gray-500 space-y-2">
            <p>🔐 Multi-Factor Authentication Enabled</p>
            <p>🛡️ Rate Limited & Account Lockout Protection</p>
            <p>📝 All login attempts are logged</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
