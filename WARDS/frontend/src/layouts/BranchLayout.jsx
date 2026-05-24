import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import wardsLogo from '../assets/branding/wards_logo.png';
import qcLogo from '../assets/branding/qclogo_main.png';
import galasLogo from '../assets/branding/galas_logo.png';
import api from '../services/api';
import { discrepancyAPI } from '../services/api';
import { getBranchPortalPath } from '../utils/auth';

const BranchLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { branchSlug } = useParams();
  const staff = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isSuperadminManagedBranch = Boolean(staff?.superadmin_managed_branch);
  const isQueueWindowAccount = staff?.account_scope === 'queue_window';
  const isBranchAdmin = !isSuperadminManagedBranch && (staff?.role === 'branch_admin' || staff?.internal_role === 'branch_admin');
  const assignedWindowLabel = staff?.service_window === 'BUSINESS' ? 'BT' : (staff?.service_window || '');
  const branchDisplayName = branchSlug
    ? `${branchSlug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())} Branch`
    : 'Galas Branch';
  const basePath = branchSlug ? `/branch-dashboard/${branchSlug}` : getBranchPortalPath(staff);
  const queueOnlyPath = `${basePath}/queue`;
  const [unreadMemoCount, setUnreadMemoCount] = useState(0);
  const [unreadPolicyCount, setUnreadPolicyCount] = useState(0);
  const [unreadDiscrepancyCount, setUnreadDiscrepancyCount] = useState(0);
  const [announcementCount, setAnnouncementCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [receiptCount, setReceiptCount] = useState(0);
  const [paymentCount, setPaymentCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const navItems = isQueueWindowAccount
    ? [{ label: `${assignedWindowLabel || 'Queue'} Window Queue Management`, path: queueOnlyPath }]
    : [
        { label: 'Dashboard', path: basePath },
        { label: 'Queue Management', path: `${basePath}/queue` },
        { label: 'Receipt Management', path: `${basePath}/receipts` },
        { label: 'Payment Management', path: `${basePath}/payments` },
        { label: 'Branch Reports', path: `${basePath}/reports` },
        { label: 'Internal Memos', path: `${basePath}/memos` },
        { label: 'Announcements', path: `${basePath}/announcements` },
        { label: 'Discrepancy Reports', path: `${basePath}/discrepancies` },
        { label: 'Policies & SOPs', path: `${basePath}/policies` },
        ...(isBranchAdmin || isSuperadminManagedBranch
          ? [{ label: 'System Settings', path: `${basePath}/settings` }]
          : []),
      ];

  if (isQueueWindowAccount && location.pathname !== queueOnlyPath && !location.pathname.includes('/live-monitor')) {
    return <Navigate to={queueOnlyPath} replace />;
  }

  useEffect(() => {
    const normalizePaymentStatus = (status) => {
      const normalized = (status || '').toString().trim().toLowerCase();
      if (['confirmed', 'verified', 'paid', 'succeeded', 'successful', 'success', 'released', 'completed'].includes(normalized)) {
        return 'confirmed';
      }
      if (['failed', 'declined', 'cancelled', 'canceled', 'expired'].includes(normalized)) {
        return 'failed';
      }
      return 'pending';
    };

    const fetchUnreadMemoCount = async () => {
      try {
        const [unreadResponse, memosResponse] = await Promise.all([
          api.get('/branch/memos/unread-count'),
          api.get('/branch/memos'),
        ]);
        const unreadCount = Number(unreadResponse.data.unread_count || 0);
        const totalMemoCount = Array.isArray(memosResponse.data) ? memosResponse.data.length : 0;
        setUnreadMemoCount(Math.max(unreadCount, totalMemoCount));
      } catch (error) {
        console.error('Failed to fetch branch unread memo count:', error);
      }
    };

    const fetchUnreadPolicyCount = async () => {
      try {
        const response = await api.get('/branch/policies/unread-count');
        setUnreadPolicyCount(response.data.unread_count || 0);
      } catch (error) {
        console.error('Failed to fetch branch unread policy count:', error);
      }
    };

    const fetchUnreadDiscrepancyCount = async () => {
      try {
        const response = await discrepancyAPI.getBranchUnreadCount();
        setUnreadDiscrepancyCount(response.data.unread_count || 0);
      } catch (error) {
        console.error('Failed to fetch branch unread discrepancy count:', error);
      }
    };

    const fetchAnnouncementCount = async () => {
      try {
        const response = await api.get('/branch/announcements');
        setAnnouncementCount((response.data || []).length);
      } catch (error) {
        console.error('Failed to fetch branch announcement count:', error);
      }
    };

    const fetchQueueCount = async () => {
      try {
        const response = await api.get('/branch/queue');
        const items = response.data || [];
        setQueueCount(items.filter((item) => !['Completed', 'Cancelled'].includes(item.status)).length);
      } catch (error) {
        console.error('Failed to fetch branch queue count:', error);
      }
    };

    const fetchReceiptCount = async () => {
      try {
        const response = await api.get('/receipts/requests');
        const items = response.data || [];
        setReceiptCount(items.filter((item) => !['Released', 'Completed'].includes(item.status)).length);
      } catch (error) {
        console.error('Failed to fetch branch receipt count:', error);
      }
    };

    const fetchPaymentCount = async () => {
      try {
        const response = await api.get('/branch/payments');
        const items = response.data || [];
        setPaymentCount(items.filter((item) => normalizePaymentStatus(item.status) === 'pending').length);
      } catch (error) {
        console.error('Failed to fetch branch payment count:', error);
      }
    };

    const fetchReportCount = async () => {
      try {
        const response = await api.get('/branch/reports', { params: { page: 1, page_size: 1 } });
        setReportCount(Number(response.data?.total || 0));
      } catch (error) {
        console.error('Failed to fetch branch report count:', error);
      }
    };

    fetchQueueCount();
    if (!isQueueWindowAccount) {
      fetchUnreadMemoCount();
      fetchUnreadPolicyCount();
      fetchUnreadDiscrepancyCount();
      fetchAnnouncementCount();
      fetchReceiptCount();
      fetchPaymentCount();
      fetchReportCount();
    }

    const interval = setInterval(() => {
      fetchQueueCount();
      if (!isQueueWindowAccount) {
        fetchUnreadMemoCount();
        fetchUnreadPolicyCount();
        fetchUnreadDiscrepancyCount();
        fetchAnnouncementCount();
        fetchReceiptCount();
        fetchPaymentCount();
        fetchReportCount();
      }
    }, 60000);
    const handleMemoRead = () => fetchUnreadMemoCount();
    const handlePolicyRead = () => fetchUnreadPolicyCount();
    const handlePolicyUpdated = () => fetchUnreadPolicyCount();
    const handleDiscrepancyViewed = () => fetchUnreadDiscrepancyCount();

    window.addEventListener('branch-memo-read', handleMemoRead);
    window.addEventListener('branch-policy-read', handlePolicyRead);
    window.addEventListener('branch-policy-updated', handlePolicyUpdated);
    window.addEventListener('branch-discrepancy-viewed', handleDiscrepancyViewed);

    return () => {
      clearInterval(interval);
      window.removeEventListener('branch-memo-read', handleMemoRead);
      window.removeEventListener('branch-policy-read', handlePolicyRead);
      window.removeEventListener('branch-policy-updated', handlePolicyUpdated);
      window.removeEventListener('branch-discrepancy-viewed', handleDiscrepancyViewed);
    };
  }, [isQueueWindowAccount]);

  const handleLogout = async () => {
    if (isSuperadminManagedBranch) {
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      navigate('/admin', { replace: true });
      return;
    }

    try {
      await api.post('/branch/auth/logout');
    } catch (error) {
      console.error('Branch logout failed:', error);
    } finally {
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed inset-y-0 left-0 w-64 bg-slate-900 text-white">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-transparent ring-1 ring-white/10">
              <img src={wardsLogo} alt="WARDS official logo" className="h-full w-full object-contain p-1" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-transparent ring-1 ring-white/10">
              <img src={qcLogo} alt="Quezon City official logo" className="h-full w-full object-contain p-1.5" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-transparent ring-1 ring-white/10">
              <img src={galasLogo} alt="Galas Branch official logo" className="h-full w-full object-contain p-1" />
            </div>
          </div>
          <div className="mt-2 text-center">
            <h1 className="truncate text-sm font-bold text-white">{branchDisplayName}</h1>
            <p className="truncate text-xs text-slate-300">
              {isSuperadminManagedBranch ? 'superadmin' : (staff?.full_name || staff?.username || 'Branch User')}
              {isQueueWindowAccount && assignedWindowLabel ? ` • ${assignedWindowLabel} Window` : ''}
            </p>
          </div>
        </div>
        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === basePath}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg px-4 py-3 font-semibold transition ${
                  isActive ? 'bg-purple-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span>{item.label}</span>
              {item.label === 'Internal Memos' && unreadMemoCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadMemoCount > 99 ? '99+' : unreadMemoCount}
                </span>
              ) : item.label === 'Policies & SOPs' && unreadPolicyCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadPolicyCount > 99 ? '99+' : unreadPolicyCount}
                </span>
              ) : item.label === 'Discrepancy Reports' && unreadDiscrepancyCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadDiscrepancyCount > 99 ? '99+' : unreadDiscrepancyCount}
                </span>
              ) : item.label === 'Announcements' && announcementCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {announcementCount > 99 ? '99+' : announcementCount}
                </span>
              ) : (item.label.includes('Queue Management') || item.label === 'Window Staff Accounts') && queueCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              ) : item.label === 'Receipt Management' && receiptCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {receiptCount > 99 ? '99+' : receiptCount}
                </span>
              ) : item.label === 'Payment Management' && paymentCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {paymentCount > 99 ? '99+' : paymentCount}
                </span>
              ) : item.label === 'Branch Reports' && reportCount > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {reportCount > 99 ? '99+' : reportCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="ml-64">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
          <div>
            <p className="text-sm text-gray-500">Branch ID</p>
            <p className="font-semibold text-gray-800">{staff?.branch_id || 'Unassigned'}</p>
          </div>
          <button
            onClick={handleLogout}
            className={`${isSuperadminManagedBranch ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-500 hover:bg-red-600'} text-white px-4 py-2 rounded-lg font-semibold transition`}
          >
            {isSuperadminManagedBranch ? 'Return to superadmin dashboard' : 'Logout'}
          </button>
        </header>
        <main className="p-8">
          {staff?.mfa_setup_required && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
              <p className="font-semibold">MFA reminder</p>
              <p className="text-sm">
                Your branch account signed in without MFA setup. Please set up Microsoft Authenticator soon so future logins stay protected.
              </p>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default BranchLayout;
