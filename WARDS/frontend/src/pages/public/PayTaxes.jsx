import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TAX_SERVICES = [
  {
    key: 'rpt',
    title: {
      en: 'Real Property Tax',
      tl: 'Real Property Tax',
    },
    subtitle: 'RPT',
    description: {
      en: 'Search by Tax Declaration Number, compute dues, build your cart, and proceed through treasury-assisted PayMongo payment validation.',
      tl: 'Maghanap gamit ang Tax Declaration Number, kwentahin ang mga dapat bayaran, buuin ang cart, at magpatuloy sa validation ng PayMongo payment na pinangangasiwaan ng treasury.',
    },
    status: {
      en: 'Available',
      tl: 'Available',
    },
    path: '/pay-taxes/rpt',
  },
  {
    key: 'bt',
    title: {
      en: 'Business Tax',
      tl: 'Business Tax',
    },
    subtitle: 'BT',
    description: {
      en: 'Choose between the Business Tax assessment route and the appointment-based queueing module for in-person assistance.',
      tl: 'Pumili sa pagitan ng Online Business Tax assessment at ng appointment-based queueing module para sa in-person na tulong.',
    },
    status: {
      en: 'Available',
      tl: 'Available',
    },
    path: '/pay-taxes/bt',
  },
];

const PAY_TAXES_LANGUAGE_STORAGE_KEY = 'wards-pay-taxes-language';

const PAGE_TEXT = {
  en: {
    eyebrow: "City Treasurer's Office",
    title: 'Choose Your Tax Service',
    subtitle: 'Select the online tax payment module you want to use. Real Property Tax and Business Tax are both available through WARDS public-facing payment workflows.',
    languageButton: 'English',
    languageButtonAria: 'Switch to Tagalog',
    backHome: 'Back to Home',
    openService: 'Open Service',
    viewModule: 'View Module',
  },
  tl: {
    eyebrow: 'Tanggapan ng Ingat-Yaman ng Lungsod',
    title: 'Piliin ang Iyong Serbisyong Buwis',
    subtitle: 'Piliin ang nais mong bayaran sa online tax payment. Ang Real Property Tax at Business Tax ay parehong available.',
    languageButton: 'Tagalog',
    languageButtonAria: 'Lumipat sa English',
    backHome: 'Bumalik sa Home',
    openService: 'Buksan ang Serbisyo',
    viewModule: 'Tingnan ang Module',
  },
};

const PayTaxes = () => {
  const navigate = useNavigate();
  const [language, setLanguage] = useState(() => sessionStorage.getItem(PAY_TAXES_LANGUAGE_STORAGE_KEY) || 'en');

  useEffect(() => {
    sessionStorage.setItem(PAY_TAXES_LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const text = PAGE_TEXT[language] || PAGE_TEXT.en;

  return (
    <section className="min-h-screen bg-[#f7f9fc] py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-200 bg-[#0f2f5f] px-6 py-6 text-white sm:px-8 sm:py-7">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex w-full items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 sm:w-auto"
              >
                {text.backHome}
              </button>
              <button
                type="button"
                onClick={() => setLanguage((current) => (current === 'en' ? 'tl' : 'en'))}
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0f2f5f] transition hover:bg-blue-50 sm:w-auto"
                aria-label={text.languageButtonAria}
              >
                {text.languageButton}
              </button>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blue-100">{text.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{text.title}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-blue-100 sm:text-lg">
              {text.subtitle}
            </p>
          </div>

          <div className="px-8 py-10 sm:px-10">
            <div className="grid gap-6 lg:grid-cols-2">
              {TAX_SERVICES.map((service) => {
                const statusLabel = service.status[language] || service.status.en;
                const isAvailable = service.status.en === 'Available';
                return (
                  <button
                    key={service.key}
                    type="button"
                    onClick={() => navigate(service.path)}
                    className={`group relative isolate rounded-[30px] border border-[#0f5b83]/35 bg-[#f7fbfe] p-7 text-left shadow-[0_0_0_1px_rgba(15,91,131,0.08),0_0_28px_rgba(15,91,131,0.10)] transition duration-300 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[30px] before:bg-[#0f5b83] before:opacity-10 before:blur-2xl ${
                      isAvailable
                        ? 'hover:-translate-y-1 hover:bg-white hover:shadow-[0_0_0_1px_rgba(15,91,131,0.14),0_0_34px_rgba(15,91,131,0.16)]'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold ${
                        isAvailable ? 'bg-[#0f5b83] text-white' : 'bg-slate-300 text-slate-700'
                      }`}>
                        {service.subtitle}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
                      isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {statusLabel}
                      </span>
                    </div>
                    {service.title ? <h2 className="mt-6 text-2xl font-bold text-slate-900">{service.title[language] || service.title.en}</h2> : null}
                    <p className={`${service.title ? 'mt-3' : 'mt-6'} text-sm leading-7 text-slate-600`}>{service.description[language] || service.description.en}</p>
                    <div className={`mt-8 inline-flex items-center text-sm font-bold uppercase tracking-[0.16em] ${
                      isAvailable ? 'text-[#0f5b83]' : 'text-slate-500'
                    }`}>
                      {isAvailable ? text.openService : text.viewModule}
                      <svg className="ml-2 h-4 w-4 transition group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PayTaxes;
