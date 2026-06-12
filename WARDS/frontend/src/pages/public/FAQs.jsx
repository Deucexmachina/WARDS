import { useEffect, useState } from 'react';
import { publicContentAPI } from '../../services/api';
import { usePublicLanguage } from '../../utils/publicLanguage';

const FAQs = () => {
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language] = usePublicLanguage();
  const [openFaq, setOpenFaq] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await publicContentAPI.getPublicTaxpayerGuide();
        setPageContent(response.data || {});
      } catch (error) {
        console.error('Failed to fetch FAQ content:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, []);

  const faqs = language === 'en' ? pageContent?.faqs_en || [] : pageContent?.faqs_tl || [];
  const faqCategories = [...new Set(faqs.map((faq) => faq.category).filter(Boolean))];

  const filteredFaqs = faqs.filter((faq) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      faq.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'all' || faq.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const groupedFaqs = faqCategories.reduce((acc, category) => {
    const items = filteredFaqs.filter((faq) => faq.category === category);
    if (items.length > 0) acc[category] = items;
    return acc;
  }, {});

  const uncategorizedFaqs = filteredFaqs.filter((faq) => !faq.category);

  useEffect(() => {
    setOpenFaq(null);
    setSearchQuery('');
    setActiveCategory('all');
  }, [language]);

  const toggleFaq = (key) => {
    setOpenFaq(openFaq === key ? null : key);
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

  const totalVisible = filteredFaqs.length;

  return (
    <div className="min-h-screen bg-lightbg">
      {/* Hero Section */}
      <div className="bg-primary py-16">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-blue-100">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              {language === 'en' ? 'Help Center' : 'Sentro ng Tulong'}
            </div>
            <h1 className="mb-3 text-4xl font-bold text-white md:text-5xl">
              {language === 'en' ? 'Frequently Asked Questions' : 'Mga Madalas Itanong'}
            </h1>
            <p className="text-lg leading-relaxed text-blue-100">
              {language === 'en'
                ? 'Find answers to common questions about our services.'
                : 'Hanapin ang mga sagot sa mga karaniwang tanong tungkol sa aming mga serbisyo.'}
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-4 py-10">
        {/* Search Bar */}
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setOpenFaq(null);
              }}
              placeholder={language === 'en' ? 'Search questions...' : 'Maghanap ng mga tanong...'}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-4 text-sm transition focus:border-transparent focus:bg-white focus:ring-2 focus:ring-accent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Category Filter */}
        {faqCategories.length > 0 && (
          <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {language === 'en' ? 'Browse by Category' : 'Mag-browse ayon sa Kategorya'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setActiveCategory('all'); setOpenFaq(null); }}
                className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
                  activeCategory === 'all'
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-accent'
                }`}
              >
                {language === 'en' ? 'All Topics' : 'Lahat ng Paksa'}
              </button>
              {faqCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setOpenFaq(null); }}
                  className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
                    activeCategory === cat
                      ? 'bg-accent text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-accent'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results count when searching */}
        {searchQuery && (
          <p className="mb-4 text-sm text-gray-500">
            {totalVisible > 0
              ? (language === 'en' ? `${totalVisible} result${totalVisible !== 1 ? 's' : ''} found` : `${totalVisible} resulta ang natagpuan`)
              : (language === 'en' ? 'No results found' : 'Walang resulta')}
          </p>
        )}

        {/* FAQ Accordion */}
        {totalVisible > 0 ? (
          <div className="space-y-6">
            {/* Grouped by category */}
            {Object.entries(groupedFaqs).map(([category, items]) => (
              <div key={category} className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="flex items-center gap-3 border-b border-gray-100 bg-blue-50/60 px-6 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
                    </svg>
                  </div>
                  <h2 className="font-bold text-gray-800">{category}</h2>
                  <span className="ml-auto rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
                    {items.length}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {items.map((faq, index) => {
                    const key = `${category}-${index}`;
                    const isOpen = openFaq === key;
                    return (
                      <div key={key}>
                        <button
                          onClick={() => toggleFaq(key)}
                          className="flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          aria-expanded={isOpen}
                        >
                          <span className="flex-1 text-sm font-semibold text-gray-800">{faq.question}</span>
                          <svg
                            className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-accent' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                          </svg>
                        </button>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="border-t border-gray-100 bg-blue-50/30 px-6 py-4">
                            <p className="text-sm leading-relaxed text-gray-700">{faq.answer}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Uncategorized FAQs */}
            {uncategorizedFaqs.length > 0 && (
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="divide-y divide-gray-100">
                  {uncategorizedFaqs.map((faq, index) => {
                    const key = `uncategorized-${index}`;
                    const isOpen = openFaq === key;
                    return (
                      <div key={key}>
                        <button
                          onClick={() => toggleFaq(key)}
                          className="flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          aria-expanded={isOpen}
                        >
                          <span className="flex-1 text-sm font-semibold text-gray-800">{faq.question}</span>
                          <svg
                            className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-accent' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                          </svg>
                        </button>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="border-t border-gray-100 bg-blue-50/30 px-6 py-4">
                            <p className="text-sm leading-relaxed text-gray-700">{faq.answer}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-12 text-center shadow-sm">
            <svg className="mx-auto mb-4 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p className="text-gray-500">
              {searchQuery
                ? (language === 'en' ? 'No questions match your search.' : 'Walang tanong na tumutugma sa inyong paghahanap.')
                : (language === 'en' ? 'No FAQs available at the moment.' : 'Walang mga FAQ sa ngayon.')}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 text-sm font-semibold text-accent hover:underline"
              >
                {language === 'en' ? 'Clear search' : 'I-clear ang paghahanap'}
              </button>
            )}
          </div>
        )}

        {/* Help Section */}
        <div className="mt-10 rounded-2xl bg-primary p-8 text-white shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-bold">
              {language === 'en' ? (pageContent?.help_title_en || "Still need help?") : (pageContent?.help_title_tl || 'Kailangan pa ng tulong?')}
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
                      d={
                        String(contact.value || '').includes('@')
                          ? 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
                          : 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'
                      }
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

export default FAQs;
