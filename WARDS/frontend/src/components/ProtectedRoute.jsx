import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';

const ALLOWED_ADMIN_INTERNAL_ROLES = new Set(['main_admin', 'superadmin']);
const AUTH_VERIFY_TIMEOUT_MS = 8000;

const ProtectedRoute = ({ children }) => {
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

  const clearAdminSession = () => {
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
  };

  const setAdminLoginRedirectState = (message) => {
    sessionStorage.setItem('redirectAfterLogin', location.pathname);
    sessionStorage.setItem('loginPortal', 'admin');
    sessionStorage.setItem('loginMessage', message);
  };

  const verifyToken = async () => {
    const token = localStorage.getItem('adminToken');
    
    if (!token) {
      setIsAuthenticated(false);
      setIsLoading(false);
      setAdminLoginRedirectState('Please login with your admin account to continue.');
      return;
    }

    try {
      const response = await api.get('/auth/unified/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: AUTH_VERIFY_TIMEOUT_MS,
      });

      const adminAuthenticatedAt = Date.parse(localStorage.getItem('adminAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');
      const resolvedRole = response.data.user?.internal_role || response.data.user?.role;

      if (serverStartedAt && (!adminAuthenticatedAt || adminAuthenticatedAt <= serverStartedAt)) {
        clearAdminSession();
        setIsAuthenticated(false);
        setAdminLoginRedirectState('Please login again after the backend restarts.');
        return;
      }

      if (
        response.data.valid
        && response.data.user?.role === 'admin'
        && ALLOWED_ADMIN_INTERNAL_ROLES.has(resolvedRole)
      ) {
        setIsAuthenticated(true);
        const existing = JSON.parse(localStorage.getItem('adminUser') || '{}');
        localStorage.setItem('adminUser', JSON.stringify({ ...existing, ...response.data.user }));
        if (!localStorage.getItem('adminAuthenticatedAt')) {
          localStorage.setItem('adminAuthenticatedAt', new Date().toISOString());
        }
      } else {
        setIsAuthenticated(false);
        clearAdminSession();
        setAdminLoginRedirectState('Please login with your admin account to continue.');
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || !error.response) {
        console.warn('Admin auth verification network error:', error);
        return;
      }
      console.error('Token verification failed:', error);
      setIsAuthenticated(false);
      clearAdminSession();
      setAdminLoginRedirectState('Please login with your admin account to continue.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-lightbg flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600"></div>
          <p className="mt-4 text-gray-600 font-semibold">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return <Navigate to="/login?portal=admin" replace />;
  }

  return children;
};

export default ProtectedRoute;
