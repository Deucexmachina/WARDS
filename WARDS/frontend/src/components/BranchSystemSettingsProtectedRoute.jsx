import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import {
  clearBranchSettingsSession,
  isBranchSettingsRoleAllowed,
  isBranchSettingsSessionActive,
} from '../utils/settingsSecurity';

const clearBranchSession = () => {
  localStorage.removeItem('branchToken');
  localStorage.removeItem('branchUser');
  localStorage.removeItem('branchAuthenticatedAt');
  clearBranchSettingsSession();
};

const BranchSystemSettingsProtectedRoute = ({ children }) => {
  const [allowed, setAllowed] = useState(null);
  const allowCleanupRef = useRef(false);

  useEffect(() => {
    let active = true;
    const cleanupTimer = window.setTimeout(() => {
      allowCleanupRef.current = true;
    }, 0);

    const verify = async () => {
      const token = localStorage.getItem('branchToken');
      const branchAuthenticatedAt = Date.parse(localStorage.getItem('branchAuthenticatedAt') || '');
      const settingsAuthenticatedAt = Date.parse(sessionStorage.getItem('branchSettingsAuthenticatedAt') || '');

      if (!token) {
        clearBranchSettingsSession();
        if (active) setAllowed(false);
        return;
      }

      if (!isBranchSettingsSessionActive() || !branchAuthenticatedAt || !settingsAuthenticatedAt || settingsAuthenticatedAt <= branchAuthenticatedAt) {
        clearBranchSettingsSession();
        if (active) setAllowed(false);
        return;
      }

      try {
        const [verifyResponse, accessResponse] = await Promise.all([
          api.get('/auth/unified/verify', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          api.get('/branch/settings/access', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const serverStartedAt = Date.parse(verifyResponse.data.server_started_at || '');
        const verifiedUser = verifyResponse.data.user || {};

        if (
          !verifyResponse.data.valid ||
          verifiedUser?.role !== 'branch' ||
          !isBranchSettingsRoleAllowed(verifiedUser) ||
          !accessResponse.data?.allowed ||
          (serverStartedAt && branchAuthenticatedAt <= serverStartedAt)
        ) {
          clearBranchSession();
          if (active) setAllowed(false);
          return;
        }

        if (active) setAllowed(true);
      } catch (error) {
        if (error?.response?.status === 401) {
          clearBranchSession();
        } else {
          clearBranchSettingsSession();
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
        clearBranchSettingsSession();
      }
    };
  }, []);

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-lightbg">
        <div className="text-center">
          <div className="inline-block h-16 w-16 animate-spin rounded-full border-b-4 border-t-4 border-purple-600"></div>
          <p className="mt-4 font-semibold text-gray-600">Verifying secured settings access...</p>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to={localStorage.getItem('branchToken') ? '../settings/login' : '/login?portal=branch'} replace />;
  }

  return children;
};

export default BranchSystemSettingsProtectedRoute;
