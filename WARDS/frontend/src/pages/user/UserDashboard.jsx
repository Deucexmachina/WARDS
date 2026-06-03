import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ActionConfirmationModal from '../../components/ActionConfirmationModal';

const UserDashboard = () => {
  const [user, setUser] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('userToken');
    localStorage.removeItem('user');
    setShowLogoutConfirm(false);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-green-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-white text-xl font-bold">Citizen Dashboard</h1>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Welcome, {user?.full_name}!</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600"><strong>Email:</strong> {user?.email}</p>
              <p className="text-gray-600"><strong>Contact:</strong> {user?.contact_number}</p>
              {user?.address && <p className="text-gray-600"><strong>Address:</strong> {user?.address}</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Pay Taxes</h3>
            <p className="text-gray-600 text-sm mb-4">Submit tax payments online</p>
            <button onClick={() => navigate('/pay-taxes')} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition">
              Go to Payment
            </button>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Get Queue Number</h3>
            <p className="text-gray-600 text-sm mb-4">Register for queue service</p>
            <button onClick={() => navigate('/get-queue')} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition">
              Get Queue
            </button>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Request Receipt</h3>
            <p className="text-gray-600 text-sm mb-4">Request copy of receipts</p>
            <button onClick={() => navigate('/request-receipt')} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition">
              Request
            </button>
          </div>
        </div>
      </div>

      <ActionConfirmationModal
        open={showLogoutConfirm}
        title="Are you sure you want to logout?"
        message="You will need to sign in again to access your citizen dashboard."
        confirmLabel="Confirm Logout"
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
};

export default UserDashboard;
