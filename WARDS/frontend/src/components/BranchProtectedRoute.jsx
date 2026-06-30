import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { getStoredPortal } from '../utils/auth';
import { clearBranchSettingsSession } from '../utils/settingsSecurity';

const AUTH_VERIFY_TIMEOUT_MS = 8000;

const BranchProtectedRoute = ({ children, requiredInternalRole = null }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    verifyToken();
    const interval = window.setInterval(() => {
      verifyToken();
    }, 10000);
    return () => window.clearInterval(interval);
  }, []);

  const verifyToken = async () => {
    const portal = getStoredPortal();

    if (portal && portal !== 'branch') {
      setIsAuthenticated(false);
      setIsLoading(false);
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem('loginPortal', 'branch');
      sessionStorage.setItem('loginMessage', 'Please login with your branch account to continue.');
      return;
    }

    try {
      const response = await api.get('/auth/unified/verify', {
        timeout: AUTH_VERIFY_TIMEOUT_MS,
      });

      const branchAuthenticatedAt = Date.parse(localStorage.getItem('branchAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');
      if (serverStartedAt && (!branchAuthenticatedAt || branchAuthenticatedAt <= serverStartedAt)) {
        setIsAuthenticated(false);
        localStorage.removeItem('wardsPortal');
        localStorage.removeItem('branchToken');
        localStorage.removeItem('branchUser');
        localStorage.removeItem('branchAuthenticatedAt');
        clearBranchSettingsSession();
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
        sessionStorage.setItem('loginPortal', 'branch');
        sessionStorage.setItem('loginMessage', 'Please login again after the backend restarts.');
        return;
      }

      if (response.data.valid && response.data.user?.role === 'branch') {
        const userRole = response.data.user?.internal_role || response.data.user?.role;
        if (requiredInternalRole && userRole !== requiredInternalRole) {
          setIsAuthenticated(false);
          setIsLoading(false);
          window.location.assign('/login?portal=branch');
          return;
        }
        setIsAuthenticated(true);
        const existing = JSON.parse(localStorage.getItem('branchUser') || '{}');
        localStorage.setItem('branchUser', JSON.stringify({ ...existing, ...response.data.user }));
        if (!localStorage.getItem('branchAuthenticatedAt')) {
          localStorage.setItem('branchAuthenticatedAt', new Date().toISOString());
        }
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('wardsPortal');
        localStorage.removeItem('branchToken');
        localStorage.removeItem('branchUser');
        localStorage.removeItem('branchAuthenticatedAt');
        clearBranchSettingsSession();
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
        sessionStorage.setItem('loginPortal', 'branch');
        sessionStorage.setItem('loginMessage', 'Please login with your branch account to continue.');
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || !error.response) {
        console.warn('Branch auth verification network error:', error);
        return;
      }
      setIsAuthenticated(false);
      localStorage.removeItem('wardsPortal');
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      clearBranchSettingsSession();
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem('loginPortal', 'branch');
      sessionStorage.setItem('loginMessage', 'Please login with your branch account to continue.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-lightbg flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-600"></div>
          <p className="mt-4 text-gray-600 font-semibold">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return <Navigate to="/login?portal=branch" state={{ from: location.pathname }} replace />;
  }

  return children;
};

export default BranchProtectedRoute;
