import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { discrepancyAPI } from '../../services/api';
import { formatUtc8DateTime, formatUtc8Time } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import { CustomSelect, CustomDatePicker } from '../../components/FormControls';
import {
  DiscrepancyInfoCard,
  DiscrepancySection,
  DiscrepancyStatusBadge,
  DiscrepancyTimelineEntry,
  discrepancyModalHeaderClass,
  discrepancyModalShellClass,
} from '../../components/discrepancies/DiscrepancyUI';

const CLOSED_DISCREPANCY_STATUSES = new Set(['Solved', 'Rejected']);

const formatDiscrepancyDateTime = (value) => formatUtc8DateTime(value);

const formatDiscrepancyCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'Not provided';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(Number(value));
};

const buildDiscrepancyPendingActionMessage = (report) => {
  if (!report) return 'Review the discrepancy details and determine the next resolution step.';
  if (CLOSED_DISCREPANCY_STATUSES.has(report.status)) {
    return `This report is already ${report.status}. Historical responses remain available for audit review.`;
  }
  if (report.has_unread_for_admin) return 'A new branch update is waiting for administrative review.';
  if (report.status === 'Pending Review') return 'Initial assessment is needed. Confirm the issue and move it into the appropriate resolution stage.';
  if (report.status === 'Under Review') return 'Continue investigating the discrepancy and communicate the next required action to the branch if needed.';
  return 'Review the current status, add resolution notes if needed, and save the updated administrative action.';
};

const getPaymentStatusClasses = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (normalizedStatus === 'payment_verified') {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (normalizedStatus === 'or_generated') {
    return 'bg-blue-100 text-blue-800';
  }
  if (normalizedStatus === 'completed') {
    return 'bg-green-100 text-green-800';
  }
  if (['confirmed', 'verified', 'paid', 'successful', 'success'].includes(normalizedStatus)) {
    return 'bg-green-100 text-green-800';
  }
  if (['payment_submitted', 'validated', 'documents_uploaded'].includes(normalizedStatus)) {
    return 'bg-sky-100 text-sky-800';
  }
  if (normalizedStatus === 'pending_treasury_validation') {
    return 'bg-amber-100 text-amber-800';
  }
  if (normalizedStatus === 'clarification_requested') {
    return 'bg-orange-100 text-orange-800';
  }
  if (['payment_rejected', 'returned_for_correction'].includes(normalizedStatus)) {
    return 'bg-red-100 text-red-800';
  }
  if (normalizedStatus.includes('pending') || normalizedStatus === 'processing') {
    return 'bg-yellow-100 text-yellow-800';
  }
  if (['failed', 'declined', 'cancelled', 'canceled', 'rejected'].includes(normalizedStatus)) {
    return 'bg-rose-100 text-rose-800';
  }

  return 'bg-gray-100 text-gray-800';
};

