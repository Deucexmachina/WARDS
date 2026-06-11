import { useEffect, useState } from 'react';
import { publicContentAPI } from '../../services/api';

const TaxpayerGuide = () => {
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState('en');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    const fetchGuideContent = async () => {
      try {
        const response = await publicContentAPI.getPublicTaxpayerGuide();
        setPageContent(response.data || {});
      } catch (error) {
        console.error('Failed to fetch guide content:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGuideContent();
  }, []);

  const guides = language === 'en' ? pageContent?.guides_en || [] : pageContent?.guides_tl || [];
  const categories = ['all', ...new Set(guides.map((guide) => guide.category).filter(Boolean))];
  const filteredGuides = activeCategory === 'all' ? guides : guides.filter((guide) => guide.category === activeCategory);

  useEffect(() => {
    setActiveCategory('all');
  }, [language]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          <p className="text-gray-600">{language === 'en' ? 'Loading...' : 'Naglo-load...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mb-8 rounded-xl bg-white p-8 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="mb-2 text-4xl font-bold text-gray-800">
                {language === 'en' ? pageContent?.page_title_en : pageContent?.page_title_tl}
              </h1>
              <p className="text-gray-600">
                {language === 'en' ? pageContent?.page_subtitle_en : pageContent?.page_subtitle_tl}
              </p>
            </div>
            <button
              onClick={() => setLanguage(language === 'en' ? 'tl' : 'en')}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
            >
              {language === 'en' ? 'Switch to Tagalog' : 'Lumipat sa English'}
            </button>
          </div>
        </div>

        <div className="mb-8 rounded-xl bg-white p-6 shadow-lg">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`rounded-lg px-6 py-2 font-semibold transition ${
                  activeCategory === category ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category === 'all' ? (language === 'en' ? 'All Guides' : 'Lahat ng Gabay') : category}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8 space-y-6">
          {filteredGuides.map((guide, index) => (
            <div key={`${guide.title || 'guide'}-${index}`} className="rounded-xl bg-white p-8 shadow-lg">
              <div className="flex items-start">
                <div className="mr-4 rounded-full bg-blue-100 p-3">
                  <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                </div>
                <div className="flex-1">
                  <span className="mb-2 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                    {guide.category}
                  </span>
                  <h2 className="mb-3 text-2xl font-bold text-gray-800">{guide.title}</h2>
                  <div className="whitespace-pre-line leading-relaxed text-gray-700">{guide.content}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl bg-blue-600 p-8 text-white shadow-lg">
          <h2 className="mb-4 text-2xl font-bold">{language === 'en' ? pageContent?.help_title_en : pageContent?.help_title_tl}</h2>
          <p className="mb-6">
            {language === 'en' ? pageContent?.help_description_en : pageContent?.help_description_tl}
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {(pageContent?.help_contacts || []).map((contact, index) => (
              <div key={`help-contact-${index}`} className="flex items-start">
                <svg className="mr-3 mt-1 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={String(contact.value || '').includes('@') ? 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' : 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'}></path>
                </svg>
                <div>
                  <p className="font-semibold">{language === 'en' ? contact.label_en : contact.label_tl}</p>
                  <p className="text-blue-100">{contact.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxpayerGuide;
