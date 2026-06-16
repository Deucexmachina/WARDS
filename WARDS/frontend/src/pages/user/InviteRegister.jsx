import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { getBranchPortalPath } from '../../utils/auth';
import { getEmailValidationMessage } from '../../utils/validation';
import PasswordField from '../../components/PasswordField';

const API_URL = 'http://localhost:8000';

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

const InviteRegister = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialEmail = useMemo(() => searchParams.get('email') || '', [searchParams]);
  const initialToken = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [formData, setFormData] = useState({
    email: initialEmail,
    password: '',
    confirmPassword: '',
    invite_token: initialToken,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextEmailError = getEmailValidationMessage(formData.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/register/invite`, {
        email: formData.email,
        password: formData.password,
        invite_token: formData.invite_token,
      });

      const { user, access_token } = response.data;
      if (user.role === 'admin') {
        localStorage.setItem('adminToken', access_token);
        localStorage.setItem('adminUser', JSON.stringify(user));
      } else if (user.role === 'branch') {
        localStorage.setItem('branchToken', access_token);
        localStorage.setItem('branchUser', JSON.stringify(user));
      } else {
        localStorage.setItem('userToken', access_token);
        localStorage.setItem('user', JSON.stringify(user));
      }

      redirectByUser(user, navigate);
    } catch (err) {
      setError(err.response?.data?.detail || 'Invite registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-700 via-blue-800 to-cyan-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Accept Invite</h1>
          <p className="text-gray-600 mt-2">Create your invited WARDS account</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Email Address</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
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
            <label className="block text-gray-700 font-semibold mb-2">Invite Token</label>
            <input
              type="text"
              name="invite_token"
              value={formData.invite_token}
              onChange={handleChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Password</label>
            <PasswordField
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Confirm Password</label>
            <PasswordField
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg"
          >
            {loading ? 'Creating Account...' : 'Accept Invite'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default InviteRegister;
