import { useEffect, useState } from 'react';
import api from '../../services/api';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime, formatUtc8Time } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const getPaymentStatusClasses = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (['confirmed', 'verified', 'paid', 'successful', 'success'].includes(normalizedStatus)) {
    return 'bg-green-100 text-green-800';
  }

  if (['pending', 'processing'].includes(normalizedStatus)) {
    return 'bg-yellow-100 text-yellow-800';
  }

  return 'bg-red-100 text-red-800';
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingPaymentId, setDeletingPaymentId] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [selectedServiceType, setSelectedServiceType] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [discrepancyError, setDiscrepancyError] = useState('');
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState('Verified');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [savingVerification, setSavingVerification] = useState(false);

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    fetchDashboardData();

    let intervalId;
    if (autoRefresh) {
      intervalId = setInterval(() => {
        fetchDashboardData();
      }, 30000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [selectedBranch, selectedServiceType, dateFrom, dateTo, autoRefresh]);

  const fetchCurrentUser = async () => {
    const cachedAdminUser = localStorage.getItem('adminUser');
    if (cachedAdminUser) {
      try {
        setCurrentUser(JSON.parse(cachedAdminUser));
        return;
      } catch (error) {
        console.error('Failed to parse cached admin user:', error);
      }
    }

    try {
      const response = await api.get('/auth/me');
      setCurrentUser(response.data);
    } catch (error) {
      console.error('Failed to fetch current user:', error);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const params = {};
      if (selectedBranch) params.branch_id = selectedBranch;
      if (selectedServiceType) params.service_type = selectedServiceType;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const [response, discrepancyResponse] = await Promise.all([
        api.get('/dashboard/statistics', { params }),
        discrepancyAPI.getAdminReports(),
      ]);
      setStats(response.data);
      setLastUpdated(response.data?.timestamp || new Date().toISOString());
      setDiscrepancies(discrepancyResponse.data || []);
      setDiscrepancyError('');
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to load discrepancy reports.');
    } finally {
      setLoading(false);
    }
  };

  const openVerifyModal = (report) => {
    setSelectedDiscrepancy(report);
    setVerificationStatus(report.status === 'Rejected' ? 'Rejected' : 'Verified');
    setVerificationNotes(report.verification_notes || '');
  };

  const closeVerifyModal = () => {
    setSelectedDiscrepancy(null);
    setVerificationStatus('Verified');
    setVerificationNotes('');
  };

  const handleDownloadDiscrepancyAttachment = async (report) => {
    try {
      const response = await discrepancyAPI.downloadAdminAttachment(report.id);
      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = report.attachment_filename || `discrepancy-${report.id}-attachment`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (error) {
      console.error('Failed to download discrepancy attachment:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to download attachment.');
    }
  };

  const handleVerifyDiscrepancy = async () => {
    if (!selectedDiscrepancy) {
      return;
    }

    try {
      setSavingVerification(true);
      await discrepancyAPI.verifyReport(selectedDiscrepancy.id, {
        status: verificationStatus,
        verification_notes: verificationNotes,
      });
      closeVerifyModal();
      await fetchDashboardData();
    } catch (error) {
      console.error('Failed to verify discrepancy report:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to verify discrepancy report.');
    } finally {
      setSavingVerification(false);
    }
  };

  const handleDeletePendingPayment = async (payment) => {
    const confirmed = window.confirm(
      `Remove pending payment ${payment.transaction_id}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingPaymentId(payment.id);
      await api.delete(`/payments/${payment.id}`);
      await fetchDashboardData();
    } catch (error) {
      console.error('Failed to delete payment:', error);
      alert(error.response?.data?.detail || 'Failed to remove pending payment.');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const effectiveRole = currentUser?.internal_role || currentUser?.role;

  const getDashboardTitle = () => {
    if (!currentUser) return 'Dashboard';

    if (effectiveRole === 'superadmin') {
      return 'Superadmin Dashboard';
    }

    if (effectiveRole === 'main_admin' || effectiveRole === 'admin') {
      return 'Main Office Dashboard';
    }

    if (effectiveRole === 'branch_admin' || effectiveRole === 'branch_staff') {
      const branchName = stats?.branches?.find(
        (branch) => branch.branch_id === currentUser.branch_id
      )?.branch_name;
      return branchName ? `${branchName} Dashboard` : 'Branch Dashboard';
    }

    return 'Dashboard';
  };

  const maxQueueValue = Math.max(
    1,
    ...(stats?.branches || []).map(
      (branch) =>
        branch.clients_waiting +
        branch.clients_being_served +
        branch.clients_completed
    )
  );

  const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString()}`;
  const recentDiscrepancies = discrepancies.slice(0, 5);
  const pendingDiscrepancies = discrepancies.filter((report) => report.status === 'Pending Review').length;
  const verifiedDiscrepancies = discrepancies.filter((report) => report.status === 'Verified').length;
  const offlineDiscrepancies = discrepancies.filter((report) => report.submitted_offline).length;

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <WardsPageHero
          eyebrow={effectiveRole === 'main_admin' || effectiveRole === 'superadmin' ? (effectiveRole === 'superadmin' ? 'Superadmin Dashboard' : 'Main Admin Dashboard') : 'Branch Dashboard'}
          title={getDashboardTitle()}
          subtitle={
            effectiveRole === 'main_admin' || effectiveRole === 'superadmin'
              ? 'Monitor branch activity, apply operational filters, and review live system performance from the central dashboard.'
              : 'Track branch performance, service activity, and operational updates from one consolidated dashboard.'
          }
          className="mb-6"
        />

        {effectiveRole === 'main_admin' || effectiveRole === 'superadmin' ? (
          <div className="mb-6 rounded-lg bg-white p-4 shadow">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Branch Filter
                </label>
                <select
                  value={selectedBranch || ''}
                  onChange={(e) => setSelectedBranch(e.target.value || null)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-accent"
                >
                  <option value="">All Branches</option>
                  {stats?.branches?.map((branch) => (
                    <option key={branch.branch_id} value={branch.branch_id}>
                      {branch.branch_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Service Type
                </label>
                <select
                  value={selectedServiceType || ''}
                  onChange={(e) => setSelectedServiceType(e.target.value || null)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-accent"
                >
                  <option value="">All Services</option>
                  <option value="Real Property Tax">Real Property Tax</option>
                  <option value="Business Tax">Business Tax</option>
                  <option value="Miscellaneous Tax">Miscellaneous Tax</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  onClick={fetchDashboardData}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Apply Filters
                </button>
                <button
                  onClick={() => {
                    setSelectedBranch(null);
                    setSelectedServiceType(null);
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="rounded-lg bg-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-400"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition duration-300 ${
                  autoRefresh
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-300 text-gray-700'
                }`}
              >
                {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
              </button>
              <div className="text-sm text-gray-500">
                Last updated: {lastUpdated ? formatUtc8Time(lastUpdated) : 'N/A'}
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-lg bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition duration-300 ${
                  autoRefresh
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-300 text-gray-700'
                }`}
              >
                {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
              </button>
              <div className="text-sm text-gray-500">
                Last updated: {lastUpdated ? formatUtc8Time(lastUpdated) : 'N/A'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-orange-100">Clients Waiting</p>
              <p className="text-3xl font-bold">
                {stats?.summary?.total_clients_waiting || 0}
              </p>
            </div>
            <svg className="h-12 w-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-blue-100">Being Served</p>
              <p className="text-3xl font-bold">
                {stats?.summary?.total_clients_being_served || 0}
              </p>
            </div>
            <svg className="h-12 w-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-green-100">Completed Today</p>
              <p className="text-3xl font-bold">
                {stats?.summary?.total_clients_completed || 0}
              </p>
            </div>
            <svg className="h-12 w-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-purple-100">Active Branches</p>
              <p className="text-3xl font-bold">{stats?.summary?.active_branches || 0}</p>
            </div>
            <svg className="h-12 w-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-primary">Branch Performance Chart</h3>
          <span className="text-sm text-gray-500">Waiting / Serving / Completed</span>
        </div>
        <div className="space-y-4">
          {(stats?.branches || []).map((branch) => {
            const total =
              branch.clients_waiting +
              branch.clients_being_served +
              branch.clients_completed;

            return (
              <div key={branch.branch_id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">{branch.branch_name}</span>
                  <span className="text-gray-500">{total} clients</span>
                </div>
                <div className="flex h-4 overflow-hidden rounded bg-gray-100">
                  <div
                    className="bg-orange-500"
                    style={{ width: `${(branch.clients_waiting / maxQueueValue) * 100}%` }}
                    title={`${branch.clients_waiting} waiting`}
                  />
                  <div
                    className="bg-blue-500"
                    style={{ width: `${(branch.clients_being_served / maxQueueValue) * 100}%` }}
                    title={`${branch.clients_being_served} being served`}
                  />
                  <div
                    className="bg-green-500"
                    style={{ width: `${(branch.clients_completed / maxQueueValue) * 100}%` }}
                    title={`${branch.clients_completed} completed`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-lg">
        <h3 className="mb-4 text-xl font-bold text-primary">Branch Queue Activity</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Branch
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Waiting
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Being Served
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Completed
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {(stats?.branches || []).map((branch) => (
                <tr key={branch.branch_id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 font-semibold">
                    {branch.branch_name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {branch.location}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="font-bold text-orange-600">{branch.clients_waiting}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="font-bold text-blue-600">{branch.clients_being_served}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="font-bold text-green-600">{branch.clients_completed}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        branch.status === 'Active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {branch.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-lg">
        <h3 className="mb-4 text-xl font-bold text-primary">Online Payment Activity</h3>
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-blue-50 p-4">
            <p className="mb-1 text-sm text-gray-600">Total Payments Today</p>
            <p className="text-2xl font-bold text-blue-600">
              {formatCurrency(stats?.payments?.total_amount)}
            </p>
          </div>
          <div className="rounded-lg bg-yellow-50 p-4">
            <p className="mb-1 text-sm text-gray-600">Pending Verification</p>
            <p className="text-2xl font-bold text-yellow-600">
              {stats?.payments?.pending_count || 0}
            </p>
          </div>
          <div className="rounded-lg bg-green-50 p-4">
            <p className="mb-1 text-sm text-gray-600">Confirmed</p>
            <p className="text-2xl font-bold text-green-600">
              {stats?.payments?.confirmed_count || 0}
            </p>
          </div>
          <div className="rounded-lg bg-red-50 p-4">
            <p className="mb-1 text-sm text-gray-600">Failed</p>
            <p className="text-2xl font-bold text-red-600">
              {stats?.payments?.failed_count || 0}
            </p>
          </div>
        </div>

        {stats?.payments?.recent_payments?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Transaction ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Branch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Taxpayer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {stats.payments.recent_payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-sm">
                      {payment.transaction_id}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {payment.branch_name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">{payment.taxpayer_name}</td>
                    <td className="whitespace-nowrap px-6 py-4 font-semibold">
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${getPaymentStatusClasses(payment.status)}`}
                      >
                        {payment.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatUtc8Time(payment.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {String(payment.status || '').trim().toLowerCase() === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleDeletePendingPayment(payment)}
                          disabled={deletingPaymentId === payment.id}
                          className="rounded-md bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingPaymentId === payment.id ? 'Removing...' : 'Remove'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white p-6 shadow-lg">
        <h3 className="mb-4 text-xl font-bold text-primary">System Alerts</h3>
        {stats?.recent_alerts?.length === 0 ? (
          <p className="py-8 text-center text-gray-500">No active alerts</p>
        ) : (
          <div className="space-y-4">
            {stats?.recent_alerts?.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border-l-4 p-4 ${
                  alert.severity === 'high'
                    ? 'border-red-500 bg-red-50'
                    : alert.severity === 'medium'
                    ? 'border-yellow-500 bg-yellow-50'
                    : 'border-blue-500 bg-blue-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{alert.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{alert.message}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      {formatUtc8DateTime(alert.created_at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      alert.severity === 'high'
                        ? 'bg-red-100 text-red-800'
                        : alert.severity === 'medium'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-primary">Discrepancy Reporting Module</h3>
            <p className="mt-2 text-sm text-gray-600 max-w-3xl">
              Live discrepancy reports submitted by branches are forwarded here for main office review, verification,
              traceability, and accountability tracking.
            </p>
          </div>
        </div>

        {discrepancyError && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {discrepancyError}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-yellow-50 p-4">
            <p className="text-sm text-gray-600">Pending Review</p>
            <p className="mt-2 text-2xl font-bold text-yellow-700">{pendingDiscrepancies}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-4">
            <p className="text-sm text-gray-600">Verified Reports</p>
            <p className="mt-2 text-2xl font-bold text-green-700">{verifiedDiscrepancies}</p>
          </div>
          <div className="rounded-lg bg-blue-50 p-4">
            <p className="text-sm text-gray-600">Submitted While Offline</p>
            <p className="mt-2 text-2xl font-bold text-blue-700">{offlineDiscrepancies}</p>
          </div>
        </div>

        {recentDiscrepancies.length === 0 ? (
          <p className="py-8 text-center text-gray-500">No discrepancy reports submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Report ID</th>
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Variance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Reported By</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentDiscrepancies.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-3 font-mono">DR-{report.id}</td>
                    <td className="px-4 py-3">{report.branch_name}</td>
                    <td className="px-4 py-3">{report.discrepancy_type}</td>
                    <td className="px-4 py-3 font-semibold text-red-600">{formatCurrency(report.variance_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        report.status === 'Verified'
                          ? 'bg-green-100 text-green-800'
                          : report.status === 'Rejected'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{report.reported_by}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openVerifyModal(report)}
                        className="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDiscrepancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-8 shadow-2xl">
            <h2 className="mb-6 text-2xl font-bold text-primary">Verify Discrepancy Report</h2>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Branch</p>
                <p className="mt-1 font-semibold text-gray-800">{selectedDiscrepancy.branch_name}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Reported By</p>
                <p className="mt-1 font-semibold text-gray-800">{selectedDiscrepancy.reported_by}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">System Amount</p>
                <p className="mt-1 font-semibold text-gray-800">{formatCurrency(selectedDiscrepancy.system_amount)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Actual Amount</p>
                <p className="mt-1 font-semibold text-gray-800">{formatCurrency(selectedDiscrepancy.actual_amount)}</p>
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Discrepancy Details</p>
              <div className="rounded-lg border border-gray-200 p-4 whitespace-pre-line text-gray-700">
                {selectedDiscrepancy.description}
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700">Attached File</p>
              <div className="rounded-lg border border-gray-200 p-4 text-gray-700">
                {selectedDiscrepancy.attachment_filename ? (
                  <div className="flex items-center justify-between gap-4">
                    <span>{selectedDiscrepancy.attachment_filename}</span>
                    <button
                      type="button"
                      onClick={() => handleDownloadDiscrepancyAttachment(selectedDiscrepancy)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      Download
                    </button>
                  </div>
                ) : (
                  'No attachment uploaded.'
                )}
              </div>
            </div>

            <div className="mb-5">
              <label className="mb-2 block font-semibold text-gray-700">Verification Status</label>
              <select
                value={verificationStatus}
                onChange={(event) => setVerificationStatus(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="Verified">Verified</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            <div className="mb-6">
              <label className="mb-2 block font-semibold text-gray-700">Verification Notes</label>
              <textarea
                value={verificationNotes}
                onChange={(event) => setVerificationNotes(event.target.value)}
                rows="5"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Document your review findings, actions, and accountability notes..."
              ></textarea>
            </div>

            <div className="flex gap-4">
              <button
                onClick={closeVerifyModal}
                className="flex-1 rounded-lg bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyDiscrepancy}
                disabled={savingVerification}
                className="flex-1 rounded-lg bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
              >
                {savingVerification ? 'Saving...' : 'Save Verification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
