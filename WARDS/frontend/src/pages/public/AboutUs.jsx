import { useEffect, useState } from 'react';
import { publicContentAPI } from '../../services/api';
import { usePublicLanguage } from '../../utils/publicLanguage';
import qcCityHall from '../../assets/branding/qc_city_hall.jpg';
import ctoOffice1 from '../../assets/branding/cto_office_1.jpg';
import ctoOffice2 from '../../assets/branding/cto_office_2.jpg';
import ctoOffice3 from '../../assets/branding/cto_office_3.jpg';

const AboutUs = () => {
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [language] = usePublicLanguage();

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await publicContentAPI.getPublicAboutUs();
        setPageContent(response.data || {});
      } catch (error) {
        console.error('Failed to fetch About Us content:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, []);

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

  const missionItems = pageContent?.mission_items || [];
  const servicePledges = pageContent?.service_pledges || [];
  const cityHallSrc = pageContent?.city_hall_image || qcCityHall;
  const officeSrc1 = pageContent?.office_image_1 || ctoOffice1;
  const officeSrc2 = pageContent?.office_image_2 || ctoOffice2;
  const officeSrc3 = pageContent?.office_image_3 || ctoOffice3;

  return (
    <div className="min-h-screen bg-lightbg">

      {/* ── Hero ── */}
      <div className="bg-primary py-16">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-blue-100">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              {language === 'en' ? "City Treasurer's Office" : 'Tanggapan ng Ingat-Yaman ng Lungsod'}
            </div>
            <h1 className="mb-3 text-4xl font-bold text-white md:text-5xl">
              {language === 'en'
                ? (pageContent?.page_title_en || 'About Us')
                : (pageContent?.page_title_tl || 'Tungkol sa Amin')}
            </h1>
            <p className="text-lg leading-relaxed text-blue-100">
              {language === 'en'
                ? (pageContent?.page_subtitle_en || '')
                : (pageContent?.page_subtitle_tl || '')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Who We Are ── */}
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="grid lg:grid-cols-3">
            {/* Left accent panel */}
            <div className="flex flex-col justify-center bg-secondary px-8 py-10 lg:py-12">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-300">
                {language === 'en' ? 'Who We Are' : 'Sino Kami'}
              </p>
              <h2 className="text-2xl font-bold text-white">
                {language === 'en' ? "City Treasurer's Office" : 'Tanggapan ng Ingat-Yaman'}
              </h2>
              <p className="mt-2 text-sm text-blue-200">Quezon City, Philippines</p>
            </div>

            {/* Right description */}
            <div className="col-span-2 flex items-center px-8 py-10">
              <p className="text-base leading-relaxed text-gray-600">
                {language === 'en'
                  ? (pageContent?.who_we_are_en || '')
                  : (pageContent?.who_we_are_tl || '')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Mission & Vision (left) + Image (right) ── */}
        <div className="mb-8 grid gap-6 lg:grid-cols-2">

          {/* Left: Mission + Vision stacked */}
          <div className="flex flex-col gap-6">
            {/* Mission */}
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="bg-secondary px-8 py-5">
                <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
                  {language === 'en' ? 'Mission' : 'Misyon'}
                </p>
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A8 8 0 0117.657 18.657z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                  </svg>
                  <h2 className="text-2xl font-bold text-white">ADVOCATE</h2>
                </div>
              </div>
              <div className="divide-y divide-slate-50 px-6 py-2">
                {missionItems.map((item, index) => (
                  <div key={index} className="flex items-start gap-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
                      {item.letter}
                    </span>
                    <p className="text-sm leading-relaxed text-gray-600">
                      {language === 'tl' ? (item.text_tl || item.text) : item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Vision */}
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="bg-secondary px-8 py-5">
                <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
                  {language === 'en' ? 'Vision' : 'Bisyon'}
                </p>
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <h2 className="text-xl font-bold text-white">
                    {language === 'en' ? 'Our Vision' : 'Aming Bisyon'}
                  </h2>
                </div>
              </div>
              <div className="px-8 py-6">
                <p className="text-sm leading-relaxed text-gray-600">
                  {language === 'en'
                    ? (pageContent?.vision_en || '')
                    : (pageContent?.vision_tl || '')}
                </p>
              </div>
            </div>
          </div>

          {/* Right: QC City Hall image */}
          <div className="overflow-hidden rounded-2xl shadow-sm">
            <img
              src={cityHallSrc}
              alt="Quezon City Hall"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        {/* ── Legal Basis (full width) ── */}
        <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-secondary px-8 py-5">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
              {language === 'en' ? 'Legal Basis' : 'Legal na Batayan'}
            </p>
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              <h2 className="text-xl font-bold text-white">
                {language === 'en' ? 'Legal Basis' : 'Legal na Batayan'}
              </h2>
            </div>
          </div>
          <div className="px-8 py-6">
            <p className="leading-relaxed text-gray-600">
              {language === 'en'
                ? (pageContent?.legal_basis_en || '')
                : (pageContent?.legal_basis_tl || '')}
            </p>
          </div>
        </div>

        {/* ── Service Pledge ── */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-secondary px-8 py-5">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
              {language === 'en' ? 'Our Commitment' : 'Aming Pangako'}
            </p>
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <h2 className="text-xl font-bold text-white">
                {language === 'en' ? 'Service Pledge' : 'Pangako ng Serbisyo'}
              </h2>
            </div>
          </div>

          {/* Photo gallery */}
          <div className="grid grid-cols-3 gap-2 px-2 pt-2">
            <img src={officeSrc1} alt="CTO Office" className="h-56 w-full rounded-xl object-cover" />
            <img src={officeSrc2} alt="CTO Branch Office" className="h-56 w-full rounded-xl object-cover" />
            <img src={officeSrc3} alt="CTO Service Hall" className="h-56 w-full rounded-xl object-cover" />
          </div>

          <div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
            {servicePledges.map((pledge, index) => (
              <div key={index} className="flex flex-col gap-4 px-8 py-7">
                <span className="text-4xl font-black text-accent leading-none">{pledge.number}</span>
                <p className="text-sm leading-relaxed text-gray-600">
                  {language === 'tl' ? (pledge.text_tl || pledge.text) : pledge.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutUs;
