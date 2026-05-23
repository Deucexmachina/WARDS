import { useState, useEffect } from 'react';
import axios from 'axios';
import WardsPageHero from '../../components/WardsPageHero';

const API_BASE_URL = 'http://localhost:8000/api';
const PAYMENT_TIME_ZONE = 'Asia/Manila';

const parsePaymentDate = (value) => {
  if (!value) return null;
  const normalizedValue =
    typeof value === 'string' && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const parsedDate = new Date(normalizedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const formatPaymentDate = (value, options) => {
  const parsedDate = parsePaymentDate(value);
  if (!parsedDate) return 'N/A';
  return parsedDate.toLocaleString('en-PH', { timeZone: PAYMENT_TIME_ZONE, ...options });
};

const PaymentManagement = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      let url = `${API_BASE_URL}/payments`;
      
      // If branch admin/staff, filter by their branch
      if (user.role === 'branch_admin' || user.role === 'branch_staff') {
        const branchResponse = await axios.get(`${API_BASE_URL}/public/branches`);
        const branch = branchResponse.data.find(b => b.id === user.branch_id);
        if (branch) {
          url += `?branch=${encodeURIComponent(branch.name)}`;
        }
      }
      
      const response = await axios.get(url);
      setPayments(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
      setLoading(false);
    }
  };

  const handleVerifyPayment = async (paymentId) => {
    try {
      await axios.put(`${API_BASE_URL}/payments/${paymentId}/verify`);
      alert('Payment verified successfully');
      fetchPayments();
    } catch (error) {
      console.error('Failed to verify payment:', error);
      alert('Failed to verify payment');
    }
  };

  const normalizeStatus = (status) => {
    const normalized = (status || '').toString().trim().toLowerCase();
    if (['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success'].includes(normalized)) {
      return 'confirmed';
    }
    if (normalized === 'expired') return 'expired';
    if (['failed', 'declined', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
    return 'pending';
  };

  const filteredPayments = payments.filter(p => {
    if (filter === 'all') return true;
    return normalizeStatus(p.status) === filter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="border-4 border-blue-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading payments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Payment Management"
        subtitle="Monitor incoming payments, review transaction statuses, and refresh collection visibility across the system."
        actions={(
          <button
            onClick={fetchPayments}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Refresh
          </button>
        )}
      />

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg ${filter === 'pending' ? 'bg-yellow-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('confirmed')}
            className={`px-4 py-2 rounded-lg ${filter === 'confirmed' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Confirmed
          </button>
          <button
            onClick={() => setFilter('failed')}
            className={`px-4 py-2 rounded-lg ${filter === 'failed' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Failed
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Taxpayer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Verified</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPayments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">{payment.transaction_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{payment.taxpayer_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-semibold">₱{payment.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{payment.payment_method}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      normalizeStatus(payment.status) === 'confirmed' ? 'bg-green-100 text-green-800' :
                      normalizeStatus(payment.status) === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      normalizeStatus(payment.status) === 'expired' ? 'bg-orange-100 text-orange-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {normalizeStatus(payment.status) === 'confirmed' ? 'Verified' :
                       normalizeStatus(payment.status) === 'pending' ? 'Pending' :
                       normalizeStatus(payment.status) === 'expired' ? 'Expired' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="font-medium text-gray-700">
                      {formatPaymentDate(payment.created_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatPaymentDate(payment.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {payment.verified_at ? (
                      <>
                        <div className="font-medium text-gray-700">
                          {formatPaymentDate(payment.verified_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatPaymentDate(payment.verified_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                        </div>
                      </>
                    ) : (
                      'N/A'
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {normalizeStatus(payment.status) === 'pending' && (
                      <button
                        onClick={() => handleVerifyPayment(payment.id)}
                        className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                      >
                        Verify
                      </button>
                    )}
                    <button className="ml-2 text-blue-600 hover:text-blue-800">
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredPayments.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No payments found
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Total Payments</h3>
          <p className="text-3xl font-bold text-gray-800">{payments.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Pending Verification</h3>
          <p className="text-3xl font-bold text-yellow-600">
            {payments.filter(p => normalizeStatus(p.status) === 'pending').length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Verified Payments</h3>
          <p className="text-3xl font-bold text-green-600">
            {payments.filter(p => normalizeStatus(p.status) === 'confirmed').length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Failed/Expired</h3>
          <p className="text-3xl font-bold text-red-600">
            {payments.filter(p => ['failed', 'expired'].includes(normalizeStatus(p.status))).length}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PaymentManagement;
