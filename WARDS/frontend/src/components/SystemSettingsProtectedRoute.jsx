import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { getStoredPortal } from '../utils/auth';
import {
  clearSettingsSession,
  isSettingsRoleAllowed,
  isSettingsSessionActive,
} from '../utils/settingsSecurity';

const clearAdminSession = () => {
  localStorage.removeItem('wardsPortal');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  localStorage.removeItem('adminAuthenticatedAt');
  localStorage.removeItem('securityAuthenticated');
  localStorage.removeItem('securityAuthenticatedAt');
  sessionStorage.removeItem('securityAuthenticated');
  sessionStorage.removeItem('securityAuthenticatedAt');
  clearSettingsSession();
};

const SystemSettingsProtectedRoute = ({ children }) => {
  const [allowed, setAllowed] = useState(null);
  const allowCleanupRef = useRef(false);

  useEffect(() => {
    let active = true;
    const cleanupTimer = window.setTimeout(() => {
      allowCleanupRef.current = true;
    }, 0);

    const verify = async () => {
      const portal = getStoredPortal();
      const adminAuthenticatedAt = Date.parse(localStorage.getItem('adminAuthenticatedAt') || '');
      const settingsAuthenticatedAt = Date.parse(sessionStorage.getItem('settingsAuthenticatedAt') || '');

      if (portal !== 'admin') {
        clearSettingsSession();
        if (active) setAllowed(false);
        return;
      }

      if (!isSettingsSessionActive() || !adminAuthenticatedAt || !settingsAuthenticatedAt || settingsAuthenticatedAt <= adminAuthenticatedAt) {
        clearSettingsSession();
        if (active) setAllowed(false);
        return;
      }

      try {
        const [verifyResponse, accessResponse] = await Promise.all([
          api.get('/auth/unified/verify'),
          api.get('/settings/access'),
        ]);

        const serverStartedAt = Date.parse(verifyResponse.data.server_started_at || '');
        const verifiedUser = verifyResponse.data.user || {};

        if (
          !verifyResponse.data.valid ||
          verifiedUser?.role !== 'admin' ||
          !isSettingsRoleAllowed(verifiedUser) ||
          !accessResponse.data?.allowed ||
          (serverStartedAt && adminAuthenticatedAt <= serverStartedAt)
        ) {
          clearAdminSession();
          if (active) setAllowed(false);
          return;
        }

        if (active) setAllowed(true);
      } catch (error) {
        if (error?.response?.status === 401) {
          clearAdminSession();
        } else {
          clearSettingsSession();
        }
        if (active) setAllowed(false);
      }
    };

    verify();
    const interval = window.setInterval(verify, 10000);

    return () => {
      active = false;
      window.clearTimeout(cleanupTimer);
      window.clearInterval(interval);
      if (allowCleanupRef.current) {
        clearSettingsSession();
      }
    };
  }, []);

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-lightbg">
        <div className="text-center">
          <div className="inline-block h-16 w-16 animate-spin rounded-full border-b-4 border-t-4 border-blue-600"></div>
          <p className="mt-4 font-semibold text-gray-600">Verifying secured settings access...</p>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to={getStoredPortal() === 'admin' ? '/admin/settings/login' : '/login'} replace />;
  }

  return children;
};

export default SystemSettingsProtectedRoute;
