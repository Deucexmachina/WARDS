import { useState, useEffect } from 'react';
import { alertAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';

const Alerts = () => {
  const [alerts, setAlerts] = useState([
    { id: 1, type: 'security', title: 'Unauthorized Login Attempt', message: 'Multiple failed login attempts detected from IP 192.168.1.100', timestamp: '2024-03-17 14:35:22', severity: 'high', read: false },
    { id: 2, type: 'anomaly', title: 'Unusual Transaction Volume', message: 'Transaction volume 150% higher than average at Galas Branch', timestamp: '2024-03-17 13:20:15', severity: 'medium', read: false },
    { id: 3, type: 'system', title: 'System Performance Warning', message: 'Database response time exceeding threshold', timestamp: '2024-03-17 12:10:08', severity: 'low', read: true },
  ]);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const response = await alertAPI.getAll();
        setAlerts(response.data);
      } catch (error) {
        console.error('Error fetching alerts:', error);
      }
    };
    fetchAlerts();
  }, []);

  const handleMarkAsRead = async (id) => {
    try {
      await alertAPI.markAsRead(id);
      setAlerts(alerts.map(a => a.id === id ? { ...a, read: true } : a));
    } catch (error) {
      setAlerts(alerts.map(a => a.id === id ? { ...a, read: true } : a));
    }
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
        eyebrow="Main Admin Dashboard"
        title="System Alerts"
        subtitle="Monitor security notices, anomaly flags, and platform warnings that need administrative attention."
      />

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
                  <p className="text-sm text-gray-500">{alert.timestamp}</p>
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
      </div>
    </div>
  );
};

export default Alerts;
