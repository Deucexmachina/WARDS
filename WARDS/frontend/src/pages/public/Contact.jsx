import { useEffect, useState } from 'react';
import api, { publicContentAPI } from '../../services/api';
import { getEmailValidationMessage } from '../../utils/validation';

const Contact = () => {
  const [branches, setBranches] = useState([]);
  const [pageContent, setPageContent] = useState(null);
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

        <div className="mb-8 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white shadow-lg">
          <h2 className="mb-2 text-2xl font-bold">{language === 'en' ? pageContent?.main_office_title_en : pageContent?.main_office_title_tl}</h2>
          <p className="mb-6 text-sm font-semibold text-blue-100">{pageContent?.office_name}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex items-start">
              <svg className="mr-3 mt-1 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
              <div>
                <p className="mb-1 font-semibold">{language === 'en' ? 'Address' : 'Tirahan'}</p>
                {(pageContent?.address_lines || []).map((line, index) => (
                  <p key={`address-line-${index}`} className="text-blue-100">{line}</p>
                ))}
              </div>
            </div>
            <div className="flex items-start">
              <svg className="mr-3 mt-1 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
              </svg>
              <div>
                <p className="mb-1 font-semibold">{language === 'en' ? 'Phone' : 'Telepono'}</p>
                {(pageContent?.contact_numbers || []).map((line, index) => (
                  <p key={`phone-line-${index}`} className="text-blue-100">{line}</p>
                ))}
              </div>
            </div>
            <div className="flex items-start">
              <svg className="mr-3 mt-1 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              <div>
                <p className="mb-1 font-semibold">Email</p>
                {(pageContent?.email_addresses || []).map((line, index) => (
                  <p key={`email-line-${index}`} className="text-blue-100">{line}</p>
                ))}
              </div>
            </div>
            <div className="flex items-start">
              <svg className="mr-3 mt-1 h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div>
                <p className="mb-1 font-semibold">{language === 'en' ? 'Office Hours' : 'Oras ng Tanggapan'}</p>
                {(pageContent?.office_hours || []).map((line, index) => (
                  <p key={`hours-line-${index}`} className="text-blue-100">{line}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="mb-6 text-3xl font-bold text-gray-800">
            {language === 'en' ? pageContent?.branch_section_title_en : pageContent?.branch_section_title_tl}
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {branches.map((branch) => (
              <div key={branch.id} className="rounded-xl bg-white p-6 shadow-lg transition hover:shadow-xl">
                <h3 className="mb-4 text-xl font-bold text-blue-600">{branch.name}</h3>

                <div className="space-y-3">
                  <div className="flex items-start">
                    <svg className="mr-2 mt-0.5 h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                    </svg>
                    <p className="text-sm text-gray-700">{branch.location}</p>
                  </div>

                  <div className="flex items-start">
                    <svg className="mr-2 mt-0.5 h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                    </svg>
                    <p className="text-sm text-gray-700">{branch.contact}</p>
                  </div>

                  {branch.operating_hours && branch.operating_hours.length > 0 ? (
                    <div className="flex items-start">
                      <svg className="mr-2 mt-0.5 h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      <div className="text-sm">
                        {branch.operating_hours.filter((hour) => hour.is_open).slice(0, 2).map((hour, index) => (
                          <p key={`${branch.id}-hour-${index}`} className="text-gray-700">
                            {hour.day}: {hour.opening} - {hour.closing}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{language === 'en' ? 'Current Queue' : 'Kasalukuyang Pila'}</span>
                    <span className="font-bold text-blue-600">{branch.current_waiting} waiting</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-lg">
          <h2 className="mb-6 text-2xl font-bold text-gray-800">
            {language === 'en' ? pageContent?.form_title_en : pageContent?.form_title_tl}
          </h2>
          <form onSubmit={handleContactSubmit} className="space-y-4">
            {formNotice ? (
              <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
                emailError ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-700'
              }`}>
                {formNotice}
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block font-semibold text-gray-700">
                  {language === 'en' ? 'Full Name' : 'Buong Pangalan'}
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={contactForm.fullName}
                  onChange={handleContactInputChange}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                  placeholder={language === 'en' ? 'Juan Dela Cruz' : 'Juan Dela Cruz'}
                />
              </div>
              <div>
                <label className="mb-2 block font-semibold text-gray-700">
                  {language === 'en' ? 'Email Address' : 'Email Address'}
                </label>
                <input
                  type="email"
                  name="email"
                  value={contactForm.email}
                  onChange={handleContactInputChange}
                  className={`w-full rounded-lg border px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-blue-500 ${
                    emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="juan@example.com"
                />
                {emailError ? <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p> : null}
              </div>
            </div>
            <div>
              <label className="mb-2 block font-semibold text-gray-700">
                {language === 'en' ? 'Subject' : 'Paksa'}
              </label>
              <input
                type="text"
                name="subject"
                value={contactForm.subject}
                onChange={handleContactInputChange}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder={language === 'en' ? 'How can we help you?' : 'Paano namin kayo matutulungan?'}
              />
            </div>
            <div>
              <label className="mb-2 block font-semibold text-gray-700">
                {language === 'en' ? 'Message' : 'Mensahe'}
              </label>
              <textarea
                rows="5"
                name="message"
                value={contactForm.message}
                onChange={handleContactInputChange}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                placeholder={language === 'en' ? 'Type your message here...' : 'Ilagay ang inyong mensahe dito...'}
              ></textarea>
            </div>
            <button type="submit" className="rounded-lg bg-blue-600 px-8 py-3 font-semibold text-white transition hover:bg-blue-700">
              {language === 'en' ? 'Send Message' : 'Ipadala ang Mensahe'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Contact;
