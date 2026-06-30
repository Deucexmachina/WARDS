import { Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import ActionConfirmationModal from '../components/ActionConfirmationModal';
import DynamicSidebar from '../components/DynamicSidebar';
import PublicBrandLogo from '../components/PublicBrandLogo';
import StaffMfaSetupModal from '../components/StaffMfaSetupModal';
import api from '../services/api';
import { useEffect } from 'react';

const AdminLayout = () => {
  const navigate = useNavigate();
  const [adminUser, setAdminUser] = useState(JSON.parse(localStorage.getItem('adminUser') || '{}'));
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showMfaModal = Boolean(adminUser?.mfa_setup_required);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);
      
      // Call backend logout endpoint (cookie handles auth)
      await api.post('/auth/unified/logout');
      
      // Clear local storage
      localStorage.removeItem('wardsPortal');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      localStorage.removeItem('settingsAuthenticated');
      localStorage.removeItem('settingsAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('settingsAuthenticated');
      sessionStorage.removeItem('settingsAuthenticatedAt');
      setShowLogoutConfirm(false);
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      localStorage.removeItem('settingsAuthenticated');
      localStorage.removeItem('settingsAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('settingsAuthenticated');
      sessionStorage.removeItem('settingsAuthenticatedAt');
      setShowLogoutConfirm(false);
      navigate('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-lightbg">
      <nav className="bg-primary shadow-lg h-16 fixed top-0 left-0 right-0 z-50">
        <div className="h-full px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger for tablet */}
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="lg:hidden inline-flex items-center justify-center rounded-lg p-2 text-white hover:bg-white/10 transition"
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <PublicBrandLogo
              clickable={false}
              compact
              title="WARDS Main Admin"
              subtitle="Quezon City Treasurer Operations"
            />
          </div>
          <div className="flex items-center space-x-3">
            <button className="text-white hover:text-blue-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
              </svg>
            </button>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              disabled={isLoggingOut}
              className="bg-red-500 hover:bg-red-600 text-white px-3 sm:px-4 py-2 rounded-lg transition duration-300 font-semibold text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Sidebar overlay for tablet */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <DynamicSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="lg:ml-72 mt-16 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>

      <StaffMfaSetupModal
        isOpen={showMfaModal}
        user={adminUser}
        portal="admin"
        onLogout={handleLogout}
        onSuccess={() => {
          const updated = { ...adminUser, mfa_setup_required: false };
          localStorage.setItem('adminUser', JSON.stringify(updated));
          setAdminUser(updated);
        }}
      />
      <ActionConfirmationModal
        open={showLogoutConfirm}
        title="Are you sure you want to logout?"
        message="Your admin session will remain secure and will only be terminated after you confirm."
        confirmLabel="Confirm Logout"
        loadingLabel="Logging out..."
        isLoading={isLoggingOut}
        onCancel={() => {
          if (!isLoggingOut) {
            setShowLogoutConfirm(false);
          }
        }}
        onConfirm={handleLogout}
      />
    </div>
  );
};

export default AdminLayout;
