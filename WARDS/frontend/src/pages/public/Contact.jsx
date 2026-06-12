import { useEffect, useState } from 'react';
import api, { publicContentAPI } from '../../services/api';
import { getEmailValidationMessage } from '../../utils/validation';
import { usePublicLanguage } from '../../utils/publicLanguage';

const Contact = () => {
  const [branches, setBranches] = useState([]);
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language] = usePublicLanguage();
  const [contactForm, setContactForm] = useState({
    fullName: '',
    email: '',
    subject: '',
    message: '',
  });
  const [emailError, setEmailError] = useState('');
  const [formNotice, setFormNotice] = useState('');

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const [branchesResponse, contentResponse] = await Promise.all([
          api.get('/public/branches'),
          publicContentAPI.getPublicContact(),
        ]);
        setBranches(branchesResponse.data || []);
        setPageContent(contentResponse.data || {});
      } catch (error) {
        console.error('Failed to fetch contact page data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, []);

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
      <div className="bg-primary py-14">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-blue-100">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              {language === 'en' ? 'Get in Touch' : 'Makipag-ugnayan'}
            </div>
            <h1 className="mb-1 text-4xl font-bold text-white md:text-5xl">
              {language === 'en' ? (pageContent?.page_title_en || 'Contact Us') : (pageContent?.page_title_tl || 'Makipag-ugnayan sa Amin')}
            </h1>
            <p className="mt-2 text-lg leading-relaxed text-blue-100">
              {language === 'en'
                ? (pageContent?.page_subtitle_en || 'For inquiries, concerns, or assistance regarding WARDS services, please contact the Quezon City Treasurer\'s Office using the information below.')
                : (pageContent?.page_subtitle_tl || 'Para sa mga katanungan, alalahanin, o tulong kaugnay sa mga serbisyo ng WARDS, makipag-ugnayan sa Tanggapan ng Ingat-Yaman ng Lungsod ng Quezon.')}
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl px-4 py-10">
        {/* Main Office Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800">
            {language === 'en' ? (pageContent?.main_office_title_en || 'Main Office') : (pageContent?.main_office_title_tl || 'Pangunahing Tanggapan')}
          </h2>
          <p className="mt-1 text-base font-semibold text-accent">{pageContent?.office_name || "Quezon City Treasurer's Office"}</p>
        </div>

        {/* Two-Column Top Container: Branch Offices + Contact Information */}
        <div className="mb-10 overflow-hidden rounded-2xl shadow-md lg:flex">
          {/* Left: Branch Offices */}
          <div className="flex-1 bg-white p-8">
            <h3 className="mb-1 text-xl font-bold text-gray-800">
              {language === 'en' ? (pageContent?.branch_section_title_en || 'Branch Offices') : (pageContent?.branch_section_title_tl || 'Mga Sangay na Tanggapan')}
            </h3>
            <p className="mb-6 text-sm text-gray-500">
              {language === 'en' ? 'Visit any of our branch offices near you.' : 'Bisitahin ang alinman sa aming mga sangay na tanggapan.'}
            </p>
            {branches.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {branches.map((branch) => (
                  <div key={branch.id} className="rounded-2xl border border-gray-100 p-4 shadow-sm transition-shadow hover:shadow-md">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-accent">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                        </svg>
                      </div>
                      <h3 className="font-bold text-gray-800">{branch.name}</h3>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                        </svg>
                        <p className="text-sm text-gray-600">{branch.location}</p>
                      </div>

                      <div className="flex items-start gap-2">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                        </svg>
                        <p className="text-sm text-gray-600">{branch.contact}</p>
                      </div>

                      {branch.operating_hours && branch.operating_hours.length > 0 ? (
                        <div className="flex items-start gap-2">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                          </svg>
                          <div className="text-sm">
                            {branch.operating_hours.filter((hour) => hour.is_open).slice(0, 2).map((hour, index) => (
                              <p key={`${branch.id}-hour-${index}`} className="text-gray-600">
                                {hour.day}: {hour.opening} - {hour.closing}
                              </p>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3">
                      <span className="text-xs font-semibold text-gray-500">
                        {language === 'en' ? 'Current Queue' : 'Kasalukuyang Pila'}
                      </span>
                      <span className="text-sm font-bold text-accent">{branch.current_waiting} {language === 'en' ? 'waiting' : 'naghihintay'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">{language === 'en' ? 'No branch offices available.' : 'Walang available na sangay na tanggapan.'}</p>
            )}
          </div>

          {/* Right: Contact Information */}
          <div className="bg-secondary p-8 text-white lg:w-80 xl:w-96">
            <h3 className="mb-1 text-xl font-bold">
              {language === 'en' ? 'Contact Information' : 'Impormasyon sa Pakikipag-ugnayan'}
            </h3>
            <p className="mb-8 text-sm text-blue-200">
              {language === 'en' ? 'Reach us through any of the following:' : 'Makipag-ugnayan sa amin sa pamamagitan ng:'}
            </p>

            <div className="space-y-6">
              {/* Office Name */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                    {language === 'en' ? 'Office' : 'Tanggapan'}
                  </p>
                  <p className="mt-0.5 font-semibold text-white">{pageContent?.office_name || "Quezon City Treasurer's Office"}</p>
                </div>
              </div>

              {/* Address */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                    {language === 'en' ? 'Address' : 'Tirahan'}
                  </p>
                  <div className="mt-0.5">
                    {(pageContent?.address_lines || []).map((line, index) => (
                      <p key={`address-line-${index}`} className="text-sm text-blue-100">{line}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Email */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Email</p>
                  <div className="mt-0.5">
                    {(pageContent?.email_addresses || []).map((line, index) => (
                      <p key={`email-line-${index}`} className="text-sm text-blue-100">{line}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                    {language === 'en' ? 'Phone' : 'Telepono'}
                  </p>
                  <div className="mt-0.5">
                    {(pageContent?.contact_numbers || []).map((line, index) => (
                      <p key={`phone-line-${index}`} className="text-sm text-blue-100">{line}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Office Hours */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                    {language === 'en' ? 'Office Hours' : 'Oras ng Tanggapan'}
                  </p>
                  <div className="mt-0.5">
                    {(pageContent?.office_hours || []).map((line, index) => (
                      <p key={`hours-line-${index}`} className="text-sm text-blue-100">{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Send Us a Message — full width below */}
        <div className="mb-10 overflow-hidden rounded-2xl bg-white p-8 shadow-md">
          <h3 className="mb-1 text-xl font-bold text-gray-800">
            {language === 'en' ? (pageContent?.form_title_en || 'Send Us a Message') : (pageContent?.form_title_tl || 'Magpadala ng Mensahe')}
          </h3>
          <p className="mb-6 text-sm text-gray-500">
            {language === 'en' ? "We'll get back to you as soon as possible." : 'Tutugon kami sa lalong madaling panahon.'}
          </p>

          <form onSubmit={handleContactSubmit} className="space-y-5">
            {formNotice ? (
              <div
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
                  emailError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700'
                }`}
              >
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={emailError ? 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}></path>
                </svg>
                {formNotice}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                  {language === 'en' ? 'Full Name' : 'Buong Pangalan'}
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={contactForm.fullName}
                  onChange={handleContactInputChange}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm transition focus:border-transparent focus:bg-white focus:ring-2 focus:ring-accent"
                  placeholder={language === 'en' ? 'Juan Dela Cruz' : 'Juan Dela Cruz'}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                  {language === 'en' ? 'Email Address' : 'Email Address'}
                </label>
                <input
                  type="email"
                  name="email"
                  value={contactForm.email}
                  onChange={handleContactInputChange}
                  className={`w-full rounded-xl border px-4 py-3 text-sm transition focus:border-transparent focus:ring-2 focus:ring-accent ${
                    emailError ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:bg-white'
                  }`}
                  placeholder="juan@example.com"
                />
                {emailError ? (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    {emailError}
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                {language === 'en' ? 'Subject' : 'Paksa'}
              </label>
              <input
                type="text"
                name="subject"
                value={contactForm.subject}
                onChange={handleContactInputChange}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm transition focus:border-transparent focus:bg-white focus:ring-2 focus:ring-accent"
                placeholder={language === 'en' ? 'How can we help you?' : 'Paano namin kayo matutulungan?'}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                {language === 'en' ? 'Message' : 'Mensahe'}
              </label>
              <textarea
                rows="5"
                name="message"
                value={contactForm.message}
                onChange={handleContactInputChange}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm transition focus:border-transparent focus:bg-white focus:ring-2 focus:ring-accent"
                placeholder={language === 'en' ? 'Type your message here...' : 'Ilagay ang inyong mensahe dito...'}
              ></textarea>
            </div>

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-3 font-semibold text-white transition hover:bg-primary sm:w-auto"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
              </svg>
              {language === 'en' ? 'Send Message' : 'Ipadala ang Mensahe'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Contact;
