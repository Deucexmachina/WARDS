import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { receiptAPI } from '../../services/api';
import ActionConfirmationModal from '../../components/ActionConfirmationModal';

const STATUS_STYLES = {
  'Payment Pending': 'bg-yellow-100 text-yellow-800',
  Pending: 'bg-yellow-100 text-yellow-800',
  'Not Ready for Release': 'bg-gray-100 text-gray-800',
  'Ready for Release': 'bg-blue-100 text-blue-800',
  Released: 'bg-green-100 text-green-800',
  Completed: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-red-100 text-red-800',
  Processing: 'bg-blue-100 text-blue-800',
  'Under Validation': 'bg-yellow-100 text-yellow-800',
};

const getStatusClass = (status) => STATUS_STYLES[status] || 'bg-gray-100 text-gray-800';

const UserDashboard = () => {
  const [user, setUser] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  const fetchHistory = async (page = 1) => {
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const response = await receiptAPI.getMyRequestHistory(page, 5);
      setHistory(response.data.items || []);
      setHistoryPage(response.data.page || 1);
      setHistoryTotalPages(response.data.total_pages || 1);
    } catch (error) {
      console.error('Failed to load receipt request history:', error);
      setHistoryError('Unable to load receipt request history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchHistory(1);
    }
  }, [user]);

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

        {/* Receipt Request History */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Receipt Request History</h3>

          {historyError && (
            <p className="text-sm text-red-600 mb-4">{historyError}</p>
          )}

          {historyLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-600 border-t-transparent"></div>
            </div>
          ) : history.length === 0 ? (
            <p className="text-gray-500 text-sm py-4">No receipt requests found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-700 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3">Request ID</th>
                      <th className="px-4 py-3">Taxpayer</th>
                      <th className="px-4 py-3">Tax Type</th>
                      <th className="px-4 py-3">Overall Status</th>
                      <th className="px-4 py-3">Receipt Copy</th>
                      <th className="px-4 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map((item) => (
                      <tr key={item.requestId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{item.requestId}</td>
                        <td className="px-4 py-3 text-gray-700">{item.taxpayerName || '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{item.taxType || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusClass(item.status)}`}>
                            {item.status || 'Unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {item.releaseStatus === 'Released' ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700">
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Released
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500">
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                              </svg>
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Page {historyPage} of {historyTotalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fetchHistory(historyPage - 1)}
                      disabled={historyPage <= 1 || historyLoading}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => fetchHistory(historyPage + 1)}
                      disabled={historyPage >= historyTotalPages || historyLoading}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
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
