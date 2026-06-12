import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { clearBranchSettingsSession } from '../utils/settingsSecurity';

const AUTH_VERIFY_TIMEOUT_MS = 8000;

const BranchProtectedRoute = ({ children }) => {
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
    const token = localStorage.getItem('branchToken');
    
    if (!token) {
      setIsAuthenticated(false);
      setIsLoading(false);
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem('loginPortal', 'branch');
      sessionStorage.setItem('loginMessage', 'Please login with your branch account to continue.');
      return;
    }

    try {
      const response = await axios.get('http://localhost:8000/api/branch/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: AUTH_VERIFY_TIMEOUT_MS,
      });

      const branchAuthenticatedAt = Date.parse(localStorage.getItem('branchAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');
      if (serverStartedAt && (!branchAuthenticatedAt || branchAuthenticatedAt <= serverStartedAt)) {
        setIsAuthenticated(false);
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
        setIsAuthenticated(true);
        localStorage.setItem('branchUser', JSON.stringify(response.data.user));
        if (!localStorage.getItem('branchAuthenticatedAt')) {
          localStorage.setItem('branchAuthenticatedAt', new Date().toISOString());
        }
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('branchToken');
        localStorage.removeItem('branchUser');
        localStorage.removeItem('branchAuthenticatedAt');
        clearBranchSettingsSession();
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
        sessionStorage.setItem('loginPortal', 'branch');
        sessionStorage.setItem('loginMessage', 'Please login with your branch account to continue.');
      }
    } catch (error) {
      setIsAuthenticated(false);
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      clearBranchSettingsSession();
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
      sessionStorage.setItem('loginPortal', 'branch');
      sessionStorage.setItem(
        'loginMessage',
        error.code === 'ECONNABORTED' || !error.response
          ? 'Unable to reach the backend. Please make sure the API server is running.'
          : 'Please login with your branch account to continue.'
      );
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

  if (!isAuthenticated) {
    return <Navigate to="/login?portal=branch" state={{ from: location.pathname }} replace />;
  }

  return children;
};

export default BranchProtectedRoute;
