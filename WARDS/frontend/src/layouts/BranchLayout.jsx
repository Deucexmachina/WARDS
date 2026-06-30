import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import wardsLogo from '../assets/branding/wards_logo.png';
import qcLogo from '../assets/branding/qclogo_main.png';
import galasLogo from '../assets/branding/galas_logo.png';
import ActionConfirmationModal from '../components/ActionConfirmationModal';
import StaffMfaSetupModal from '../components/StaffMfaSetupModal';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import api from '../services/api';
import { branchAnnouncementAPI, discrepancyAPI } from '../services/api';
import { getBranchPortalPath } from '../utils/auth';
import { clearBranchSettingsSession } from '../utils/settingsSecurity';
import {
  BRANCH_REPORT_VIEWED_EVENT,
  BRANCH_REPORTS_UPDATED_EVENT,
  getUnreadBranchReportCount,
} from '../utils/branchReportViews';
import { formatUnreadCount, UNREAD_COUNT_BADGE_CLASS } from '../utils/notificationUI';

const BRANCH_QUEUE_UPDATED_EVENT = 'branch-queue-updated';
const BRANCH_RECEIPT_UPDATED_EVENT = 'branch-receipt-updated';

const BranchLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { branchSlug } = useParams();
  const [staff, setStaff] = useState(JSON.parse(localStorage.getItem('branchUser') || '{}'));
  const isSuperadminManagedBranch = Boolean(staff?.superadmin_managed_branch);
  const showMfaModal = !isSuperadminManagedBranch && Boolean(staff?.mfa_setup_required);
  const isQueueWindowAccount = staff?.account_scope === 'queue_window';
  const isBranchAdmin = !isSuperadminManagedBranch && (staff?.role === 'branch_admin' || staff?.internal_role === 'branch_admin');
  const rawAssignedServiceLabel = staff?.window_label || staff?.service_window_label || (staff?.service_window === 'BUSINESS' ? 'BT' : (staff?.service_window || ''));
  const assignedServiceLabel = rawAssignedServiceLabel.replace(/\s+Window$/i, '');
  const assignedPhysicalWindowLabel = staff?.assigned_window_number ? `Window ${staff.assigned_window_number}` : '';
  const assignedWindowLabel = [assignedPhysicalWindowLabel, assignedServiceLabel].filter(Boolean).join(' - ');
  const branchDisplayName = staff?.branch_name
    ? `${staff.branch_name} Branch`
    : branchSlug
      ? `${branchSlug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())} Branch`
      : 'Branch Portal';
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isDirty, saveRef, registerDirty } = useUnsavedChanges();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingPath, setPendingPath] = useState(null);
  const [isSavingNav, setIsSavingNav] = useState(false);
  const fetchAllBranchReports = async () => {
    const firstResponse = await api.get('/branch/reports', { params: { page: 1, page_size: 5 } });
    const firstPageData = firstResponse.data || {};
    const totalPages = Number(firstPageData.total_pages || 1);
    let items = [...(firstPageData.items || [])];

    if (totalPages > 1) {
      const remainingResponses = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          api.get('/branch/reports', { params: { page: index + 2, page_size: 5 } })
        )
      );
      remainingResponses.forEach((response) => {
        items = items.concat(response.data?.items || []);
      });
    }

    return items;
  };
  const getActiveQueueCount = (items) => (
    (items || []).filter((item) => {
      const normalizedStatus = (item?.status || '').toString().trim().toLowerCase();
      return !['completed', 'cancelled', 'canceled'].includes(normalizedStatus);
    }).length
  );
  const getActiveReceiptCount = (items) => (
    (items || []).filter((item) => {
      if (['Released', 'Completed'].includes(item.status)) return false;
      const paymentStatus = item.paymentStatus || (item.feePaid ? 'Pending Transaction' : 'Pending');
      return paymentStatus === 'Verified';
    }).length
  );
  const resolveUnreadCount = (event, currentCount) => {
    const explicitCount = event?.detail?.unreadCount;
    if (Number.isFinite(explicitCount)) {
      return Math.max(0, Number(explicitCount));
    }
    const delta = Number(event?.detail?.delta || 0);
    return Math.max(0, currentCount + delta);
  };
  const navItems = isQueueWindowAccount
    ? [
        { label: `${assignedWindowLabel || 'Queue Window'} Queue Management`, path: queueOnlyPath },
        { label: 'Account Management', path: `${basePath}/account-management` },
      ]
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
        ...((isBranchAdmin || isSuperadminManagedBranch)
          ? [
            { label: 'Activity Logs', path: `${basePath}/activity-logs` },
            { label: 'Kiosk Management', path: `${basePath}/kiosks` },
            { label: 'System Settings', path: `${basePath}/settings/login` },
            ...((isBranchAdmin || isSuperadminManagedBranch) ? [{ label: 'Account Management', path: `${basePath}/accounts` }] : []),
          ]
          : []),
      ];

  const accountManagementPath = `${basePath}/account-management`;
  if (
    isQueueWindowAccount
    && location.pathname !== queueOnlyPath
    && location.pathname !== accountManagementPath
    && !location.pathname.includes('/live-monitor')
  ) {
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
        const unreadResponse = await api.get('/branch/memos/unread-count');
        setUnreadMemoCount(Number(unreadResponse.data.unread_count || 0));
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
        const response = await branchAnnouncementAPI.getUnreadCount();
        setAnnouncementCount(Number(response.data?.unread_count || 0));
      } catch (error) {
        console.error('Failed to fetch branch announcement count:', error);
      }
    };

    const fetchQueueCount = async () => {
      try {
        const response = await api.get('/branch/queue');
        setQueueCount(getActiveQueueCount(response.data || []));
      } catch (error) {
        console.error('Failed to fetch branch queue count:', error);
      }
    };

    const fetchReceiptCount = async () => {
      try {
        const response = await api.get('/receipts/requests');
        const items = response.data || [];
        setReceiptCount(getActiveReceiptCount(items));
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
        const reports = await fetchAllBranchReports();
        setReportCount(getUnreadBranchReportCount(reports, staff));
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
    const handleMemoRead = (event) => {
      setUnreadMemoCount((current) => resolveUnreadCount(event, current));
      fetchUnreadMemoCount();
    };
    const handlePolicyRead = (event) => {
      setUnreadPolicyCount((current) => resolveUnreadCount(event, current));
      fetchUnreadPolicyCount();
    };
    const handlePolicyUpdated = () => fetchUnreadPolicyCount();
    const handleDiscrepancyViewed = () => fetchUnreadDiscrepancyCount();
    const handleAnnouncementViewed = (event) => {
      const explicitCount = event?.detail?.unreadCount;
      if (Number.isFinite(explicitCount)) {
        setAnnouncementCount(Math.max(0, Number(explicitCount)));
      }
      fetchAnnouncementCount();
    };
    const handleBranchPaymentUpdated = () => {
      fetchPaymentCount();
      fetchReceiptCount();
    };
    const handleBranchReportViewed = () => fetchReportCount();
    const handleBranchReportsUpdated = () => fetchReportCount();
    const handleBranchReceiptUpdated = (event) => {
      const eventRequests = event?.detail?.requests;
      if (Array.isArray(eventRequests)) {
        setReceiptCount(getActiveReceiptCount(eventRequests));
        return;
      }
      fetchReceiptCount();
    };
    const handleBranchQueueUpdated = (event) => {
      const eventQueues = event?.detail?.queues;
      if (Array.isArray(eventQueues)) {
        setQueueCount(getActiveQueueCount(eventQueues));
        return;
      }
      fetchQueueCount();
    };

    window.addEventListener('branch-memo-read', handleMemoRead);
    window.addEventListener('branch-policy-read', handlePolicyRead);
    window.addEventListener('branch-policy-updated', handlePolicyUpdated);
    window.addEventListener('branch-discrepancy-viewed', handleDiscrepancyViewed);
    window.addEventListener('branch-announcement-viewed', handleAnnouncementViewed);
    window.addEventListener('branch-payment-updated', handleBranchPaymentUpdated);
    window.addEventListener(BRANCH_REPORT_VIEWED_EVENT, handleBranchReportViewed);
    window.addEventListener(BRANCH_REPORTS_UPDATED_EVENT, handleBranchReportsUpdated);
    window.addEventListener(BRANCH_RECEIPT_UPDATED_EVENT, handleBranchReceiptUpdated);
    window.addEventListener(BRANCH_QUEUE_UPDATED_EVENT, handleBranchQueueUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('branch-memo-read', handleMemoRead);
      window.removeEventListener('branch-policy-read', handlePolicyRead);
      window.removeEventListener('branch-policy-updated', handlePolicyUpdated);
      window.removeEventListener('branch-discrepancy-viewed', handleDiscrepancyViewed);
      window.removeEventListener('branch-announcement-viewed', handleAnnouncementViewed);
      window.removeEventListener('branch-payment-updated', handleBranchPaymentUpdated);
      window.removeEventListener(BRANCH_REPORT_VIEWED_EVENT, handleBranchReportViewed);
      window.removeEventListener(BRANCH_REPORTS_UPDATED_EVENT, handleBranchReportsUpdated);
      window.removeEventListener(BRANCH_RECEIPT_UPDATED_EVENT, handleBranchReceiptUpdated);
      window.removeEventListener(BRANCH_QUEUE_UPDATED_EVENT, handleBranchQueueUpdated);
    };
  }, [isQueueWindowAccount]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleNavClick = (e, path) => {
    if (isDirty && path !== location.pathname) {
      e.preventDefault();
      setPendingPath(path);
      setShowUnsavedModal(true);
    }
  };

  const handleDiscardAndNavigate = () => {
    registerDirty(false, null);
    setShowUnsavedModal(false);
    if (pendingPath) {
      navigate(pendingPath);
      setPendingPath(null);
    }
  };

  const handleSaveAndNavigate = async () => {
    if (saveRef.current) {
      setIsSavingNav(true);
      try {
        await saveRef.current();
      } catch (err) {
        console.error('Save failed during navigation:', err);
        setIsSavingNav(false);
        return;
      }
      setIsSavingNav(false);
    }
    registerDirty(false, null);
    setShowUnsavedModal(false);
    if (pendingPath) {
      navigate(pendingPath);
      setPendingPath(null);
    }
  };

  const handleCancelUnsaved = () => {
    setShowUnsavedModal(false);
    setPendingPath(null);
    setIsSavingNav(false);
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    if (isSuperadminManagedBranch) {
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      clearBranchSettingsSession();
      localStorage.setItem('wardsPortal', 'admin');
      setShowLogoutConfirm(false);
      setIsLoggingOut(false);
      navigate('/admin', { replace: true });
      return;
    }

    try {
      await api.post('/auth/unified/logout');
    } catch (error) {
      console.error('Branch logout failed:', error);
    } finally {
      localStorage.removeItem('branchToken');
      localStorage.removeItem('branchUser');
      localStorage.removeItem('branchAuthenticatedAt');
      clearBranchSettingsSession();
      setShowLogoutConfirm(false);
      setIsLoggingOut(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar overlay for tablet */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed inset-y-0 left-0 w-64 bg-slate-900 text-white z-40 transition-transform duration-300 overflow-y-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
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
              {isQueueWindowAccount && assignedWindowLabel ? ` - ${assignedWindowLabel}` : ''}
            </p>
          </div>
        </div>
        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === basePath}
              onClick={(e) => { setSidebarOpen(false); handleNavClick(e, item.path); }}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg px-4 py-3 font-semibold transition ${
                  (isActive || (item.label === 'System Settings' && location.pathname.startsWith(`${basePath}/settings`)))
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span>{item.label}</span>
              {item.label === 'Internal Memos' && unreadMemoCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(unreadMemoCount)}
                </span>
              ) : item.label === 'Policies & SOPs' && unreadPolicyCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(unreadPolicyCount)}
                </span>
              ) : item.label === 'Discrepancy Reports' && unreadDiscrepancyCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(unreadDiscrepancyCount)}
                </span>
              ) : item.label === 'Announcements' && announcementCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(announcementCount)}
                </span>
              ) : (item.label.includes('Queue Management') || item.label === 'Window Staff Accounts') && queueCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(queueCount)}
                </span>
              ) : item.label === 'Receipt Management' && receiptCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(receiptCount)}
                </span>
              ) : item.label === 'Payment Management' && paymentCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(paymentCount)}
                </span>
              ) : item.label === 'Branch Reports' && reportCount > 0 ? (
                <span className={UNREAD_COUNT_BADGE_CLASS}>
                  {formatUnreadCount(reportCount)}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="lg:ml-64">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Hamburger for tablet */}
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="lg:hidden inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 transition"
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <p className="text-sm text-gray-500">Branch ID</p>
              <p className="font-semibold text-gray-800">{staff?.branch_id || 'Unassigned'}</p>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            disabled={isLoggingOut}
            className={`${isSuperadminManagedBranch ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-500 hover:bg-red-600'} text-white px-3 sm:px-4 py-2 rounded-lg font-semibold text-sm transition disabled:cursor-not-allowed disabled:opacity-70`}
          >
            <span className="hidden sm:inline">{isSuperadminManagedBranch ? 'Return to superadmin dashboard' : 'Logout'}</span>
            <span className="sm:hidden">{isSuperadminManagedBranch ? 'Return' : 'Logout'}</span>
          </button>
        </header>
        <main className="p-4 pb-20 sm:pb-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-around px-2 pb-safe">
          {navItems.slice(0, 5).map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === basePath}
                onClick={(e) => handleNavClick(e, item.path)}
                className={`flex flex-col items-center gap-0.5 py-2 px-1 text-[10px] font-medium transition ${isActive ? 'text-[#0f2f5f]' : 'text-slate-400'}`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${isActive ? 'bg-[#0f2f5f]/10' : ''}`}>
                  {item.label.includes('Dashboard') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                  )}
                  {item.label.includes('Queue') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  )}
                  {item.label.includes('Receipt') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  )}
                  {item.label.includes('Payment') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                  )}
                  {item.label.includes('Report') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  )}
                  {item.label.includes('Account') && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  )}
                  {!item.label.match(/Dashboard|Queue|Receipt|Payment|Report|Account/) && (
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  )}
                </span>
                <span className="max-w-[4.5rem] truncate">{item.label.replace(' Management', '').replace('Branch ', '')}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <StaffMfaSetupModal
        isOpen={showMfaModal}
        user={staff}
        portal="branch"
        onLogout={handleLogout}
        onSuccess={() => {
          const updated = { ...staff, mfa_setup_required: false };
          localStorage.setItem('branchUser', JSON.stringify(updated));
          setStaff(updated);
        }}
      />
      <ActionConfirmationModal
        open={showLogoutConfirm}
        title={isSuperadminManagedBranch ? 'Return to the super admin dashboard?' : 'Are you sure you want to logout?'}
        message={isSuperadminManagedBranch
          ? 'Your branch portal session will close and you will be returned to the super admin dashboard.'
          : 'Your branch session will only be terminated after you confirm this action.'}
        confirmLabel={isSuperadminManagedBranch ? 'Return to Dashboard' : 'Confirm Logout'}
        loadingLabel={isSuperadminManagedBranch ? 'Returning...' : 'Logging out...'}
        tone={isSuperadminManagedBranch ? 'primary' : 'danger'}
        isLoading={isLoggingOut}
        onCancel={() => {
          if (!isLoggingOut) {
            setShowLogoutConfirm(false);
          }
        }}
        onConfirm={handleLogout}
      />

      {showUnsavedModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.69-1.333-3.46 0L3.232 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Unsaved Changes</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">You have unsaved changes</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  If you leave this page without saving, your current changes will be lost. Would you like to save them before switching modules?
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCancelUnsaved}
                disabled={isSavingNav}
                className="rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDiscardAndNavigate}
                disabled={isSavingNav}
                className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                No
              </button>
              <button
                type="button"
                onClick={handleSaveAndNavigate}
                disabled={isSavingNav}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingNav ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchLayout;
