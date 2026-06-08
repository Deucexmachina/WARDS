import { useState, useEffect } from 'react';
import { alertAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';
import { formatUtc8DateTime } from '../../utils/dateTime';

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [pageState, setPageState] = useState({ page: 1, page_size: 10, total: 0, total_pages: 1 });
  const [jumpPage, setJumpPage] = useState('');
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isBranchAlertView = ['branch_admin', 'branch_staff'].includes(branchUser?.internal_role || branchUser?.role);

  const fetchAlerts = async (page = pageState.page) => {
      try {
      const safePage = Math.max(1, Number(page || 1));
      const response = await alertAPI.getAll({ page: safePage, page_size: 10 });
      const data = response.data || {};
      setAlerts(data.items || []);
      setPageState({
        page: data.page || safePage,
        page_size: data.page_size || 10,
        total: data.total || 0,
        total_pages: data.total_pages || 1,
      });
      } catch (error) {
        console.error('Error fetching alerts:', error);
      }
    };

  useEffect(() => {
    fetchAlerts(1);
  }, []);

  const handleMarkAsRead = async (id) => {
    try {
      await alertAPI.markAsRead(id);
      const nextAlerts = alerts.map(a => a.id === id ? { ...a, read: true } : a);
      setAlerts(nextAlerts);
      window.dispatchEvent(new CustomEvent('admin-alert-read', {
        detail: { unreadCount: nextAlerts.filter((alert) => !alert.read).length },
      }));
    } catch (error) {
      const nextAlerts = alerts.map(a => a.id === id ? { ...a, read: true } : a);
      setAlerts(nextAlerts);
      window.dispatchEvent(new CustomEvent('admin-alert-read', {
        detail: { unreadCount: nextAlerts.filter((alert) => !alert.read).length },
      }));
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await alertAPI.markAllAsRead();
      setAlerts((current) => current.map((alert) => ({ ...alert, read: true })));
      window.dispatchEvent(new CustomEvent('admin-alert-read', {
        detail: { unreadCount: 0 },
      }));
    } catch (error) {
      console.error('Error marking alerts as read:', error);
    }
  };

  const submitJump = (event) => {
    event.preventDefault();
    const totalPages = Math.max(1, Number(pageState.total_pages || 1));
    const page = Math.min(Math.max(1, Number(jumpPage || pageState.page || 1)), totalPages);
    setJumpPage('');
    fetchAlerts(page);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'security':
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>;
      case 'anomaly':
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>;
      default:
        return <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>;
    }
  };

  return (
    <div className="space-y-8">
      <WardsPageHero
        eyebrow={isBranchAlertView ? 'Branch Dashboard' : 'Main Admin Dashboard'}
        title="System Alerts"
        subtitle={isBranchAlertView ? 'Monitor branch operational alerts and system anomalies that need staff attention.' : 'Monitor security notices, anomaly flags, and platform warnings that need administrative attention.'}
      />

      {alerts.some((alert) => !alert.read) && (
        <div className="flex justify-end">
          <button
            onClick={handleMarkAllAsRead}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Mark all as Read
          </button>
        </div>
      )}

      <div className="space-y-4">
        {alerts.map((alert) => (
          <div 
            key={alert.id} 
            className={`bg-white rounded-xl shadow-lg p-6 border-l-4 ${getSeverityColor(alert.severity)} ${
              !alert.read ? 'border-l-4' : 'opacity-75'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4 flex-1">
                <div className={`p-3 rounded-full ${getSeverityColor(alert.severity)}`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {getAlertIcon(alert.type)}
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-primary">{alert.title}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-gray-600 mb-2">{alert.message}</p>
                  <p className="text-sm text-gray-500">{formatUtc8DateTime(alert.created_at)}</p>
                </div>
              </div>
              {!alert.read && (
                <button 
                  onClick={() => handleMarkAsRead(alert.id)}
                  className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition duration-300 text-sm"
                >
                  Mark as Read
                </button>
              )}
            </div>
          </div>
        ))}
        {!alerts.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No system alerts have been logged yet.
          </div>
        )}
      </div>
      {pageState.total > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-white px-6 py-5 shadow sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">Showing page {pageState.page} of {pageState.total_pages} ({pageState.total} alerts)</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form onSubmit={submitJump} className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-600">Jump to</label>
              <input
                type="number"
                min="1"
                max={Math.max(1, Number(pageState.total_pages || 1))}
                value={jumpPage}
                onChange={(event) => setJumpPage(event.target.value)}
                placeholder={String(pageState.page || 1)}
                className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">Go</button>
            </form>
            <button onClick={() => fetchAlerts(pageState.page - 1)} disabled={pageState.page <= 1} className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60">Previous</button>
            <button onClick={() => fetchAlerts(pageState.page + 1)} disabled={pageState.page >= pageState.total_pages} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Alerts;
