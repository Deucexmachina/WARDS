import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';

const UserProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    verifyToken();
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
        }
      });

      if (response.data.valid && response.data.user?.role === 'public') {
        setIsAuthenticated(true);
        localStorage.setItem('user', JSON.stringify(response.data.user));
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('userToken');
        localStorage.removeItem('user');
        sessionStorage.setItem('redirectAfterLogin', location.pathname);
      }
    } catch (error) {
      setIsAuthenticated(false);
      localStorage.removeItem('userToken');
      localStorage.removeItem('user');
      sessionStorage.setItem('redirectAfterLogin', location.pathname);
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
