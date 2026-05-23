import { useEffect, useState } from 'react';
import { activityLogAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const typeColors = {
  admin: 'bg-purple-100 text-purple-800',
  security: 'bg-red-100 text-red-800',
  transaction: 'bg-green-100 text-green-800',
  user_auth: 'bg-blue-100 text-blue-800',
  branch_auth: 'bg-orange-100 text-orange-800',
  admin_auth: 'bg-indigo-100 text-indigo-800',
  branch_portal: 'bg-cyan-100 text-cyan-800',
  error: 'bg-rose-100 text-rose-800',
};

const formatTimestamp = (value) =>
  formatUtc8DateTime(value, 'en-US', {
    second: undefined,
  });

const ActivityLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    type: '',
    dateFrom: '',
    dateTo: '',
    user: '',
  });

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await activityLogAPI.getAll(filters);
      setLogs(response.data || []);
    } catch (fetchError) {
      console.error('Failed to load activity logs:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load activity logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleApplyFilters = () => {
    fetchLogs();
  };

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
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
            <input
              type="date"
              name="dateFrom"
              value={filters.dateFrom}
              onChange={handleFilterChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-semibold mb-2">Date To</label>
            <input
              type="date"
              name="dateTo"
              value={filters.dateTo}
              onChange={handleFilterChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent"
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
          <div className="divide-y divide-gray-200">
            {logs.map((log) => (
              <div key={log.id} className="p-6 hover:bg-gray-50 transition duration-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-bold text-primary">{log.action}</h3>
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${typeColors[log.type] || 'bg-gray-100 text-gray-800'}`}>
                        {log.type || 'general'}
                      </span>
                    </div>
                    <p className="text-gray-600">{log.details}</p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                      <span>{log.user || 'Unknown user'}</span>
                      <span>{formatTimestamp(log.created_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-gray-500">No activity logs matched the current filters.</div>
        )}
      </section>
    </div>
  );
};

export default ActivityLogs;
