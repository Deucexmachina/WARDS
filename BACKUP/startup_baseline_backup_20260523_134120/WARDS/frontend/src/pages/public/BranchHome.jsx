import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const BranchHome = () => {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    if (branchId) {
      fetchBranchDetails();
    }
  }, [branchId]);

  const fetchBranchDetails = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/public/branches/${branchId}`);
      setBranch(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch branch details:', error);
      setLoading(false);
    }
  };

  const getQueueLevelColor = (level) => {
    if (level === 'low') return 'bg-green-100 text-green-800';
    if (level === 'moderate') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const getIconColor = (color) => {
    const colors = {
      blue: 'text-blue-600',
      green: 'text-green-600',
      yellow: 'text-yellow-600',
      red: 'text-red-600'
    };
    return colors[color] || 'text-blue-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="border-4 border-blue-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading branch information...</p>
        </div>
      </div>
    );
  }

  if (!branch) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Branch Not Found</h2>
          <button
            onClick={() => navigate('/public')}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white py-6 shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">{branch.name}</h1>
              <p className="text-blue-100 mt-1">{language === 'en' ? 'City Treasurer\'s Office' : 'Tanggapan ng Ingat-Yaman ng Lungsod'}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage('en')}
                className={`px-4 py-2 rounded ${language === 'en' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white'}`}
              >
                English
              </button>
              <button
                onClick={() => setLanguage('tl')}
                className={`px-4 py-2 rounded ${language === 'tl' ? 'bg-white text-blue-600' : 'bg-blue-700 text-white'}`}
              >
                Tagalog
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Branch Information Card */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {language === 'en' ? 'Branch Information' : 'Impormasyon ng Sangay'}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-start mb-4">
                <svg className="w-6 h-6 text-blue-600 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <div>
                  <p className="font-semibold text-gray-700">{language === 'en' ? 'Location' : 'Lokasyon'}</p>
                  <p className="text-gray-600">{branch.location}</p>
                </div>
              </div>
              <div className="flex items-start mb-4">
                <svg className="w-6 h-6 text-blue-600 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                </svg>
                <div>
                  <p className="font-semibold text-gray-700">{language === 'en' ? 'Contact' : 'Kontak'}</p>
                  <p className="text-gray-600">{branch.contact}</p>
                </div>
              </div>
              <div className="flex items-start">
                <svg className="w-6 h-6 text-blue-600 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div>
                  <p className="font-semibold text-gray-700 mb-2">{language === 'en' ? 'Operating Hours' : 'Oras ng Operasyon'}</p>
                  {branch.operating_hours.filter(h => h.is_open).map((hour, idx) => (
                    <p key={idx} className="text-gray-600 text-sm">
                      {hour.day}: {hour.opening} - {hour.closing}
                    </p>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Queue Status */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                {language === 'en' ? 'Current Queue Status' : 'Kasalukuyang Katayuan ng Pila'}
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">{language === 'en' ? 'Waiting' : 'Naghihintay'}:</span>
                  <span className="text-2xl font-bold text-blue-600">{branch.queue_status.waiting}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">{language === 'en' ? 'Est. Wait Time' : 'Tinatayang Oras'}:</span>
                  <span className="text-lg font-semibold text-gray-800">{branch.queue_status.estimated_wait_time} min</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">{language === 'en' ? 'Queue Level' : 'Antas ng Pila'}:</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getQueueLevelColor(branch.queue_status.queue_level)}`}>
                    {branch.queue_status.queue_level.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Announcements */}
        {branch.announcements && branch.announcements.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {language === 'en' ? 'Announcements & Updates' : 'Mga Pabatid at Update'}
            </h2>
            <div className="space-y-4">
              {branch.announcements.map((announcement) => (
                <div key={announcement.id} className="border-l-4 border-blue-600 bg-blue-50 p-4 rounded">
                  <div className="flex items-start">
                    <svg className={`w-6 h-6 mr-3 ${getIconColor(announcement.icon_color)}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path>
                    </svg>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-gray-800">{announcement.title}</h3>
                        {announcement.branch_name && (
                          <span className="inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                            From {announcement.branch_name}
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 mt-1">{announcement.content}</p>
                      <p className="text-sm text-gray-500 mt-2">
                        {new Date(announcement.publish_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available Services */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {language === 'en' ? 'Available Services' : 'Mga Magagamit na Serbisyo'}
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branch.services.map((service) => (
              <div key={service.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                <h3 className="font-bold text-gray-800 mb-2">{service.name}</h3>
                <p className="text-sm text-gray-600 mb-3">{service.description}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">~{service.average_time} min</span>
                  {service.requires_appointment && (
                    <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">
                      {language === 'en' ? 'Appointment' : 'Tipanan'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => navigate(`/public/queue/${branchId}`)}
            className="bg-blue-600 text-white p-6 rounded-xl shadow-lg hover:bg-blue-700 transition"
          >
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
            </svg>
            <h3 className="font-bold text-lg">{language === 'en' ? 'Get Queue Number' : 'Kumuha ng Numero'}</h3>
          </button>

          <button
            onClick={() => navigate('/public/receipt-request')}
            className="bg-green-600 text-white p-6 rounded-xl shadow-lg hover:bg-green-700 transition"
          >
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <h3 className="font-bold text-lg">{language === 'en' ? 'Request Receipt' : 'Humingi ng Resibo'}</h3>
          </button>

          <button
            onClick={() => navigate('/public/pay-taxes')}
            className="bg-purple-600 text-white p-6 rounded-xl shadow-lg hover:bg-purple-700 transition"
          >
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
            </svg>
            <h3 className="font-bold text-lg">{language === 'en' ? 'Pay Online' : 'Magbayad Online'}</h3>
          </button>

          <button
            onClick={() => navigate('/public/services')}
            className="bg-orange-600 text-white p-6 rounded-xl shadow-lg hover:bg-orange-700 transition"
          >
            <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <h3 className="font-bold text-lg">{language === 'en' ? 'More Services' : 'Iba Pang Serbisyo'}</h3>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchHome;
