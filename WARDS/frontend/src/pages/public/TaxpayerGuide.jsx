import { useEffect, useState } from 'react';
import { publicContentAPI } from '../../services/api';
import { usePublicLanguage } from '../../utils/publicLanguage';

const TaxpayerGuide = () => {
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language] = usePublicLanguage();
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedGuide, setExpandedGuide] = useState(null);

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
    setExpandedGuide(null);
  }, [language]);

  const guideIcons = {
    default: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
      </svg>
    ),
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-lightbg">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-accent border-t-transparent"></div>
          <p className="text-gray-600">{language === 'en' ? 'Loading...' : 'Naglo-load...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lightbg">
      {/* Hero Section */}
      <div className="bg-primary py-16">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-blue-100">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                </svg>
                {language === 'en' ? 'Taxpayer Resource Center' : 'Sentro ng Impormasyon para sa Nagbabayad ng Buwis'}
              </div>
              <h1 className="mb-3 text-4xl font-bold text-white md:text-5xl">
                {language === 'en' ? (pageContent?.page_title_en || 'Taxpayer Guide') : (pageContent?.page_title_tl || 'Gabay para sa Nagbabayad ng Buwis')}
              </h1>
              <p className="text-lg leading-relaxed text-blue-100">
                {language === 'en'
                  ? (pageContent?.page_subtitle_en || 'Learn the step-by-step procedures for using WARDS services and completing your transactions efficiently.')
                  : (pageContent?.page_subtitle_tl || 'Alamin ang mga hakbang-hakbang na pamamaraan sa paggamit ng mga serbisyo ng WARDS at mabisang pagkumpleto ng inyong mga transaksyon.')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl px-4 py-10">
        {/* Category Filter */}
        <div className="mb-8 rounded-2xl bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {language === 'en' ? 'Filter by Category' : 'I-filter ayon sa Kategorya'}
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
                  activeCategory === category
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-accent'
                }`}
              >
                {category === 'all' ? (language === 'en' ? 'All Guides' : 'Lahat ng Gabay') : category}
              </button>
            ))}
          </div>
        </div>

        {/* Guide Cards Grid */}
        {filteredGuides.length > 0 ? (
          <div className="mb-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGuides.map((guide, index) => {
              const isExpanded = expandedGuide === index;
              return (
                <div
                  key={`${guide.title || 'guide'}-${index}`}
                  className="flex flex-col rounded-2xl bg-white shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex flex-1 flex-col p-6">
                    <div className="mb-4 flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-accent">
                        {guideIcons.default}
                      </div>
                      <div className="flex-1">
                        {guide.category && (
                          <span className="mb-1.5 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-accent">
                            {guide.category}
                          </span>
                        )}
                        <h2 className="text-base font-bold leading-snug text-gray-800">{guide.title}</h2>
                      </div>
                    </div>

                    <div
                      className={`flex-1 overflow-hidden text-sm leading-relaxed text-gray-600 transition-all duration-300 ${
                        isExpanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      <div className="whitespace-pre-line">{guide.content}</div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 px-6 py-4">
                    <button
                      onClick={() => setExpandedGuide(isExpanded ? null : index)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary"
                    >
                      {isExpanded
                        ? (language === 'en' ? 'Show Less' : 'Ipakita ang Mas Kaunti')
                        : (language === 'en' ? 'Read More' : 'Basahin Pa')}
                      <svg
                        className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mb-10 rounded-2xl bg-white p-12 text-center shadow-sm">
            <svg className="mx-auto mb-4 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <p className="text-gray-500">
              {language === 'en' ? 'No guides available in this category.' : 'Walang mga gabay sa kategoryang ito.'}
            </p>
          </div>
        )}

        {/* Help / Contact Section */}
        <div className="rounded-2xl bg-primary p-8 text-white shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-bold">
              {language === 'en' ? (pageContent?.help_title_en || 'Need Help?') : (pageContent?.help_title_tl || 'Kailangan ng Tulong?')}
            </h2>
          </div>
          <p className="mb-6 text-blue-100">
            {language === 'en' ? pageContent?.help_description_en : pageContent?.help_description_tl}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {(pageContent?.help_contacts || []).map((contact, index) => (
              <div key={`help-contact-${index}`} className="flex items-start gap-3 rounded-xl bg-white/10 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d={String(contact.value || '').includes('@')
                        ? 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
                        : 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'}
                    ></path>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{language === 'en' ? contact.label_en : contact.label_tl}</p>
                  <p className="text-sm text-blue-100">{contact.value}</p>
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
