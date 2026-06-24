import { useEffect, useState } from 'react';
import { activityLogAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { markActivityLogsViewed } from '../../utils/activityLogNotifications';
import { CustomDatePicker } from '../../components/FormControls';

const typeColors = {
  admin: 'bg-purple-100 text-purple-800',
  security: 'bg-red-100 text-red-800',
  transaction: 'bg-green-100 text-green-800',
  auth: 'bg-blue-100 text-blue-800',
  user_auth: 'bg-blue-100 text-blue-800',
  branch_auth: 'bg-orange-100 text-orange-800',
  admin_auth: 'bg-indigo-100 text-indigo-800',
  branch_portal: 'bg-cyan-100 text-cyan-800',
  public_content: 'bg-amber-100 text-amber-800',
  error: 'bg-rose-100 text-rose-800',
};

const formatTimestamp = (value) =>
  formatUtc8DateTime(value, 'en-US', {
    second: undefined,
  });

const ActivityLogs = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const [logs, setLogs] = useState([]);
  const [pageState, setPageState] = useState({ page: 1, page_size: 10, total: 0, total_pages: 1 });
  const [jumpPage, setJumpPage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [filters, setFilters] = useState({
    type: '',
    dateFrom: '',
    dateTo: '',
    user: '',
  });

  const fetchLogs = async (nextPage = pageState.page || 1) => {
    const safePage = Math.max(1, Number(nextPage || 1));
    try {
      setLoading(true);
      setError('');
      const response = await activityLogAPI.getAll({ ...filters, page: safePage, page_size: 10 });
      const data = response.data || {};
      setLogs(data.items || []);
      setPageState({
        page: data.page || safePage,
        page_size: data.page_size || 10,
        total: data.total || 0,
        total_pages: data.total_pages || 1,
      });
    } catch (fetchError) {
      console.error('Failed to load activity logs:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load activity logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    markActivityLogsViewed();
    fetchLogs();
  }, []);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleApplyFilters = () => {
    fetchLogs(1);
  };

  const submitJump = (event) => {
    event.preventDefault();
    const totalPages = Math.max(1, Number(pageState.total_pages || 1));
    const page = Math.min(Math.max(1, Number(jumpPage || pageState.page || 1)), totalPages);
    setJumpPage('');
    fetchLogs(page);
  };

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow={adminUser?.internal_role === 'superadmin' || adminUser?.role === 'superadmin' ? 'Superadmin Dashboard' : 'Main Admin Dashboard'}
        title="Activity Logs"
        subtitle="Review administrative, security, branch, and transaction activity across the system."
      />

      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-xl font-bold text-primary mb-4">Filter Logs</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Activity Type</label>
            <input
              type="text"
              name="type"
              value={filters.type}
              onChange={handleFilterChange}
              placeholder="admin, security, transaction"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold mb-2">User</label>
            <input
              type="text"
              name="user"
              value={filters.user}
              onChange={handleFilterChange}
              placeholder="Filter by user"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Date From</label>
            <CustomDatePicker
              name="dateFrom"
              value={filters.dateFrom}
              onChange={handleFilterChange}
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Date To</label>
            <CustomDatePicker
              name="dateTo"
              value={filters.dateTo}
              onChange={handleFilterChange}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleApplyFilters}
              className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-white transition hover:bg-secondary"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white overflow-hidden shadow">
        <div className="bg-primary px-6 py-4">
          <h2 className="text-xl font-bold text-white">Activity Log Entries</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-600">Loading activity logs...</div>
        ) : error ? (
          <div className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : logs.length ? (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full table-auto text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {['Log Title', 'Activity Type', 'Branch', 'Email/User', 'Role', 'IP', 'Action', 'Date'].map((heading) => (
                      <th key={heading} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {logs.map((log) => (
                    <tr key={log.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedLog(log)}>
                      <td className="max-w-xs px-4 py-3 font-bold text-primary">
                        <div>{log.title || log.action}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${typeColors[log.type] || 'bg-gray-100 text-gray-800'}`}>
                          {log.type || 'general'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{log.branch || 'System-wide'}</td>
                      <td className="px-4 py-3 text-slate-700">{log.email || log.user || 'Unknown'}</td>
                      <td className="px-4 py-3 capitalize text-slate-700">{String(log.role || 'not recorded').replaceAll('_', ' ')}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{log.ip || 'not recorded'}</td>
                      <td className="px-4 py-3 text-slate-700">{log.action}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTimestamp(log.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Showing page {pageState.page} of {pageState.total_pages} ({pageState.total} logs)
              </p>
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
                <button
                  onClick={() => fetchLogs(pageState.page - 1)}
                  disabled={pageState.page <= 1}
                  className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Previous
                </button>
                <button
                  onClick={() => fetchLogs(pageState.page + 1)}
                  disabled={pageState.page >= pageState.total_pages}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-10 text-center text-gray-500">No activity logs matched the current filters.</div>
        )}
      </section>

      {/* Activity Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${typeColors[selectedLog.type] || 'bg-gray-100 text-gray-800'}`}>
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Activity Log Details</p>
                <h2 id="log-modal-title" className="mt-2 text-2xl font-bold text-slate-900">{selectedLog.title || selectedLog.action}</h2>
                <p className="mt-1 text-sm text-slate-500">Log ID #{selectedLog.id}</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Activity Type</p>
                  <span className={`mt-1 inline-block rounded px-2 py-1 text-xs font-semibold ${typeColors[selectedLog.type] || 'bg-gray-100 text-gray-800'}`}>
                    {selectedLog.type || 'general'}
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Action</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{selectedLog.action}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">User / Email</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{selectedLog.email || selectedLog.user || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Role</p>
                  <p className="mt-1 text-sm font-medium capitalize text-slate-700">{String(selectedLog.role || 'not recorded').replaceAll('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Branch</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{selectedLog.branch || 'System-wide'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">IP Address</p>
                  <p className="mt-1 break-all text-sm font-mono text-slate-700">{selectedLog.ip || 'not recorded'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Date &amp; Time</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{formatTimestamp(selectedLog.created_at)}</p>
                </div>
              </div>
            </div>

            {selectedLog.details && (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Full Details</p>
                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedLog.details}</p>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityLogs;
