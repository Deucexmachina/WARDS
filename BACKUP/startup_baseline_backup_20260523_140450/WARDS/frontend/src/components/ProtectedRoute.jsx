import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
    sessionStorage.removeItem('securityAuthenticated');
    sessionStorage.removeItem('securityAuthenticatedAt');
  };

  const verifyToken = async () => {
    const token = localStorage.getItem('adminToken');
    
    if (!token) {
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    try {
      const response = await axios.get('http://localhost:8000/api/admin/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const adminAuthenticatedAt = Date.parse(localStorage.getItem('adminAuthenticatedAt') || '');
      const serverStartedAt = Date.parse(response.data.server_started_at || '');

      if (serverStartedAt && (!adminAuthenticatedAt || adminAuthenticatedAt <= serverStartedAt)) {
        clearAdminSession();
        setIsAuthenticated(false);
        return;
      }

      if (response.data.valid && response.data.user?.role === 'admin') {
        setIsAuthenticated(true);
        localStorage.setItem('adminUser', JSON.stringify(response.data.user));
        if (!localStorage.getItem('adminAuthenticatedAt')) {
          localStorage.setItem('adminAuthenticatedAt', new Date().toISOString());
        }
      } else {
        setIsAuthenticated(false);
        clearAdminSession();
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      setIsAuthenticated(false);
      clearAdminSession();
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

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
