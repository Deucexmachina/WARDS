import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePublicLanguage } from '../../utils/publicLanguage';

const API_BASE_URL = 'http://localhost:8000/api';

const PublicHome = () => {
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [language] = usePublicLanguage();

  useEffect(() => {
    fetchPublicData();
  }, []);

  const fetchPublicData = async () => {
    try {
      const [branchesRes, announcementsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/public/branches`),
        axios.get(`${API_BASE_URL}/public/announcements`)
      ]);
      setBranches(branchesRes.data);
      setAnnouncements(announcementsRes.data.slice(0, 3));
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch public data:', error);
      setLoading(false);
    }
  };

  const getQueueLevelColor = (level) => {
    if (level === 'low') return 'bg-green-100 text-green-800';
    if (level === 'moderate') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="border-4 border-blue-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">{language === 'en' ? 'Loading...' : 'Naglo-load...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
      {/* Header */}
      <header className="bg-blue-600 text-white shadow-lg">
        <div className="container mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">
                {language === 'en' ? 'City Treasurer\'s Office' : 'Tanggapan ng Ingat-Yaman ng Lungsod'}
              </h1>
              <p className="text-blue-100 mt-1">
                {language === 'en' ? 'Online Public Services Portal' : 'Online na Portal ng Mga Serbisyong Pampubliko'}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/login')}
                className="bg-white text-blue-600 px-6 py-2 rounded-lg font-semibold hover:bg-blue-50 transition"
              >
                {language === 'en' ? 'Staff Login' : 'Login ng Kawani'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-800 mb-4">
            {language === 'en' ? 'Welcome to Our Online Services' : 'Maligayang Pagdating sa Aming Online na Serbisyo'}
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            {language === 'en' 
              ? 'Access tax payment, queue registration, receipt requests, and more - all from the comfort of your home.'
              : 'Mag-access ng pagbabayad ng buwis, pagpaparehistro sa pila, kahilingan ng resibo, at iba pa - lahat mula sa kaginhawahan ng iyong tahanan.'}
          </p>
        </div>

        {/* Quick Services */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <button
            onClick={() => navigate('/public/services')}
            className="bg-white p-8 rounded-xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-1"
          >
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              {language === 'en' ? 'Get Queue Number' : 'Kumuha ng Numero'}
            </h3>
            <p className="text-gray-600 text-sm">
              {language === 'en' ? 'Register for queue online' : 'Magrehistro para sa pila online'}
            </p>
          </button>

          <button
            onClick={() => navigate('/public/pay-taxes')}
            className="bg-white p-8 rounded-xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-1"
          >
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              {language === 'en' ? 'Pay Taxes Online' : 'Magbayad ng Buwis Online'}
            </h3>
            <p className="text-gray-600 text-sm">
              {language === 'en' ? 'Secure online payment' : 'Secure na online payment'}
            </p>
          </button>

          <button
            onClick={() => navigate('/public/receipt-request')}
            className="bg-white p-8 rounded-xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-1"
          >
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              {language === 'en' ? 'Request Receipt' : 'Humingi ng Resibo'}
            </h3>
            <p className="text-gray-600 text-sm">
              {language === 'en' ? 'Get digital receipt copies' : 'Kumuha ng digital na kopya ng resibo'}
            </p>
          </button>

          <button
            onClick={() => navigate('/public/services')}
            className="bg-white p-8 rounded-xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-1"
          >
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              {language === 'en' ? 'FAQs & Guides' : 'Mga FAQ at Gabay'}
            </h3>
            <p className="text-gray-600 text-sm">
              {language === 'en' ? 'Get help and information' : 'Kumuha ng tulong at impormasyon'}
            </p>
          </button>
        </div>

        {/* Announcements */}
        {announcements.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">
              {language === 'en' ? '📢 Latest Announcements' : '📢 Pinakabagong Pabatid'}
            </h2>
            <div className="space-y-4">
              {announcements.map((announcement) => (
                <div key={announcement.id} className="border-l-4 border-blue-600 bg-blue-50 p-4 rounded">
                  <h3 className="font-bold text-gray-800 mb-1">{announcement.title}</h3>
                  <p className="text-gray-600 text-sm">{announcement.content}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(announcement.publish_date).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Branch Selection */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            {language === 'en' ? '🏢 Select Your Branch' : '🏢 Pumili ng Inyong Sangay'}
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => navigate(`/public/branch/${branch.id}`)}
                className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition text-left"
              >
                <h3 className="text-xl font-bold text-gray-800 mb-3">{branch.name}</h3>
                
                <div className="space-y-2 mb-4">
                  <div className="flex items-start text-sm">
                    <svg className="w-4 h-4 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                    </svg>
                    <span className="text-gray-600">{branch.location}</span>
                  </div>
                  <div className="flex items-center text-sm">
                    <svg className="w-4 h-4 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                    </svg>
                    <span className="text-gray-600">{branch.contact}</span>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-3 border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">
                      {language === 'en' ? 'Queue Status' : 'Katayuan ng Pila'}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getQueueLevelColor(branch.queue_level)}`}>
                      {branch.queue_level.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {language === 'en' ? 'Waiting:' : 'Naghihintay:'}
                    </span>
                    <span className="font-bold text-gray-800">{branch.current_waiting}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {language === 'en' ? 'Est. Wait:' : 'Tinatayang Hintay:'}
                    </span>
                    <span className="font-bold text-gray-800">{branch.estimated_wait_time} min</span>
                  </div>
                </div>

                <div className="mt-4 text-center">
                  <span className="text-blue-600 font-semibold text-sm">
                    {language === 'en' ? 'View Details →' : 'Tingnan ang Detalye →'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-800 text-white py-8 mt-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-300">
            {language === 'en' 
              ? '© 2024 City Treasurer\'s Office. All rights reserved.'
              : '© 2024 Tanggapan ng Ingat-Yaman ng Lungsod. Lahat ng karapatan ay nakalaan.'}
          </p>
          <div className="mt-4 flex justify-center gap-6">
            <button onClick={() => navigate('/public/services')} className="text-gray-300 hover:text-white">
              {language === 'en' ? 'Services' : 'Mga Serbisyo'}
            </button>
            <button onClick={() => navigate('/public/services')} className="text-gray-300 hover:text-white">
              {language === 'en' ? 'FAQs' : 'Mga FAQ'}
            </button>
            <button onClick={() => navigate('/login')} className="text-gray-300 hover:text-white">
              {language === 'en' ? 'Staff Login' : 'Login ng Kawani'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicHome;
