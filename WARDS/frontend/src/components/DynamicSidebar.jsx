import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { announcementAPI, branchAnnouncementAPI, discrepancyAPI } from '../services/api';

const BRANCH_QUEUE_UPDATED_EVENT = 'branch-queue-updated';
const BRANCH_RECEIPT_UPDATED_EVENT = 'branch-receipt-updated';

const DynamicSidebar = () => {
  const location = useLocation();
  const [modules, setModules] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [unreadMemoCount, setUnreadMemoCount] = useState(0);
  const [unreadPolicyCount, setUnreadPolicyCount] = useState(0);
  const [unreadDiscrepancyCount, setUnreadDiscrepancyCount] = useState(0);
  const [moduleCounts, setModuleCounts] = useState({
    announcements: 0,
    alerts: 0,
    receipts: 0,
    payments: 0,
    queue: 0,
    reports: 0,
    accounts: 0,
    backup: 0,
    logs: 0,
  });

  const getActiveQueueBadgeCount = (items) => (
    (items || []).filter((item) => {
      const normalizedStatus = (item?.status || '').toString().trim().toLowerCase();
      return !['completed', 'cancelled', 'canceled'].includes(normalizedStatus);
    }).length
  );
  const getActiveReceiptBadgeCount = (items) => (
    (items || []).filter((item) => !['Released', 'Completed'].includes(item.status)).length
  );

  useEffect(() => {
    fetchSidebarModules();
    fetchUnreadMemoCount();
    fetchUnreadPolicyCount();
    fetchUnreadDiscrepancyCount();
    fetchSidebarModuleCounts();
    
    const interval = setInterval(() => {
      fetchUnreadMemoCount();
      fetchUnreadPolicyCount();
      fetchUnreadDiscrepancyCount();
      fetchSidebarModuleCounts();
    }, 60000);
    const handleAdminMemoRead = () => fetchUnreadMemoCount();
    const handleAdminPolicyRead = () => fetchUnreadPolicyCount();
    const handleAdminPolicyUpdated = () => fetchUnreadPolicyCount();
    const handleBranchDiscrepancyViewed = () => fetchUnreadDiscrepancyCount();
    const handleAdminDiscrepancyReviewed = () => fetchUnreadDiscrepancyCount();
    const handleAdminDiscrepancyViewed = () => fetchUnreadDiscrepancyCount();
    const handleAnnouncementViewed = () => fetchSidebarModuleCounts();
    const handleBranchPaymentUpdated = () => fetchSidebarModuleCounts();
    const handleBranchReceiptUpdated = (event) => {
      const eventRequests = event?.detail?.requests;
      if (!Array.isArray(eventRequests)) {
        fetchSidebarModuleCounts();
        return;
      }
      setModuleCounts((current) => ({
        ...current,
        receipts: getActiveReceiptBadgeCount(eventRequests),
      }));
    };
    const handleBranchQueueUpdated = (event) => {
      const eventQueues = event?.detail?.queues;
      if (!Array.isArray(eventQueues)) {
        fetchSidebarModuleCounts();
        return;
      }
      setModuleCounts((current) => ({
        ...current,
        queue: getActiveQueueBadgeCount(eventQueues),
      }));
    };
    window.addEventListener('admin-memo-read', handleAdminMemoRead);
    window.addEventListener('admin-policy-read', handleAdminPolicyRead);
    window.addEventListener('admin-policy-updated', handleAdminPolicyUpdated);
    window.addEventListener('branch-discrepancy-viewed', handleBranchDiscrepancyViewed);
    window.addEventListener('admin-discrepancy-reviewed', handleAdminDiscrepancyReviewed);
    window.addEventListener('admin-discrepancy-viewed', handleAdminDiscrepancyViewed);
    window.addEventListener('admin-announcement-viewed', handleAnnouncementViewed);
    window.addEventListener('branch-announcement-viewed', handleAnnouncementViewed);
    window.addEventListener('branch-payment-updated', handleBranchPaymentUpdated);
    window.addEventListener(BRANCH_RECEIPT_UPDATED_EVENT, handleBranchReceiptUpdated);
    window.addEventListener(BRANCH_QUEUE_UPDATED_EVENT, handleBranchQueueUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('admin-memo-read', handleAdminMemoRead);
      window.removeEventListener('admin-policy-read', handleAdminPolicyRead);
      window.removeEventListener('admin-policy-updated', handleAdminPolicyUpdated);
      window.removeEventListener('branch-discrepancy-viewed', handleBranchDiscrepancyViewed);
      window.removeEventListener('admin-discrepancy-reviewed', handleAdminDiscrepancyReviewed);
      window.removeEventListener('admin-discrepancy-viewed', handleAdminDiscrepancyViewed);
      window.removeEventListener('admin-announcement-viewed', handleAnnouncementViewed);
      window.removeEventListener('branch-announcement-viewed', handleAnnouncementViewed);
      window.removeEventListener('branch-payment-updated', handleBranchPaymentUpdated);
      window.removeEventListener(BRANCH_RECEIPT_UPDATED_EVENT, handleBranchReceiptUpdated);
      window.removeEventListener(BRANCH_QUEUE_UPDATED_EVENT, handleBranchQueueUpdated);
    };
  }, []);

  const fetchUnreadMemoCount = async () => {
    try {
      const storedRole = getStoredRole();
      if (storedRole === 'branch_admin' || storedRole === 'branch_staff') {
        const unreadResponse = await api.get('/branch/memos/unread-count');
        setUnreadMemoCount(Number(unreadResponse.data.unread_count || 0));
      } else if (storedRole === 'main_admin' || storedRole === 'superadmin') {
        const response = await api.get('/memos/unread-count');
        setUnreadMemoCount(response.data.unread_count || 0);
      }
    } catch (error) {
      console.error('Failed to fetch unread memo count:', error);
    }
  };

  const fetchUnreadPolicyCount = async () => {
    try {
      const storedRole = getStoredRole();
      if (storedRole === 'main_admin' || storedRole === 'superadmin') {
        const response = await api.get('/policies/unread-count');
        setUnreadPolicyCount(response.data.unread_count || 0);
      }
    } catch (error) {
      console.error('Failed to fetch unread policy count:', error);
    }
  };

  const fetchUnreadDiscrepancyCount = async () => {
    try {
      const storedRole = getStoredRole();
      if (storedRole === 'branch_admin' || storedRole === 'branch_staff') {
        const response = await discrepancyAPI.getBranchUnreadCount();
        setUnreadDiscrepancyCount(response.data.unread_count || 0);
      } else if (storedRole === 'main_admin' || storedRole === 'superadmin') {
        const response = await discrepancyAPI.getAdminUnreadCount();
        setUnreadDiscrepancyCount(response.data.unread_count || 0);
      }
    } catch (error) {
      console.error('Failed to fetch unread discrepancy count:', error);
    }
  };

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

  const fetchSidebarModuleCounts = async () => {
    try {
      const storedRole = getStoredRole();

      if (storedRole === 'main_admin' || storedRole === 'superadmin') {
        const [
          announcementsResult,
          alertsResult,
          reportsResult,
          accountsResult,
          backupResult,
          logsResult,
        ] = await Promise.allSettled([
          announcementAPI.getUnreadCount(),
          api.get('/alerts'),
          api.get('/reports', { params: { page: 1, page_size: 1 } }),
          api.get('/accounts', { params: { page: 1, page_size: 1 } }),
          api.get('/security/dashboard'),
          api.get('/activity-logs'),
        ]);

        setModuleCounts({
          announcements: announcementsResult.status === 'fulfilled' ? Number(announcementsResult.value.data?.unread_count || 0) : 0,
          alerts: alertsResult.status === 'fulfilled' ? (alertsResult.value.data || []).length : 0,
          receipts: 0,
          payments: 0,
          queue: 0,
          reports: reportsResult.status === 'fulfilled' ? Number(reportsResult.value.data?.total || 0) : 0,
          accounts: accountsResult.status === 'fulfilled' ? Number(accountsResult.value.data?.total || 0) : 0,
          backup: backupResult.status === 'fulfilled' ? Number(backupResult.value.data?.active_incidents || 0) : 0,
          logs: logsResult.status === 'fulfilled' ? (logsResult.value.data || []).length : 0,
        });
        return;
      }

      if (storedRole === 'branch_admin' || storedRole === 'branch_staff') {
        const [
          announcementsResult,
          queueResult,
          receiptsResult,
          paymentsResult,
          reportsResult,
        ] = await Promise.allSettled([
          branchAnnouncementAPI.getUnreadCount(),
          api.get('/branch/queue'),
          api.get('/receipts/requests'),
          api.get('/branch/payments'),
          api.get('/branch/reports', { params: { page: 1, page_size: 1 } }),
        ]);

        const queueItems = queueResult.status === 'fulfilled' ? (queueResult.value.data || []) : [];
        const receiptItems = receiptsResult.status === 'fulfilled' ? (receiptsResult.value.data || []) : [];
        const paymentItems = paymentsResult.status === 'fulfilled' ? (paymentsResult.value.data || []) : [];

        setModuleCounts({
          announcements: announcementsResult.status === 'fulfilled' ? Number(announcementsResult.value.data?.unread_count || 0) : 0,
          alerts: 0,
          receipts: getActiveReceiptBadgeCount(receiptItems),
          payments: paymentItems.filter((item) => normalizePaymentStatus(item.status) === 'pending').length,
          queue: getActiveQueueBadgeCount(queueItems),
          reports: reportsResult.status === 'fulfilled' ? Number(reportsResult.value.data?.total || 0) : 0,
          accounts: 0,
          backup: 0,
          logs: 0,
        });
        return;
      }
    } catch (error) {
      console.error('Failed to fetch sidebar module counts:', error);
    }
  };

  const getStoredRole = () => {
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    if (adminUser?.internal_role) {
      return adminUser.internal_role;
    }
    if (adminUser?.role === 'admin') {
      return 'main_admin';
    }

    const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
    if (branchUser?.internal_role) {
      return branchUser.internal_role;
    }
    if (branchUser?.role === 'branch') {
      return 'branch_staff';
    }

    const publicUser = JSON.parse(localStorage.getItem('user') || '{}');
    return publicUser.role || '';
  };

  const fetchSidebarModules = async () => {
    const storedRole = getStoredRole();

    try {
      const response = await api.get('/rbac/sidebar-modules');
      const resolvedRole = response.data.role === 'admin'
        ? (JSON.parse(localStorage.getItem('adminUser') || '{}').internal_role || 'main_admin')
        : response.data.role;

      setModules(response.data.modules?.length ? response.data.modules : getDefaultModules(resolvedRole));
      setUserRole(resolvedRole);
    } catch (error) {
      console.error('Failed to fetch sidebar modules:', error);
      setUserRole(storedRole);
      setModules(getDefaultModules(storedRole));
    }
  };

  const getDefaultModules = (role) => {
    if (role === 'main_admin' || role === 'superadmin') {
      return [
        { name: 'Dashboard', path: '/admin', icon: 'dashboard' },
        { name: 'Manage Branches', path: '/admin/branches', icon: 'branches' },
        { name: 'Tax Assessment', path: '/admin/tax-assessment', icon: 'assessment' },
        { name: 'Branch Reports', path: '/admin/reports', icon: 'reports' },
        { name: 'Announcements', path: '/admin/announcements', icon: 'announcements' },
        { name: 'Internal Memos', path: '/admin/memos', icon: 'memos' },
        { name: 'Discrepancy Reports', path: '/admin/discrepancies', icon: 'discrepancies' },
        { name: 'System Alerts', path: '/admin/alerts', icon: 'alerts' },
        { name: 'Activity Logs', path: '/admin/activity-logs', icon: 'logs' },
        { name: 'Backup & Recovery', path: '/admin/backup/login', icon: 'backup' },
        { name: 'Policies & SOPs', path: '/admin/policies', icon: 'policies' },
        { name: 'System Settings', path: '/admin/settings', icon: 'settings' },
        { name: 'Account Management', path: '/admin/accounts', icon: 'accounts' }
      ];
    } else if (role === 'branch_admin') {
      return [
        { name: 'Branch Dashboard', path: '/branch', icon: 'dashboard' },
        { name: 'Queue Management', path: '/branch/queue', icon: 'queue' },
        { name: 'Receipt Management', path: '/branch/receipts', icon: 'receipts' },
        { name: 'Payment Management', path: '/branch/payments', icon: 'payments' },
        { name: 'Branch Reports', path: '/branch/reports', icon: 'reports' },
        { name: 'Internal Memos', path: '/branch/memos', icon: 'memos' },
        { name: 'Announcements', path: '/branch/announcements', icon: 'announcements' },
        { name: 'Discrepancy Reports', path: '/branch/discrepancies', icon: 'discrepancies' },
        { name: 'Policies & SOPs', path: '/branch/policies', icon: 'policies' }
      ];
    } else if (role === 'branch_staff') {
      return [
        { name: 'Branch Operations', path: '/branch', icon: 'operations' },
        { name: 'Branch Reports', path: '/branch/reports', icon: 'reports' },
        { name: 'Internal Memos', path: '/branch/memos', icon: 'memos' },
        { name: 'Discrepancy Reports', path: '/branch/discrepancies', icon: 'discrepancies' },
        { name: 'Policies & SOPs', path: '/branch/policies', icon: 'policies' },
        { name: 'Announcements', path: '/branch/announcements', icon: 'announcements' }
      ];
    }
    return [];
  };

  const getIcon = (iconName) => {
    const icons = {
      dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
      branches: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      reports: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      announcements: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
      memos: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      alerts: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
      logs: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      backup: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
      policies: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
      settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
      assessment: 'M9 2a1 1 0 00-1 1v2H6a2 2 0 00-2 2v11a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2V3a1 1 0 10-2 0v2h-4V3a1 1 0 00-1-1zm-3 8h12v8H6v-8zm2 2a1 1 0 000 2h3a1 1 0 100-2H8zm0 3a1 1 0 100 2h6a1 1 0 100-2H8z',
      accounts: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      operations: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
      queue: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      receipts: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      payments: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
      discrepancies: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
    };
    return icons[iconName] || icons.dashboard;
  };

  const getRoleBadge = () => {
    const badges = {
      main_admin: { text: 'Main Admin', color: 'bg-purple-500' },
      superadmin: { text: 'Superadmin', color: 'bg-fuchsia-600' },
      branch_admin: { text: 'Branch Admin', color: 'bg-blue-500' },
      branch_staff: { text: 'Staff', color: 'bg-green-500' }
    };
    return badges[userRole] || { text: 'User', color: 'bg-gray-500' };
  };

  const badge = getRoleBadge();

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-72 bg-white shadow-lg overflow-y-auto">
      <div className="p-4 border-b">
        <span className={`${badge.color} text-white text-xs px-3 py-1 rounded-full font-semibold`}>
          {badge.text}
        </span>
      </div>
      <nav className="p-3">
        {modules.map((module, index) => {
          const isActive = location.pathname === module.path;
          const isMemoModule = module.icon === 'memos';
          const isPolicyModule = module.icon === 'policies';
          const isDiscrepancyModule = module.icon === 'discrepancies';
          const isAnnouncementModule = module.icon === 'announcements';
          const isAlertModule = module.icon === 'alerts';
          const isReceiptModule = module.icon === 'receipts';
          const isPaymentModule = module.icon === 'payments';
          const isQueueModule = module.icon === 'queue';
          const isReportModule = module.icon === 'reports';
          const isAccountsModule = module.icon === 'accounts';
          const isBackupModule = module.icon === 'backup';
          const isLogsModule = module.icon === 'logs';
          const showMemoBadge = isMemoModule && unreadMemoCount > 0;
          const showPolicyBadge = isPolicyModule && unreadPolicyCount > 0;
          const showDiscrepancyBadge = isDiscrepancyModule && unreadDiscrepancyCount > 0;
          const genericBadgeCount = isAnnouncementModule
            ? moduleCounts.announcements
            : isAlertModule
              ? moduleCounts.alerts
              : isReceiptModule
                ? moduleCounts.receipts
                : isPaymentModule
                  ? moduleCounts.payments
                  : isQueueModule
                    ? moduleCounts.queue
                    : isReportModule
                      ? moduleCounts.reports
                      : isAccountsModule
                        ? moduleCounts.accounts
                        : isBackupModule
                          ? moduleCounts.backup
                          : isLogsModule
                            ? moduleCounts.logs
                            : 0;
          const disableGenericBadge = isAccountsModule || isLogsModule;
          const showGenericBadge =
            !disableGenericBadge &&
            !showMemoBadge &&
            !showPolicyBadge &&
            !showDiscrepancyBadge &&
            genericBadgeCount > 0;
          
          return (
            <Link
              key={index}
              to={module.path}
              className={`flex items-center justify-between space-x-3 px-4 py-3 rounded-lg mb-2 transition duration-300 ${
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center space-x-3">
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIcon(module.icon)}></path>
                </svg>
                <span className="text-sm font-medium leading-5">{module.name}</span>
              </div>
              {showMemoBadge && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadMemoCount > 99 ? '99+' : unreadMemoCount}
                </span>
              )}
              {showPolicyBadge && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadPolicyCount > 99 ? '99+' : unreadPolicyCount}
                </span>
              )}
              {showDiscrepancyBadge && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {unreadDiscrepancyCount > 99 ? '99+' : unreadDiscrepancyCount}
                </span>
              )}
              {showGenericBadge && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[1.5rem] text-center">
                  {genericBadgeCount > 99 ? '99+' : genericBadgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default DynamicSidebar;
