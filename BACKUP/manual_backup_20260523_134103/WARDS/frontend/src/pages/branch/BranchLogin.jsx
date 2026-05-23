import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getBranchPortalPath } from '../../utils/auth';
import PasswordField from '../../components/PasswordField';

const BranchLogin = () => {
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
      const response = await axios.post(`${API_URL}/api/branch/auth/request-otp`, {
        username,
        password
      });

      setOtpCode(response.data.otp);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to request OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/branch/auth/login`, {
        username,
        password,
        otp
      });

      localStorage.setItem('branchToken', response.data.access_token);
      localStorage.setItem('branchUser', JSON.stringify(response.data.user));
      
      navigate(getBranchPortalPath(response.data.user), { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed.');
      if (err.response?.status === 403 || err.response?.status === 429) {
        setStep(1);
        setOtp('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-700 to-purple-800 flex items-center justify-center p-4">
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-purple-600 p-4 rounded-full">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
              </svg>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-800">Branch Portal</h2>
          <p className="text-gray-600 mt-2">City Treasurer's Office - WARDS</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleRequestOTP} className="space-y-6">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Password</label>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg"
            >
              {loading ? 'Requesting OTP...' : 'Request OTP'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full text-purple-600 hover:text-purple-800 text-sm font-semibold"
            >
              ← Back to Home
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-6">
            {otpCode && (
              <div className="bg-purple-100 border-l-4 border-purple-500 text-purple-700 p-4 rounded">
                <p className="text-sm font-semibold">✓ OTP: <span className="font-mono text-lg">{otpCode}</span></p>
              </div>
            )}

            <div>
              <label className="block text-gray-700 font-semibold mb-2">One-Time Password</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-center text-2xl font-mono"
                placeholder="000000"
                required
                maxLength="6"
              />
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold disabled:opacity-50 shadow-lg"
              >
                {loading ? 'Verifying...' : 'Login'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default BranchLogin;
