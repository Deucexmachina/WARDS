import { useState, useEffect } from 'react';
import axios from 'axios';
import { formatUtc8Time } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_DISABLED_MESSAGE = 'This service is currently unavailable because it has been disabled by system administration.';

const QueueManagement = () => {
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [systemStatus, setSystemStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchQueues();
  }, [filter]);

  const fetchQueues = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const [queueResponse, statusResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/public/queue/branch/${user.branch_id}`),
        axios.get(`${API_BASE_URL}/public/system-status`),
      ]);
      setQueues(queueResponse.data);
      setSystemStatus(statusResponse.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch queues:', error);
      setError(error.response?.data?.detail || 'Failed to fetch queues.');
      setLoading(false);
    }
  };

  const handleCallQueue = async (queueId) => {
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    try {
      await axios.put(`${API_BASE_URL}/public/queue/${queueId}/status`, { status: 'Serving' });
      fetchQueues();
    } catch (error) {
      console.error('Failed to call queue:', error);
    }
  };

  const handleCompleteQueue = async (queueId) => {
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    try {
      await axios.put(`${API_BASE_URL}/public/queue/${queueId}/status`, { status: 'Completed' });
      fetchQueues();
    } catch (error) {
      console.error('Failed to complete queue:', error);
    }
  };

  const handleSkipQueue = async (queueId) => {
    if (!systemStatus?.queueEnabled) {
      setError(systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE);
      return;
    }
    try {
      await axios.put(`${API_BASE_URL}/public/queue/${queueId}/status`, { status: 'Skipped' });
      fetchQueues();
    } catch (error) {
      console.error('Failed to skip queue:', error);
    }
  };

  const filteredQueues = queues.filter(q => {
    if (filter === 'all') return true;
    return (q.status || '').toLowerCase() === filter.toLowerCase();
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="border-4 border-blue-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading queues...</p>
        </div>
      </div>
    );
  }

  const queueUnavailable = systemStatus && (!systemStatus.queueEnabled || systemStatus.maintenanceMode);

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Queue Management"
        subtitle="Monitor live branch queues, review current statuses, and refresh queue activity from the admin side."
        actions={(
          <button
            onClick={fetchQueues}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Refresh
          </button>
        )}
      />

      {queueUnavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
          <p className="font-semibold">{systemStatus?.disabledMessage || DEFAULT_DISABLED_MESSAGE}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('Waiting')}
            className={`px-4 py-2 rounded-lg ${filter === 'Waiting' ? 'bg-yellow-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Waiting
          </button>
          <button
            onClick={() => setFilter('Serving')}
            className={`px-4 py-2 rounded-lg ${filter === 'Serving' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Serving
          </button>
          <button
            onClick={() => setFilter('Completed')}
            className={`px-4 py-2 rounded-lg ${filter === 'Completed' ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Completed
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Queue Number</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredQueues.map((queue) => (
                <tr key={queue.id}>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600">{queue.queue_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{queue.taxpayer_name || 'N/A'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{queue.service_type}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      (queue.status || '').toLowerCase() === 'waiting' ? 'bg-yellow-100 text-yellow-800' :
                      (queue.status || '').toLowerCase() === 'serving' ? 'bg-green-100 text-green-800' :
                      (queue.status || '').toLowerCase() === 'completed' ? 'bg-gray-100 text-gray-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {queue.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatUtc8Time(queue.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {(queue.status || '').toLowerCase() === 'waiting' && (
                      <button
                        onClick={() => handleCallQueue(queue.id)}
                        disabled={queueUnavailable}
                        className="bg-green-500 text-white px-3 py-1 rounded mr-2 hover:bg-green-600"
                      >
                        Call
                      </button>
                    )}
                    {(queue.status || '').toLowerCase() === 'serving' && (
                      <button
                        onClick={() => handleCompleteQueue(queue.id)}
                        disabled={queueUnavailable}
                        className="bg-blue-500 text-white px-3 py-1 rounded mr-2 hover:bg-blue-600"
                      >
                        Complete
                      </button>
                    )}
                    {(queue.status || '').toLowerCase() === 'waiting' && (
                      <button
                        onClick={() => handleSkipQueue(queue.id)}
                        disabled={queueUnavailable}
                        className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                      >
                        Skip
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredQueues.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No queues found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QueueManagement;
