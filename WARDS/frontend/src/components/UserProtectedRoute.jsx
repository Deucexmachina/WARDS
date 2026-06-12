import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
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
    const token = localStorage.getItem('userToken');
    
    if (!token) {
      setIsAuthenticated(false);
      setIsLoading(false);
      // Store the intended destination
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      return;
    }

    try {
      const response = await axios.get('http://localhost:8000/api/user/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: AUTH_VERIFY_TIMEOUT_MS,
      });

      const userAuthenticatedAt = Date.parse(localStorage.getItem('userAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');
      if (serverStartedAt && (!userAuthenticatedAt || userAuthenticatedAt <= serverStartedAt)) {
        setIsAuthenticated(false);
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
        localStorage.removeItem('userToken');
        clearStoredPublicUser();
        localStorage.removeItem('userAuthenticatedAt');
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
      }
    } catch (error) {
      setIsAuthenticated(false);
      localStorage.removeItem('userToken');
      clearStoredPublicUser();
      localStorage.removeItem('userAuthenticatedAt');
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem(
        'loginMessage',
        error.code === 'ECONNABORTED' || !error.response
          ? 'Unable to reach the backend. Please make sure the API server is running.'
          : 'Please login to continue'
      );
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

  if (!isAuthenticated) {
    // Store login required message
    sessionStorage.setItem('loginMessage', 'Please login to continue');
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
};

export default UserProtectedRoute;
