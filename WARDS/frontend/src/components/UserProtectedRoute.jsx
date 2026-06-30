import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { getStoredPortal } from '../utils/auth';
import { clearStoredPublicUser, setStoredPublicUser } from '../utils/publicSession';

const AUTH_VERIFY_TIMEOUT_MS = 8000;

const UserProtectedRoute = ({ children }) => {
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

    if (portal && portal !== 'public') {
      setIsAuthenticated(false);
      setIsLoading(false);
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      return;
    }

    try {
      const response = await api.get('/auth/unified/verify', {
        params: { portal: 'public' },
        timeout: AUTH_VERIFY_TIMEOUT_MS,
      });

      const userAuthenticatedAt = Date.parse(localStorage.getItem('userAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');
      if (serverStartedAt && (!userAuthenticatedAt || userAuthenticatedAt <= serverStartedAt)) {
        setIsAuthenticated(false);
        localStorage.removeItem('wardsPortal');
        localStorage.removeItem('userToken');
        clearStoredPublicUser();
        localStorage.removeItem('userAuthenticatedAt');
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
        sessionStorage.setItem('loginMessage', 'Please login again after the backend restarts.');
        return;
      }

      if (response.data.valid && response.data.user?.role === 'public') {
        setIsAuthenticated(true);
        setStoredPublicUser(response.data.user);
        if (!localStorage.getItem('userAuthenticatedAt')) {
          localStorage.setItem('userAuthenticatedAt', new Date().toISOString());
        }
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('wardsPortal');
        localStorage.removeItem('userToken');
        clearStoredPublicUser();
        localStorage.removeItem('userAuthenticatedAt');
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || !error.response) {
        console.warn('Public auth verification network error:', error);
        return;
      }
      setIsAuthenticated(false);
      localStorage.removeItem('wardsPortal');
      localStorage.removeItem('userToken');
      clearStoredPublicUser();
      localStorage.removeItem('userAuthenticatedAt');
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem('loginMessage', 'Please login to continue');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-green-600"></div>
          <p className="mt-4 text-gray-600 font-semibold">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    // Store login required message
    sessionStorage.setItem('loginMessage', 'Please login to continue');
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
};

export default UserProtectedRoute;
