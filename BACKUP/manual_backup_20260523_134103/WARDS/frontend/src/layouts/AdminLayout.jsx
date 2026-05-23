import { Link, Outlet, useNavigate } from 'react-router-dom';
import DynamicSidebar from '../components/DynamicSidebar';
import PublicBrandLogo from '../components/PublicBrandLogo';
import api from '../services/api';

const AdminLayout = () => {
  const navigate = useNavigate();
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      
      // Call backend logout endpoint
      await api.post('/admin/auth/logout', {}, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      // Clear local storage
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-lightbg">
      <nav className="bg-primary shadow-lg h-16 fixed top-0 left-0 right-0 z-50">
        <div className="h-full px-6 flex items-center justify-between">
          <PublicBrandLogo
            clickable={false}
            compact
            title="WARDS Main Admin"
            subtitle="Quezon City Treasurer Operations"
          />
          <div className="flex items-center space-x-4">
            {adminUser?.mfa_setup_required && (
              <Link
                to="/admin/settings"
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg transition duration-300 font-semibold"
              >
                Reset MFA
              </Link>
            )}
            <button className="text-white hover:text-blue-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
              </svg>
            </button>
            <button 
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition duration-300 font-semibold"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <DynamicSidebar />
      <main className="ml-72 mt-16 p-8">
        {adminUser?.mfa_setup_required && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
            <p className="font-semibold">MFA reminder</p>
            <p className="text-sm">
              Your account signed in without MFA setup. Please set up Microsoft Authenticator soon so future logins stay protected.
            </p>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
