import { useState, useEffect } from 'react';
import axios from 'axios';
import { getEmailValidationMessage } from '../../utils/validation';

const API_BASE_URL = 'http://localhost:8000/api';

const Contact = () => {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState('en');
  const [contactForm, setContactForm] = useState({
    fullName: '',
    email: '',
    subject: '',
    message: '',
  });
  const [emailError, setEmailError] = useState('');
  const [formNotice, setFormNotice] = useState('');

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/public/branches`);
      setBranches(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch branches:', error);
      setLoading(false);
    }
  };

  const handleContactInputChange = (event) => {
    const { name, value } = event.target;
    setContactForm((current) => ({ ...current, [name]: value }));
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }
    if (formNotice) {
      setFormNotice('');
    }
  };

  const handleContactSubmit = (event) => {
    event.preventDefault();
    const nextEmailError = getEmailValidationMessage(contactForm.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setFormNotice('Please correct the highlighted email field before sending your message.');
      return;
    }
    setFormNotice('Message sending is not connected yet, but your email field is now being validated properly.');
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
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-4xl font-bold text-gray-800 mb-2">
                {language === 'en' ? 'Contact Us' : 'Makipag-ugnayan sa Amin'}
              </h1>
              <p className="text-gray-600">
                {language === 'en' 
                  ? 'Get in touch with our branch offices'
                  : 'Makipag-ugnayan sa aming mga sangay na tanggapan'}
              </p>
            </div>
            <button
              onClick={() => setLanguage(language === 'en' ? 'tl' : 'en')}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              {language === 'en' ? 'Switch to Tagalog' : 'Lumipat sa English'}
            </button>
          </div>
        </div>

        {/* Main Office */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold mb-6">
            {language === 'en' ? 'Main Office' : 'Pangunahing Tanggapan'}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
              <div>
                <p className="font-semibold mb-1">{language === 'en' ? 'Address' : 'Tirahan'}</p>
                <p className="text-blue-100">City Hall Complex, Main Street</p>
                <p className="text-blue-100">City Center, Metro Manila</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
              </svg>
              <div>
                <p className="font-semibold mb-1">{language === 'en' ? 'Phone' : 'Telepono'}</p>
                <p className="text-blue-100">(02) 1234-5678</p>
                <p className="text-blue-100">(02) 8765-4321</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              <div>
                <p className="font-semibold mb-1">{language === 'en' ? 'Email' : 'Email'}</p>
                <p className="text-blue-100">treasurer@city.gov.ph</p>
                <p className="text-blue-100">info@citytreasurer.gov.ph</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div>
                <p className="font-semibold mb-1">{language === 'en' ? 'Office Hours' : 'Oras ng Tanggapan'}</p>
                <p className="text-blue-100">Monday - Friday: 8:00 AM - 5:00 PM</p>
                <p className="text-blue-100">Weekend schedules may vary based on the branch&apos;s published operating hours.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Branch Offices */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">
            {language === 'en' ? 'Branch Offices' : 'Mga Sangay na Tanggapan'}
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {branches.map((branch) => (
              <div key={branch.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition">
                <h3 className="text-xl font-bold text-blue-600 mb-4">{branch.name}</h3>
                
                <div className="space-y-3">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                    </svg>
                    <p className="text-gray-700 text-sm">{branch.location}</p>
                  </div>
                  
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                    </svg>
                    <p className="text-gray-700 text-sm">{branch.contact}</p>
                  </div>

                  {branch.operating_hours && branch.operating_hours.length > 0 && (
                    <div className="flex items-start">
                      <svg className="w-5 h-5 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      <div className="text-sm">
                        {branch.operating_hours.filter(h => h.is_open).slice(0, 2).map((hour, idx) => (
                          <p key={idx} className="text-gray-700">
                            {hour.day}: {hour.opening} - {hour.closing}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">
                      {language === 'en' ? 'Current Queue' : 'Kasalukuyang Pila'}
                    </span>
                    <span className="font-bold text-blue-600">{branch.current_waiting} waiting</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact Form */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            {language === 'en' ? 'Send us a Message' : 'Magpadala ng Mensahe'}
          </h2>
          <form onSubmit={handleContactSubmit} className="space-y-4">
            {formNotice ? (
              <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
                emailError ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-700'
              }`}>
                {formNotice}
              </div>
            ) : null}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  {language === 'en' ? 'Full Name' : 'Buong Pangalan'}
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={contactForm.fullName}
                  onChange={handleContactInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={language === 'en' ? 'Juan Dela Cruz' : 'Juan Dela Cruz'}
                />
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  {language === 'en' ? 'Email Address' : 'Email Address'}
                </label>
                <input
                  type="email"
                  name="email"
                  value={contactForm.email}
                  onChange={handleContactInputChange}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="juan@example.com"
                />
                {emailError ? (
                  <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
                ) : null}
              </div>
            </div>
            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Subject' : 'Paksa'}
              </label>
              <input
                type="text"
                name="subject"
                value={contactForm.subject}
                onChange={handleContactInputChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={language === 'en' ? 'How can we help you?' : 'Paano namin kayo matutulungan?'}
              />
            </div>
            <div>
              <label className="block text-gray-700 font-semibold mb-2">
                {language === 'en' ? 'Message' : 'Mensahe'}
              </label>
              <textarea
                rows="5"
                name="message"
                value={contactForm.message}
                onChange={handleContactInputChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={language === 'en' ? 'Type your message here...' : 'Ilagay ang inyong mensahe dito...'}
              ></textarea>
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              {language === 'en' ? 'Send Message' : 'Ipadala ang Mensahe'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Contact;
