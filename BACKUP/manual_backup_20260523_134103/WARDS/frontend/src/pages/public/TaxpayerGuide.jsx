import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const TaxpayerGuide = () => {
  const [guides, setGuides] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState('en');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    fetchGuides();
  }, [language]);

  const fetchGuides = async () => {
    try {
      const [guidesRes, faqsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/public/taxpayer-guide?language=${language}`),
        axios.get(`${API_BASE_URL}/public/faqs?language=${language}`)
      ]);
      setGuides(guidesRes.data);
      setFaqs(faqsRes.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch guides:', error);
      setLoading(false);
    }
  };

  const categories = ['all', ...new Set(guides.map(g => g.category))];
  const filteredGuides = activeCategory === 'all' 
    ? guides 
    : guides.filter(g => g.category === activeCategory);

  const faqCategories = [...new Set(faqs.map(f => f.category))];

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
                {language === 'en' ? 'Taxpayer\'s Guide' : 'Gabay ng Nagbabayad ng Buwis'}
              </h1>
              <p className="text-gray-600">
                {language === 'en' 
                  ? 'Comprehensive guides and procedures for all tax-related services'
                  : 'Komprehensibong gabay at pamamaraan para sa lahat ng serbisyong may kaugnayan sa buwis'}
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

        {/* Category Tabs */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`px-6 py-2 rounded-lg font-semibold transition ${
                  activeCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category === 'all' ? (language === 'en' ? 'All Guides' : 'Lahat ng Gabay') : category}
              </button>
            ))}
          </div>
        </div>

        {/* Guides */}
        <div className="space-y-6 mb-12">
          {filteredGuides.map((guide) => (
            <div key={guide.id} className="bg-white rounded-xl shadow-lg p-8">
              <div className="flex items-start mb-4">
                <div className="bg-blue-100 p-3 rounded-full mr-4">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                </div>
                <div className="flex-1">
                  <span className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold mb-2">
                    {guide.category}
                  </span>
                  <h2 className="text-2xl font-bold text-gray-800 mb-3">{guide.title}</h2>
                  <div className="text-gray-700 whitespace-pre-line leading-relaxed">
                    {guide.content}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* FAQs Section */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">
            {language === 'en' ? 'Frequently Asked Questions' : 'Mga Madalas Itanong'}
          </h2>

          {faqCategories.map((category) => (
            <div key={category} className="mb-8">
              <h3 className="text-xl font-bold text-blue-600 mb-4">{category}</h3>
              <div className="space-y-4">
                {faqs
                  .filter(faq => faq.category === category)
                  .map((faq) => (
                    <details key={faq.id} className="bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition">
                      <summary className="font-semibold text-gray-800 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        {faq.question}
                      </summary>
                      <p className="mt-3 text-gray-700 pl-7">{faq.answer}</p>
                    </details>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Contact Information */}
        <div className="bg-blue-600 text-white rounded-xl shadow-lg p-8 mt-8">
          <h2 className="text-2xl font-bold mb-4">
            {language === 'en' ? 'Need More Help?' : 'Kailangan ng Karagdagang Tulong?'}
          </h2>
          <p className="mb-6">
            {language === 'en'
              ? 'If you can\'t find the answer you\'re looking for, please contact us directly.'
              : 'Kung hindi mo mahanap ang sagot na iyong hinahanap, mangyaring makipag-ugnayan sa amin nang direkta.'}
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
              </svg>
              <div>
                <p className="font-semibold">{language === 'en' ? 'Phone' : 'Telepono'}</p>
                <p className="text-blue-100">(02) 1234-5678</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="w-6 h-6 mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              <div>
                <p className="font-semibold">{language === 'en' ? 'Email' : 'Email'}</p>
                <p className="text-blue-100">treasurer@city.gov.ph</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxpayerGuide;
