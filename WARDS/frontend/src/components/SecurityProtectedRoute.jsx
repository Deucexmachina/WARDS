import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { getStoredPortal } from '../utils/auth';

const clearSecuritySession = () => {
  localStorage.removeItem('securityAuthenticated');
  localStorage.removeItem('securityAuthenticatedAt');
  sessionStorage.removeItem('securityAuthenticated');
  sessionStorage.removeItem('securityAuthenticatedAt');
};

const clearAdminSession = () => {
  localStorage.removeItem('wardsPortal');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  localStorage.removeItem('adminAuthenticatedAt');
  localStorage.removeItem('settingsAuthenticated');
  localStorage.removeItem('settingsAuthenticatedAt');
  clearSecuritySession();
  sessionStorage.removeItem('settingsAuthenticated');
  sessionStorage.removeItem('settingsAuthenticatedAt');
};

const SecurityProtectedRoute = ({ children }) => {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    const verify = async () => {
      const portal = getStoredPortal();
      const securityReady = sessionStorage.getItem('securityAuthenticated') === 'true';
      const adminAuthenticatedAt = Date.parse(localStorage.getItem('adminAuthenticatedAt') || '');
      const securityAuthenticatedAt = Date.parse(sessionStorage.getItem('securityAuthenticatedAt') || '');

      if (portal !== 'admin') {
        setAllowed(false);
        return;
      }

      if (!securityReady || !adminAuthenticatedAt || !securityAuthenticatedAt || securityAuthenticatedAt <= adminAuthenticatedAt) {
        clearSecuritySession();
        setAllowed(false);
        return;
      }

      try {
        const response = await api.get('/auth/unified/verify');
        const serverStartedAt = Date.parse(response.data.server_started_at || '');
        if (!response.data.valid || response.data.user?.role !== 'admin' || (serverStartedAt && adminAuthenticatedAt <= serverStartedAt)) {
          clearAdminSession();
          setAllowed(false);
          return;
        }
        setAllowed(true);
      } catch {
        clearAdminSession();
        setAllowed(false);
      }
    };

    verify();
    const interval = window.setInterval(() => {
      verify();
    }, 10000);
    return () => window.clearInterval(interval);
  }, []);

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-lightbg">
        <div className="text-center">
          <div className="inline-block h-16 w-16 animate-spin rounded-full border-b-4 border-t-4 border-blue-600"></div>
          <p className="mt-4 font-semibold text-gray-600">Verifying secured access...</p>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to={getStoredPortal() === 'admin' ? '/admin/backup/login' : '/login'} replace />;
  }

  return children;
};

export default SecurityProtectedRoute;