const getPaymentStatusLabel = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  const labels = {
    payment_verified: 'Payment Verified',
    or_generated: 'OR Generated',
    completed: 'Completed',
    payment_submitted: 'Payment Submitted',
    pending_treasury_validation: 'Pending Treasury Validation',
    clarification_requested: 'Clarification Requested',
    payment_rejected: 'Payment Rejected',
    returned_for_correction: 'Returned for Correction',
    property_searched: 'Property Searched',
    property_found: 'Property Found',
    added_to_cart: 'Added to Cart',
    payment_initiated: 'Payment Initiated',
    validated: 'Validated',
    documents_uploaded: 'Documents Uploaded',
    pending: 'Pending',
    processing: 'Processing',
    confirmed: 'Confirmed',
    verified: 'Payment Verified',
    paid: 'Paid',
    successful: 'Successful',
    success: 'Success',
    failed: 'Failed',
    declined: 'Declined',
    cancelled: 'Cancelled',
    canceled: 'Canceled',
    rejected: 'Rejected',
  };

  return labels[normalizedStatus] || status || 'Unknown';
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
  const [discrepancyReplyDraft, setDiscrepancyReplyDraft] = useState('');
  const [showDiscrepancyReplyComposer, setShowDiscrepancyReplyComposer] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState(null);

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
      const response = await api.get('/auth/unified/me');
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

  const openVerifyModal = async (report) => {
    try {
      if (report?.has_unread_for_admin) {
        await discrepancyAPI.markAdminViewed(report.id);
        window.dispatchEvent(new CustomEvent('admin-discrepancy-viewed'));
      }
    } catch (markViewedError) {
      console.error('Failed to mark discrepancy as viewed for admin:', markViewedError);
    }
    setSelectedDiscrepancy(report);
    setVerificationStatus(report.status || 'Under Review');
    setVerificationNotes(report.verification_notes || '');
    setDiscrepancyReplyDraft('');
    setShowDiscrepancyReplyComposer(false);
    setDiscrepancies((current) =>
      current.map((item) =>
        item.id === report.id
          ? { ...item, last_viewed_by_admin: new Date().toISOString(), has_unread_for_admin: false }
          : item
      )
    );
  };

  const closeVerifyModal = () => {
    setSelectedDiscrepancy(null);
    setVerificationStatus('Verified');
    setVerificationNotes('');
    setDiscrepancyReplyDraft('');
    setShowDiscrepancyReplyComposer(false);
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
    if (!selectedDiscrepancy) return;
    try {
      setSavingVerification(true);
      const response = await discrepancyAPI.verifyReport(selectedDiscrepancy.id, {
        status: verificationStatus,
        verification_notes: showDiscrepancyReplyComposer ? discrepancyReplyDraft : verificationNotes,
      });
      setSelectedDiscrepancy(response.data);
      setVerificationStatus(response.data.status || verificationStatus);
      setVerificationNotes(response.data.verification_notes || '');
      setDiscrepancyReplyDraft('');
      setShowDiscrepancyReplyComposer(false);
      await fetchDashboardData();
      window.dispatchEvent(new CustomEvent('admin-discrepancy-reviewed'));
      window.dispatchEvent(new CustomEvent('admin-discrepancy-viewed'));
    } catch (error) {
      console.error('Failed to verify discrepancy report:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to verify discrepancy report.');
    } finally {
      setSavingVerification(false);
    }
  };

  const handleDeletePendingPayment = async (payment) => {
    if (!paymentToDelete) {
      setPaymentToDelete(payment);
      return;
    }

    try {
      setDeletingPaymentId(paymentToDelete.id);
      await api.delete(`/payments/${paymentToDelete.id}`);
      await fetchDashboardData();
      setPaymentToDelete(null);
    } catch (error) {
      console.error('Failed to delete payment:', error);
      setDiscrepancyError(error.response?.data?.detail || 'Failed to remove pending payment.');
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
  const recentPayments = stats?.payments?.recent_payments || [];
  const paymentBranchGroups = useMemo(() => (
    recentPayments.reduce((groups, payment) => {
      const branchName = payment.branch_name || 'Unassigned Branch';
      if (!groups[branchName]) {
        groups[branchName] = {
          branchName,
          payments: [],
          totalAmount: 0,
          verifiedCount: 0,
          pendingCount: 0,
          failedCount: 0,
        };
      }
      const normalizedStatus = String(payment.status || '').trim().toLowerCase();
      groups[branchName].payments.push(payment);
      groups[branchName].totalAmount += Number(payment.amount || 0);
      if (['confirmed', 'verified', 'paid', 'successful', 'success'].includes(normalizedStatus)) {
        groups[branchName].verifiedCount += 1;
      } else if (normalizedStatus.includes('pending') || normalizedStatus === 'processing') {
        groups[branchName].pendingCount += 1;
      } else {
        groups[branchName].failedCount += 1;
      }
      return groups;
    }, {})
  ), [recentPayments]);
  const paymentBranchSections = Object.values(paymentBranchGroups).sort((left, right) => (
    right.totalAmount - left.totalAmount || left.branchName.localeCompare(right.branchName)
  ));
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
                <CustomSelect value={selectedBranch || ''} onChange={(value) => setSelectedBranch(value || null)} options={[{ value: '', label: 'All Branches' }, ...(stats?.branches || []).map((branch) => ({ value: String(branch.branch_id), label: branch.branch_name }))]} placeholder="All Branches" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Service Type
                </label>
                <CustomSelect value={selectedServiceType || ''} onChange={(value) => setSelectedServiceType(value || null)} options={[{ value: '', label: 'All Services' }, { value: 'Real Property Tax', label: 'Real Property Tax' }, { value: 'Business Tax', label: 'Business Tax' }, { value: 'Miscellaneous Tax', label: 'Miscellaneous Tax' }]} placeholder="All Services" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Date From
                </label>
                <CustomDatePicker
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Date To
                </label>
                <CustomDatePicker
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
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

      <div className="mb-8 flex md:grid overflow-x-auto md:overflow-visible snap-x snap-mandatory gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 p-6 text-white shadow-lg">
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

        <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-lg">
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

        <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-6 text-white shadow-lg">
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

        <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 p-6 text-white shadow-lg">
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
        <div className="overflow-x-auto md:overflow-hidden">
          <table className="w-full table-auto min-w-[600px]">
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

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/70">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Payment Monitor</p>
            <h3 className="mt-2 text-2xl font-black text-primary">Online Payment Activity</h3>
            <p className="mt-1 text-sm text-slate-500">Recent online collections are grouped by branch for cleaner review.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">
            {recentPayments.length} recent records
          </span>
        </div>
        <div className="mb-6 flex md:grid overflow-x-auto md:overflow-visible snap-x snap-mandatory gap-4 md:grid-cols-4">
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <p className="mb-1 text-sm font-medium text-slate-600">Total Payments Today</p>
            <p className="text-3xl font-black text-blue-600">
              {formatCurrency(stats?.payments?.total_amount)}
            </p>
          </div>
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="mb-1 text-sm font-medium text-slate-600">Pending Verification</p>
            <p className="text-3xl font-black text-amber-600">
              {stats?.payments?.pending_count || 0}
            </p>
          </div>
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="mb-1 text-sm font-medium text-slate-600">Confirmed</p>
            <p className="text-3xl font-black text-emerald-600">
              {stats?.payments?.confirmed_count || 0}
            </p>
          </div>
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-2xl border border-rose-100 bg-rose-50 p-4">
            <p className="mb-1 text-sm font-medium text-slate-600">Failed</p>
            <p className="text-3xl font-black text-rose-600">
              {stats?.payments?.failed_count || 0}
            </p>
          </div>
        </div>

        {paymentBranchSections.length > 0 && (
          <div className="space-y-4">
            {paymentBranchSections.map((branchGroup) => (
              <section key={branchGroup.branchName} className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex flex-col gap-3 bg-slate-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Branch Collection</p>
                    <h4 className="mt-1 text-lg font-black text-[#0f2f5f]">{branchGroup.branchName}</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs font-bold text-slate-600 sm:grid-cols-4">
                    <span className="rounded-full bg-white px-3 py-2 ring-1 ring-slate-200">{branchGroup.payments.length} records</span>
                    <span className="rounded-full bg-white px-3 py-2 ring-1 ring-slate-200">{formatCurrency(branchGroup.totalAmount)}</span>
                    <span className="rounded-full bg-emerald-50 px-3 py-2 text-emerald-700 ring-1 ring-emerald-100">{branchGroup.verifiedCount} verified</span>
                    <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-700 ring-1 ring-amber-100">{branchGroup.pendingCount} pending</span>
                  </div>
                </div>
                <div className="overflow-x-auto md:overflow-hidden">
                  <table className="w-full table-auto min-w-[600px]">
                    <thead>
                      <tr className="bg-white">
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Transaction ID</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Taxpayer</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Amount</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Time</th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {branchGroup.payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-4 font-mono text-sm text-slate-900">{payment.transaction_id}</td>
                          <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{payment.taxpayer_name}</td>
                          <td className="whitespace-nowrap px-5 py-4 font-bold text-slate-950">{formatCurrency(payment.amount)}</td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getPaymentStatusClasses(payment.status)}`}>
                              {getPaymentStatusLabel(payment.status)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">{formatUtc8Time(payment.created_at)}</td>
                          <td className="whitespace-nowrap px-5 py-4">
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
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
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

        <div className="mb-6 flex md:grid overflow-x-auto md:overflow-visible snap-x snap-mandatory gap-4 md:grid-cols-3">
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-lg bg-yellow-50 p-4">
            <p className="text-sm text-gray-600">Pending Review</p>
            <p className="mt-2 text-2xl font-bold text-yellow-700">{pendingDiscrepancies}</p>
          </div>
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-lg bg-green-50 p-4">
            <p className="text-sm text-gray-600">Verified Reports</p>
            <p className="mt-2 text-2xl font-bold text-green-700">{verifiedDiscrepancies}</p>
          </div>
          <div className="w-[85%] md:w-auto flex-shrink-0 snap-center rounded-lg bg-blue-50 p-4">
            <p className="text-sm text-gray-600">Submitted While Offline</p>
            <p className="mt-2 text-2xl font-bold text-blue-700">{offlineDiscrepancies}</p>
          </div>
        </div>

        {recentDiscrepancies.length === 0 ? (
          <p className="py-8 text-center text-gray-500">No discrepancy reports submitted yet.</p>
        ) : (
          <div className="overflow-x-auto md:overflow-hidden">
            <table className="w-full table-auto text-sm min-w-[600px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Report ID</th>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Reported By</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentDiscrepancies.map((report) => (
                  <tr key={report.id} className={report.has_unread_for_admin ? 'bg-blue-50' : ''}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">DR-{report.id}</span>
                        {report.has_unread_for_admin && (
                          <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{report.title}</td>
                    <td className="px-4 py-3">{report.branch_name}</td>
                    <td className="px-4 py-3">{report.discrepancy_type}</td>
                    <td className="px-4 py-3">
                      <DiscrepancyStatusBadge status={report.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{report.reported_by}</div>
                      <div className="text-xs text-slate-500">{report.reported_by_role || 'Branch personnel'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openVerifyModal(report)}
                        className="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition hover:bg-secondary"
                      >
                        Review
                      </button>
                      {report.has_unread_for_admin && (
                        <p className="mt-1 text-xs font-semibold text-blue-700">New Reply</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedDiscrepancy && (() => {
        const isClosedReport = CLOSED_DISCREPANCY_STATUSES.has(selectedDiscrepancy.status);
        const pendingActionMessage = buildDiscrepancyPendingActionMessage(selectedDiscrepancy);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className={discrepancyModalShellClass}>
              <div className={discrepancyModalHeaderClass}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">Review Discrepancy Report</p>
                    <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{selectedDiscrepancy.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-blue-100">
                      Review the original submission, understand prior responses, and apply the next administrative action with clear audit context.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <DiscrepancyStatusBadge status={selectedDiscrepancy.status} className="border-white/20 bg-white/10 text-white" />
                    <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white">
                      DR-{selectedDiscrepancy.id}
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto bg-slate-50 p-6 sm:p-8">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <DiscrepancyInfoCard label="Branch" value={selectedDiscrepancy.branch_name} tone="blue" helper="Origin of the discrepancy report." />
                  <DiscrepancyInfoCard
                    label="Submitted By"
                    value={selectedDiscrepancy.reported_by || 'Unknown submitter'}
                    tone="emerald"
                    helper={selectedDiscrepancy.reported_by_role || 'Branch personnel'}
                  />
                  <DiscrepancyInfoCard
                    label="Date Submitted"
                    value={formatDiscrepancyDateTime(selectedDiscrepancy.created_at)}
                    tone="amber"
                    helper={`Report date: ${selectedDiscrepancy.report_date || 'Not provided'}`}
                  />
                  <DiscrepancyInfoCard
                    label="Pending Action"
                    value={isClosedReport ? 'Audit only' : 'Review required'}
                    tone="violet"
                    helper={pendingActionMessage}
                  />
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
                  <div className="space-y-6">
                    <DiscrepancySection
                      title="Original Report Details"
                      description="What was reported, who submitted it, and the primary discrepancy context."
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <DiscrepancyInfoCard label="Discrepancy Type" value={selectedDiscrepancy.discrepancy_type || 'Not specified'} />
                        <DiscrepancyInfoCard label="Current Status" value={<DiscrepancyStatusBadge status={selectedDiscrepancy.status} />} />
                        <DiscrepancyInfoCard label="Submitted Offline" value={selectedDiscrepancy.submitted_offline ? 'Yes' : 'No'} />
                        <DiscrepancyInfoCard label="Last Updated" value={formatDiscrepancyDateTime(selectedDiscrepancy.updated_at || selectedDiscrepancy.created_at)} />
                      </div>
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 whitespace-pre-line">
                        {selectedDiscrepancy.description}
                      </div>
                    </DiscrepancySection>

                    <DiscrepancySection
                      title="Supporting Information"
                      description="References, amounts, and attachments relevant to the review."
                      action={selectedDiscrepancy.attachment_filename ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadDiscrepancyAttachment(selectedDiscrepancy)}
                          className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary"
                        >
                          Download File
                        </button>
                      ) : null}
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <DiscrepancyInfoCard
                          label="Queue Number / Reference"
                          value={selectedDiscrepancy.supporting_documents || 'No queue or reference details supplied.'}
                          helper="Includes receipt numbers, collection sheet references, or other branch notes."
                        />
                        <DiscrepancyInfoCard
                          label="Attachment"
                          value={selectedDiscrepancy.attachment_filename || 'No attachment uploaded'}
                          helper={selectedDiscrepancy.attachment_filename ? 'Use the download button to inspect the submitted evidence.' : 'Older reports remain fully readable even without uploaded files.'}
                        />
                        <DiscrepancyInfoCard label="System Amount" value={formatDiscrepancyCurrency(selectedDiscrepancy.system_amount)} />
                        <DiscrepancyInfoCard label="Actual Amount" value={formatDiscrepancyCurrency(selectedDiscrepancy.actual_amount)} />
                      </div>
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Variance</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{formatDiscrepancyCurrency(selectedDiscrepancy.variance_amount)}</p>
                      </div>
                    </DiscrepancySection>

                    <DiscrepancySection
                      title="Review History"
                      description="Chronological responses showing the exact administrator or branch participant involved."
                    >
                      <div className="space-y-4">
                        {(selectedDiscrepancy.conversation_thread || []).map((entry, index) => (
                          <DiscrepancyTimelineEntry
                            key={`${entry.created_at || 'entry'}-${index}`}
                            entry={entry}
                            formatDateTime={formatDiscrepancyDateTime}
                          />
                        ))}
                      </div>
                    </DiscrepancySection>
                  </div>

                  <div className="space-y-6">
                    <DiscrepancySection
                      title="Administrative Actions"
                      description="Update the resolution stage and communicate next steps to the branch."
                    >
                      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                        {pendingActionMessage}
                      </div>
                      <div className="mt-4">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Status / Resolution</label>
                        <CustomSelect value={verificationStatus} onChange={(value) => setVerificationStatus(value)} disabled={isClosedReport} options={[{ value: 'Pending Review', label: 'Pending Review' }, { value: 'Under Review', label: 'Under Review' }, { value: 'Verified', label: 'Verified' }, { value: 'Responded', label: 'Responded' }, { value: 'Solved', label: 'Solved' }, { value: 'Rejected', label: 'Rejected' }]} placeholder="Select status" />
                      </div>

                      {!showDiscrepancyReplyComposer && (
                        <div className="mt-4">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Resolution Notes</label>
                          <textarea
                            value={verificationNotes}
                            onChange={(event) => setVerificationNotes(event.target.value)}
                            rows="6"
                            disabled={isClosedReport || savingVerification}
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                            placeholder="Document the review findings, instructions to the branch, or final resolution notes."
                          ></textarea>
                        </div>
                      )}

                      {!showDiscrepancyReplyComposer && !isClosedReport && (
                        <div className="mt-4 flex flex-col gap-3">
                          <button
                            onClick={handleVerifyDiscrepancy}
                            disabled={savingVerification}
                            className="w-full rounded-2xl bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                          >
                            {savingVerification ? 'Saving...' : 'Save Administrative Update'}
                          </button>
                          <button
                            onClick={() => { setDiscrepancyReplyDraft(''); setShowDiscrepancyReplyComposer(true); }}
                            className="w-full rounded-2xl bg-green-600 py-3 font-semibold text-white transition hover:bg-green-700"
                          >
                            Send Reply to Branch
                          </button>
                        </div>
                      )}

                      {showDiscrepancyReplyComposer && !isClosedReport && (
                        <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Administrative Reply</label>
                          <textarea
                            value={discrepancyReplyDraft}
                            onChange={(event) => setDiscrepancyReplyDraft(event.target.value)}
                            rows="6"
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                            placeholder="Type the response that should appear in the discrepancy history."
                          ></textarea>
                          <div className="mt-4 flex gap-3">
                            <button
                              onClick={handleVerifyDiscrepancy}
                              disabled={savingVerification || !discrepancyReplyDraft.trim()}
                              className="flex-1 rounded-2xl bg-primary py-3 font-semibold text-white transition hover:bg-secondary disabled:opacity-50"
                            >
                              {savingVerification ? 'Saving...' : 'Send Reply'}
                            </button>
                            <button
                              onClick={() => { setDiscrepancyReplyDraft(''); setShowDiscrepancyReplyComposer(false); }}
                              disabled={savingVerification}
                              className="flex-1 rounded-2xl bg-gray-300 py-3 font-semibold text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {isClosedReport && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                          This discrepancy is closed because it is marked as {selectedDiscrepancy.status}. Main Admin replies and status updates are disabled.
                        </div>
                      )}
                    </DiscrepancySection>

                    <DiscrepancySection
                      title="Resolution Notes"
                      description="Current administrative resolution details and latest accountable reviewer."
                    >
                      <div className="space-y-4">
                        <DiscrepancyInfoCard
                          label="Last Reviewed By"
                          value={selectedDiscrepancy.verified_by || 'No administrator response yet'}
                          helper={selectedDiscrepancy.verified_by_role || 'Administrative response pending'}
                        />
                        <DiscrepancyInfoCard
                          label="Last Review Timestamp"
                          value={selectedDiscrepancy.verified_at ? formatDiscrepancyDateTime(selectedDiscrepancy.verified_at) : 'No review timestamp yet'}
                        />
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Current Notes</p>
                          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">
                            {selectedDiscrepancy.verification_notes || 'No administrative resolution notes have been saved yet.'}
                          </p>
                        </div>
                      </div>
                    </DiscrepancySection>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={closeVerifyModal}
                    className="rounded-2xl bg-slate-700 px-6 py-3 font-semibold text-white transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      <DeleteConfirmationModal
        open={Boolean(paymentToDelete)}
        title="Delete this pending payment?"
        message={`This will permanently remove pending payment ${paymentToDelete?.transaction_id || paymentToDelete?.ref_number || ''}.`}
        details={[
          { label: 'Reference', value: paymentToDelete?.ref_number || paymentToDelete?.transaction_id || 'N/A' },
          { label: 'Taxpayer', value: paymentToDelete?.taxpayer_name || 'N/A' },
        ]}
        onCancel={() => setPaymentToDelete(null)}
        onConfirm={() => handleDeletePendingPayment()}
        isLoading={Boolean(deletingPaymentId)}
      />
    </div>
  );
};

export default Dashboard;
