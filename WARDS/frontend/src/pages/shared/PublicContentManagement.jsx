import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import WardsPageHero from '../../components/WardsPageHero';
import { publicContentAPI } from '../../services/api';
import { notifyActivityLogsUpdated } from '../../utils/activityLogNotifications';

const GUIDE_PAGE = 'taxpayer-guide';
const CONTACT_PAGE = 'contact';
const ABOUT_PAGE = 'about-us';
const FAQS_PAGE = 'faqs';

const makeGuideItem = () => ({ title: '', category: '', content: '' });
const makeFaqItem = () => ({ question: '', category: '', answer: '' });
const makeHelpContact = () => ({ label_en: '', label_tl: '', value: '' });
const makeMissionItem = () => ({ letter: '', text: '', text_tl: '' });
const makeServicePledge = () => ({ number: '', text: '', text_tl: '' });

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeGuideContent = (content = {}) => ({
  page_title_en: content.page_title_en || '',
  page_title_tl: content.page_title_tl || '',
  page_subtitle_en: content.page_subtitle_en || '',
  page_subtitle_tl: content.page_subtitle_tl || '',
  help_title_en: content.help_title_en || '',
  help_title_tl: content.help_title_tl || '',
  help_description_en: content.help_description_en || '',
  help_description_tl: content.help_description_tl || '',
  help_contacts: Array.isArray(content.help_contacts) && content.help_contacts.length ? content.help_contacts : [makeHelpContact()],
  guides_en: Array.isArray(content.guides_en) && content.guides_en.length ? content.guides_en : [makeGuideItem()],
  guides_tl: Array.isArray(content.guides_tl) && content.guides_tl.length ? content.guides_tl : [makeGuideItem()],
});

const normalizeContactContent = (content = {}) => ({
  page_title_en: content.page_title_en || '',
  page_title_tl: content.page_title_tl || '',
  page_subtitle_en: content.page_subtitle_en || '',
  page_subtitle_tl: content.page_subtitle_tl || '',
  main_office_title_en: content.main_office_title_en || '',
  main_office_title_tl: content.main_office_title_tl || '',
  office_name: content.office_name || '',
  address_lines: Array.isArray(content.address_lines) && content.address_lines.length ? content.address_lines : [''],
  contact_numbers: Array.isArray(content.contact_numbers) && content.contact_numbers.length ? content.contact_numbers : [''],
  email_addresses: Array.isArray(content.email_addresses) && content.email_addresses.length ? content.email_addresses : [''],
  office_hours: Array.isArray(content.office_hours) && content.office_hours.length ? content.office_hours : [''],
  branch_section_title_en: content.branch_section_title_en || '',
  branch_section_title_tl: content.branch_section_title_tl || '',
  form_title_en: content.form_title_en || '',
  form_title_tl: content.form_title_tl || '',
});

const normalizeAboutUsContent = (content = {}) => ({
  page_title_en: content.page_title_en || '',
  page_title_tl: content.page_title_tl || '',
  page_subtitle_en: content.page_subtitle_en || '',
  page_subtitle_tl: content.page_subtitle_tl || '',
  who_we_are_en: content.who_we_are_en || '',
  who_we_are_tl: content.who_we_are_tl || '',
  mission_items: Array.isArray(content.mission_items) && content.mission_items.length ? content.mission_items : [makeMissionItem()],
  vision_en: content.vision_en || '',
  vision_tl: content.vision_tl || '',
  legal_basis_en: content.legal_basis_en || '',
  legal_basis_tl: content.legal_basis_tl || '',
  service_pledges: Array.isArray(content.service_pledges) && content.service_pledges.length ? content.service_pledges : [makeServicePledge()],
  city_hall_image: content.city_hall_image || '',
  office_image_1: content.office_image_1 || '',
  office_image_2: content.office_image_2 || '',
  office_image_3: content.office_image_3 || '',
});

const normalizeFaqsContent = (content = {}) => ({
  page_title_en: content.page_title_en || '',
  page_title_tl: content.page_title_tl || '',
  page_subtitle_en: content.page_subtitle_en || '',
  page_subtitle_tl: content.page_subtitle_tl || '',
  faqs_en: Array.isArray(content.faqs_en) && content.faqs_en.length ? content.faqs_en : [makeFaqItem()],
  faqs_tl: Array.isArray(content.faqs_tl) && content.faqs_tl.length ? content.faqs_tl : [makeFaqItem()],
});

const SectionCard = ({ title, description, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="mb-5">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
    {children}
  </section>
);

const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
    {children}
    {hint ? <span className="mt-2 block text-xs text-slate-500">{hint}</span> : null}
  </label>
);

const textInputClass = 'w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';
const textAreaClass = `${textInputClass} min-h-[140px] resize-y`;

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const ImageUploadField = ({ label, value, onChange, hint }) => {
  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert(`Image must be under 2 MB. "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      <span className="block text-sm font-semibold text-slate-700">{label}</span>
      {value ? (
        <div className="relative overflow-hidden rounded-xl border border-slate-200">
          <img src={value} alt={label} className="h-40 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50"
          >
            Remove
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 transition hover:border-primary hover:bg-primary/5">
          <svg className="mb-2 h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-semibold text-slate-600">Click to upload image</span>
          <span className="mt-1 text-xs text-slate-400">PNG, JPG — max 2 MB</span>
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={handleFile} />
        </label>
      )}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
};

const ArrayTextField = ({ label, values, onChange, addLabel }) => (
  <SectionCard title={label}>
    <div className="space-y-3">
      {values.map((value, index) => (
        <div key={`${label}-${index}`} className="flex gap-3">
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(index, event.target.value)}
            className={textInputClass}
          />
          <button
            type="button"
            onClick={() => onChange(index, null)}
            className="rounded-xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange(values.length, '')}
        className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
      >
        {addLabel}
      </button>
    </div>
  </SectionCard>
);

const RepeaterCard = ({ title, description, items, onChange, onAdd, onRemove, fields }) => (
  <SectionCard title={title} description={description}>
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={`${title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">{title.slice(0, -1)} #{index + 1}</p>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
                <Field label={field.label}>
                  {field.multiline ? (
                    <textarea
                      value={item[field.key] || ''}
                      onChange={(event) => onChange(index, field.key, event.target.value)}
                      className={textAreaClass}
                    />
                  ) : (
                    <input
                      type="text"
                      value={item[field.key] || ''}
                      onChange={(event) => onChange(index, field.key, event.target.value)}
                      className={textInputClass}
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
      >
        Add {title.slice(0, -1)}
      </button>
    </div>
  </SectionCard>
);

const LanguageToggle = ({ value, onChange }) => (
  <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
    {['en', 'tl'].map((lang) => (
      <button
        key={lang}
        type="button"
        onClick={() => onChange(lang)}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${value === lang ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
      >
        {lang}
      </button>
    ))}
  </div>
);

const PublishModal = ({ label, noChanges, onConfirm, onClose, publishing }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6">
    <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.28)] md:p-8">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${noChanges ? 'bg-amber-100 text-amber-600' : 'bg-[#dbeafe] text-[#0f5b83]'}`}>
          {noChanges ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            {noChanges ? 'No Changes Detected' : 'Confirm Publish'}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">{label}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {noChanges
              ? 'The content you are about to publish is identical to what is already live. No edits have been made since the last publish.'
              : 'You are about to make this content live on the public site. This will immediately replace what visitors currently see. Make sure everything looks correct in the Live Preview before continuing.'}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={publishing}
          className="rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {noChanges ? 'OK' : 'Cancel'}
        </button>
        {!noChanges && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={publishing}
            className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {publishing ? 'Publishing...' : 'Yes, Publish Now'}
          </button>
        )}
      </div>
    </div>
  </div>
);

const EditorLangBanner = ({ value, onChange }) => (
  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
    <div>
      <p className="text-sm font-semibold text-slate-800">Editing Language</p>
      <p className="text-xs text-slate-500">Switch to edit the {value === 'en' ? 'Tagalog' : 'English'} version of this page.</p>
    </div>
    <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
      {['en', 'tl'].map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => onChange(lang)}
          className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${value === lang ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {lang === 'en' ? 'English' : 'Tagalog'}
        </button>
      ))}
    </div>
  </div>
);

const PreviewShell = ({ children }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#f3f4f8] shadow-sm">
    <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
      <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
      <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
      <span className="ml-3 flex-1 rounded bg-slate-100 px-3 py-1 text-center text-xs text-slate-400">public preview</span>
    </div>
    <div className="text-[13px]">{children}</div>
  </div>
);

const GuidePreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  const guides = language === 'en' ? (content.guides_en || []) : (content.guides_tl || []);
  const categories = ['all', ...new Set(guides.map((g) => g.category).filter(Boolean))];
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    setOpenIndex(null);
  }, [language]);

  return (
    <PreviewShell>
      {/* Hero */}
      <div className="bg-primary px-6 py-10 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          {language === 'en' ? 'Taxpayer Resource Center' : 'Sentro ng Impormasyon'}
        </div>
        <h2 className="text-2xl font-bold text-white">{content[`page_title_${suffix}`] || 'Taxpayer\'s Guide'}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-blue-100">{content[`page_subtitle_${suffix}`]}</p>
      </div>

      <div className="space-y-4 p-4">
        {/* Category pills */}
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{language === 'en' ? 'Filter by Category' : 'I-filter ayon sa Kategorya'}</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <span key={cat} className={`rounded-lg px-3 py-1 text-xs font-semibold ${cat === 'all' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600'}`}>
                {cat === 'all' ? (language === 'en' ? 'All Guides' : 'Lahat') : cat}
              </span>
            ))}
          </div>
        </div>

        {/* Guide accordion */}
        {guides.length > 0 ? (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {guides.map((guide, i) => {
              const isOpen = openIndex === i;
              return (
                <div key={i} className="border-b border-gray-100 last:border-b-0">
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-blue-50/40"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-accent">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      {guide.category && <span className="mb-0.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-accent">{guide.category}</span>}
                      <p className="text-xs font-bold leading-snug text-gray-800">{guide.title || 'Untitled guide'}</p>
                    </div>
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${isOpen ? 'bg-accent text-white' : 'bg-gray-100 text-gray-500'}`}>
                      <svg className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-blue-50 bg-blue-50/30 px-4 py-3">
                      <p className="whitespace-pre-line text-xs leading-relaxed text-gray-500">{guide.content || 'Guide content will appear here.'}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl bg-white p-6 text-center text-xs text-gray-400 shadow-sm">No guides yet.</div>
        )}

        {/* Help box */}
        <div className="rounded-xl bg-primary p-4 text-white shadow-sm">
          <p className="font-bold">{content[`help_title_${suffix}`] || (language === 'en' ? 'Need Help?' : 'Kailangan ng Tulong?')}</p>
          <p className="mt-1 text-xs text-blue-100">{content[`help_description_${suffix}`]}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(content.help_contacts || []).map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-white/10 p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
                  <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={String(c.value || '').includes('@') ? 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' : 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z'} /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">{c[`label_${suffix}`] || 'Label'}</p>
                  <p className="text-xs text-blue-100">{c.value || 'Value'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PreviewShell>
  );
};

const ContactPreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  const infoRows = [
    {
      icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      label: language === 'en' ? 'Office' : 'Tanggapan',
      lines: content.office_name ? [content.office_name] : [],
      bold: true,
    },
    {
      icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
      label: language === 'en' ? 'Address' : 'Tirahan',
      lines: content.address_lines || [],
    },
    {
      icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
      label: 'Email',
      lines: content.email_addresses || [],
    },
    {
      icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
      label: language === 'en' ? 'Phone' : 'Telepono',
      lines: content.contact_numbers || [],
    },
    {
      icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
      label: language === 'en' ? 'Office Hours' : 'Oras ng Tanggapan',
      lines: content.office_hours || [],
    },
  ];

  return (
    <PreviewShell>
      {/* Hero */}
      <div className="bg-primary px-6 py-10 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          {language === 'en' ? 'Get in Touch' : 'Makipag-ugnayan'}
        </div>
        <h2 className="text-2xl font-bold text-white">{content[`page_title_${suffix}`] || 'Contact Us'}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-blue-100">{content[`page_subtitle_${suffix}`]}</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Main Office header */}
        <div>
          <h3 className="text-sm font-bold text-gray-800">{content[`main_office_title_${suffix}`] || 'Main Office'}</h3>
          <p className="mt-0.5 text-xs font-semibold text-accent">{content.office_name || "Quezon City Treasurer's Office"}</p>
        </div>

        {/* Two-column card — form left, contact info right */}
        <div className="overflow-hidden rounded-xl shadow-sm flex flex-col sm:flex-row">
          {/* Left: form stub */}
          <div className="flex-1 bg-white p-4">
            <p className="text-xs font-bold text-gray-800">{content[`form_title_${suffix}`] || 'Send Us a Message'}</p>
            <p className="mt-0.5 text-xs text-gray-400">{language === 'en' ? "We'll get back to you as soon as possible." : 'Tutugon kami sa lalong madaling panahon.'}</p>
            <div className="mt-3 space-y-2">
              <div className="grid gap-2 grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">{language === 'en' ? 'Full Name' : 'Buong Pangalan'}</p>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-300">Juan Dela Cruz</div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">{language === 'en' ? 'Email Address' : 'Email Address'}</p>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-300">juan@example.com</div>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-600">{language === 'en' ? 'Subject' : 'Paksa'}</p>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-300">{language === 'en' ? 'How can we help you?' : 'Paano namin kayo matutulungan?'}</div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-600">{language === 'en' ? 'Message' : 'Mensahe'}</p>
                <div className="h-12 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-300">{language === 'en' ? 'Type your message here...' : 'Ilagay ang inyong mensahe dito...'}</div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                {language === 'en' ? 'Send Message' : 'Ipadala ang Mensahe'}
              </div>
            </div>
          </div>

          {/* Right: contact information panel */}
          <div className="bg-secondary p-4 text-white sm:w-48">
            <p className="text-xs font-bold">{language === 'en' ? 'Contact Information' : 'Impormasyon sa Pakikipag-ugnayan'}</p>
            <p className="mt-0.5 text-xs text-blue-200">{language === 'en' ? 'Reach us through any of the following:' : 'Makipag-ugnayan sa amin sa pamamagitan ng:'}</p>
            <div className="mt-4 space-y-3">
              {infoRows.map(({ icon, label, lines, bold }) => (
                <div key={label} className="flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/15">
                    <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={icon} /></svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">{label}</p>
                    {lines.map((l, i) => (
                      <p key={i} className={`text-xs ${bold ? 'font-semibold text-white' : 'text-blue-100'}`}>{l}</p>
                    ))}
                    {lines.length === 0 && <p className="text-xs text-blue-200/50 italic">—</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Branch offices section */}
        <div>
          <h3 className="mb-2 text-xs font-bold text-gray-700">{content[`branch_section_title_${suffix}`] || (language === 'en' ? 'Branch Offices' : 'Mga Sangay na Tanggapan')}</h3>
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-2 text-gray-300">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              <p className="text-xs text-gray-400">{language === 'en' ? 'Branch cards are pulled from Branch Settings.' : 'Ang mga sangay ay kinukuha mula sa Branch Settings.'}</p>
            </div>
          </div>
        </div>
      </div>
    </PreviewShell>
  );
};

const AboutUsPreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  return (
    <PreviewShell>
      {/* Hero */}
      <div className="bg-primary px-6 py-10 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          {language === 'en' ? "City Treasurer's Office" : 'Tanggapan ng Ingat-Yaman'}
        </div>
        <h2 className="text-2xl font-bold text-white">{content[`page_title_${suffix}`] || 'About Us'}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-blue-100">{content[`page_subtitle_${suffix}`]}</p>
      </div>

      <div className="space-y-3 p-4">
        {/* Who We Are */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="grid grid-cols-3">
            <div className="bg-secondary px-4 py-5 flex flex-col justify-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">{language === 'en' ? 'Who We Are' : 'Sino Kami'}</p>
              <p className="mt-1 text-sm font-bold text-white">{language === 'en' ? "City Treasurer's Office" : 'Tanggapan ng Ingat-Yaman'}</p>
              <p className="mt-1 text-xs text-blue-200">Quezon City</p>
            </div>
            <div className="col-span-2 flex items-center px-4 py-5">
              <p className="text-xs leading-relaxed text-gray-500">{content[`who_we_are_${suffix}`] || 'Description will appear here.'}</p>
            </div>
          </div>
        </div>

        {/* Mission + Vision + City Hall image */}
        <div className="grid gap-3 grid-cols-2">
          <div className="space-y-3">
            {/* Mission */}
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="bg-secondary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">{language === 'en' ? 'Mission' : 'Misyon'}</p>
                <p className="text-sm font-bold text-white">ADVOCATE</p>
              </div>
              <div className="divide-y divide-slate-50 px-3 py-1">
                {(content.mission_items || []).map((item, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">{item.letter || '?'}</span>
                    <p className="text-xs leading-relaxed text-gray-500">{suffix === 'tl' ? (item.text_tl || item.text) : item.text}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Vision */}
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="bg-secondary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">{language === 'en' ? 'Vision' : 'Bisyon'}</p>
                <p className="text-sm font-bold text-white">{language === 'en' ? 'Our Vision' : 'Aming Bisyon'}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs leading-relaxed text-gray-500">{content[`vision_${suffix}`]}</p>
              </div>
            </div>
          </div>
          {/* City Hall image */}
          <div className="overflow-hidden rounded-xl shadow-sm bg-slate-200 min-h-[160px]">
            {content.city_hall_image
              ? <img src={content.city_hall_image} alt="City Hall" className="h-full w-full object-cover" />
              : <div className="flex h-full min-h-[160px] items-center justify-center text-xs text-slate-400">City Hall Photo</div>}
          </div>
        </div>

        {/* Legal Basis */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="bg-secondary px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">{language === 'en' ? 'Legal Basis' : 'Legal na Batayan'}</p>
            <p className="text-sm font-bold text-white">{language === 'en' ? 'Legal Basis' : 'Legal na Batayan'}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs leading-relaxed text-gray-500">{content[`legal_basis_${suffix}`]}</p>
          </div>
        </div>

        {/* Service Pledge */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="bg-secondary px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">{language === 'en' ? 'Our Commitment' : 'Aming Pangako'}</p>
            <p className="text-sm font-bold text-white">{language === 'en' ? 'Service Pledge' : 'Pangako ng Serbisyo'}</p>
          </div>
          {/* Office photos strip */}
          <div className="grid grid-cols-3 gap-1.5 p-1.5">
            {[content.office_image_1, content.office_image_2, content.office_image_3].map((src, i) => (
              <div key={i} className="overflow-hidden rounded-lg bg-slate-200 h-16">
                {src
                  ? <img src={src} alt={`Office ${i + 1}`} className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-xs text-slate-400">Photo {i + 1}</div>}
              </div>
            ))}
          </div>
          <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {(content.service_pledges || []).map((pledge, i) => (
              <div key={i} className="flex flex-col gap-2 px-4 py-4">
                <span className="text-xl font-black text-accent leading-none">{pledge.number || `0${i + 1}`}</span>
                <p className="text-xs leading-relaxed text-gray-500">{suffix === 'tl' ? (pledge.text_tl || pledge.text) : pledge.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PreviewShell>
  );
};

const FaqsPreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  const faqs = language === 'en' ? (content.faqs_en || []) : (content.faqs_tl || []);
  const categories = [...new Set(faqs.map((f) => f.category).filter(Boolean))];

  return (
    <PreviewShell>
      {/* Hero */}
      <div className="bg-primary px-6 py-10 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {language === 'en' ? 'Help Center' : 'Sentro ng Tulong'}
        </div>
        <h2 className="text-2xl font-bold text-white">{content[`page_title_${suffix}`] || 'Frequently Asked Questions'}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-blue-100">{content[`page_subtitle_${suffix}`]}</p>
      </div>

      <div className="space-y-3 p-4">
        {/* Search bar */}
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm">
          <svg className="h-4 w-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="text-xs text-gray-300">{language === 'en' ? 'Search questions...' : 'Maghanap ng mga tanong...'}</span>
        </div>

        {/* Category filters */}
        {categories.length > 0 && (
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{language === 'en' ? 'Browse by Category' : 'Mag-browse ayon sa Kategorya'}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white">{language === 'en' ? 'All Topics' : 'Lahat'}</span>
              {categories.map((cat) => (
                <span key={cat} className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">{cat}</span>
              ))}
            </div>
          </div>
        )}

        {/* FAQ accordion items */}
        {faqs.length > 0 ? (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {categories.length > 0 && (
              <div className="flex items-center gap-2 border-b border-gray-100 bg-blue-50/60 px-4 py-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                </div>
                <p className="text-xs font-bold text-gray-800">{categories[0]}</p>
                <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{faqs.filter(f => f.category === categories[0]).length}</span>
              </div>
            )}
            <div className="divide-y divide-gray-100">
              {faqs.slice(0, 5).map((faq, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-800">{faq.question || 'Question'}</p>
                  <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              ))}
              {faqs.length > 5 && <p className="px-4 py-2 text-xs text-gray-400">+{faqs.length - 5} more…</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-white p-6 text-center text-xs text-gray-400 shadow-sm">No FAQs yet.</div>
        )}
      </div>
    </PreviewShell>
  );
};

const PublicContentManagement = ({ portal = 'admin' }) => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [activePage, setActivePage] = useState(GUIDE_PAGE);
  const [previewLanguage, setPreviewLanguage] = useState('en');
  const [editorLanguage, setEditorLanguage] = useState('en');
  const switchLanguage = (lang) => { setEditorLanguage(lang); setPreviewLanguage(lang); };
  const [guideContent, setGuideContent] = useState(normalizeGuideContent());
  const [contactContent, setContactContent] = useState(normalizeContactContent());
  const [aboutUsContent, setAboutUsContent] = useState(normalizeAboutUsContent());
  const [faqsContent, setFaqsContent] = useState(normalizeFaqsContent());
  const [notice, setNotice] = useState({ tone: '', message: '' });
  const [savingPage, setSavingPage] = useState('');
  const [publishModal, setPublishModal] = useState(null);
  const publishedSnapshots = useRef({ guide: null, contact: null, about: null, faqs: null });

  useEffect(() => {
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const adminRole = adminUser.internal_role || adminUser.role;
    const allowed = portal === 'admin'
      ? adminRole === 'superadmin' || adminRole === 'main_admin'
      : false;
    setIsAuthorized(allowed);

    if (!allowed) {
      setLoading(false);
      return;
    }

    const loadContent = async () => {
      try {
        setLoading(true);
        const [guideResponse, contactResponse, aboutUsResponse, faqsResponse] = await Promise.all([
          publicContentAPI.getTaxpayerGuideEditor(portal),
          publicContentAPI.getContactEditor(portal),
          publicContentAPI.getAboutUsEditor(portal),
          publicContentAPI.getFaqsEditor(portal),
        ]);
        const guide = normalizeGuideContent(guideResponse.data || {});
        const contact = normalizeContactContent(contactResponse.data || {});
        const about = normalizeAboutUsContent(aboutUsResponse.data || {});
        const faqs = normalizeFaqsContent(faqsResponse.data || {});
        setGuideContent(guide);
        setContactContent(contact);
        setAboutUsContent(about);
        setFaqsContent(faqs);
        publishedSnapshots.current = {
          guide: JSON.stringify(guide),
          contact: JSON.stringify(contact),
          about: JSON.stringify(about),
          faqs: JSON.stringify(faqs),
        };
      } catch (error) {
        console.error('Failed to load public content editor data:', error);
        setNotice({
          tone: 'error',
          message: error.response?.data?.detail || 'Failed to load public content settings.',
        });
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [portal, location.pathname]);

  const showNotice = (tone, message) => setNotice({ tone, message });

  // ── Taxpayer Guide handlers ──
  const updateGuideValue = (key, value) => {
    setGuideContent((current) => ({ ...current, [key]: value }));
  };

  const updateGuideListItem = (listKey, index, field, value) => {
    setGuideContent((current) => {
      const nextItems = clone(current[listKey]);
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...current, [listKey]: nextItems };
    });
  };

  const addGuideListItem = (listKey, template) => {
    setGuideContent((current) => ({ ...current, [listKey]: [...current[listKey], template()] }));
  };

  const removeGuideListItem = (listKey, index) => {
    setGuideContent((current) => {
      const nextItems = current[listKey].filter((_, itemIndex) => itemIndex !== index);
      return { ...current, [listKey]: nextItems.length ? nextItems : [listKey.includes('faq') ? makeFaqItem() : listKey === 'help_contacts' ? makeHelpContact() : makeGuideItem()] };
    });
  };

  // ── Contact handlers ──
  const updateContactValue = (key, value) => {
    setContactContent((current) => ({ ...current, [key]: value }));
  };

  const updateContactArray = (key, index, value) => {
    setContactContent((current) => {
      const nextValues = [...current[key]];
      if (value === null) {
        nextValues.splice(index, 1);
      } else if (index >= nextValues.length) {
        nextValues.push(value);
      } else {
        nextValues[index] = value;
      }
      return { ...current, [key]: nextValues.length ? nextValues : [''] };
    });
  };

  // ── About Us handlers ──
  const updateAboutUsValue = (key, value) => {
    setAboutUsContent((current) => ({ ...current, [key]: value }));
  };

  const updateAboutUsListItem = (listKey, index, field, value) => {
    setAboutUsContent((current) => {
      const nextItems = clone(current[listKey]);
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...current, [listKey]: nextItems };
    });
  };

  const addAboutUsListItem = (listKey, template) => {
    setAboutUsContent((current) => ({ ...current, [listKey]: [...current[listKey], template()] }));
  };

  const removeAboutUsListItem = (listKey, index) => {
    setAboutUsContent((current) => {
      const nextItems = current[listKey].filter((_, i) => i !== index);
      const fallback = listKey === 'mission_items' ? makeMissionItem() : makeServicePledge();
      return { ...current, [listKey]: nextItems.length ? nextItems : [fallback] };
    });
  };

  // ── FAQs handlers ──
  const updateFaqsValue = (key, value) => {
    setFaqsContent((current) => ({ ...current, [key]: value }));
  };

  const updateFaqsListItem = (listKey, index, field, value) => {
    setFaqsContent((current) => {
      const nextItems = clone(current[listKey]);
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...current, [listKey]: nextItems };
    });
  };

  const addFaqsListItem = (listKey) => {
    setFaqsContent((current) => ({ ...current, [listKey]: [...current[listKey], makeFaqItem()] }));
  };

  const removeFaqsListItem = (listKey, index) => {
    setFaqsContent((current) => {
      const nextItems = current[listKey].filter((_, i) => i !== index);
      return { ...current, [listKey]: nextItems.length ? nextItems : [makeFaqItem()] };
    });
  };

  // ── Save/publish actions ──
  const saveGuideDraft = async () => {
    try {
      setSavingPage('guide-draft');
      await publicContentAPI.saveTaxpayerGuideDraft(guideContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'Taxpayer Guide draft saved.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to save Taxpayer Guide draft.');
    } finally {
      setSavingPage('');
    }
  };

  const publishGuide = () => {
    const noChanges = publishedSnapshots.current.guide === JSON.stringify(guideContent);
    setPublishModal({
      label: 'Publish Tax Payer Guide',
      noChanges,
      onConfirm: async () => {
        try {
          setSavingPage('guide-publish');
          await publicContentAPI.publishTaxpayerGuide(guideContent, portal);
          notifyActivityLogsUpdated();
          publishedSnapshots.current.guide = JSON.stringify(guideContent);
          showNotice('success', 'Taxpayer Guide published and synced to the public page.');
        } catch (error) {
          showNotice('error', error.response?.data?.detail || 'Failed to publish Taxpayer Guide.');
        } finally {
          setSavingPage('');
          setPublishModal(null);
        }
      },
    });
  };

  const saveContactDraft = async () => {
    try {
      setSavingPage('contact-draft');
      await publicContentAPI.saveContactDraft(contactContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'Contact page draft saved.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to save Contact draft.');
    } finally {
      setSavingPage('');
    }
  };

  const publishContact = () => {
    const noChanges = publishedSnapshots.current.contact === JSON.stringify(contactContent);
    setPublishModal({
      label: 'Publish Contact Page',
      noChanges,
      onConfirm: async () => {
        try {
          setSavingPage('contact-publish');
          await publicContentAPI.publishContact(contactContent, portal);
          notifyActivityLogsUpdated();
          publishedSnapshots.current.contact = JSON.stringify(contactContent);
          showNotice('success', 'Contact page published and live on the public site.');
        } catch (error) {
          showNotice('error', error.response?.data?.detail || 'Failed to publish Contact page.');
        } finally {
          setSavingPage('');
          setPublishModal(null);
        }
      },
    });
  };

  const saveAboutUsDraft = async () => {
    try {
      setSavingPage('about-draft');
      await publicContentAPI.saveAboutUsDraft(aboutUsContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'About Us draft saved.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to save About Us draft.');
    } finally {
      setSavingPage('');
    }
  };

  const publishAboutUs = () => {
    const noChanges = publishedSnapshots.current.about === JSON.stringify(aboutUsContent);
    setPublishModal({
      label: 'Publish About Us Page',
      noChanges,
      onConfirm: async () => {
        try {
          setSavingPage('about-publish');
          await publicContentAPI.publishAboutUs(aboutUsContent, portal);
          notifyActivityLogsUpdated();
          publishedSnapshots.current.about = JSON.stringify(aboutUsContent);
          showNotice('success', 'About Us page published and live on the public site.');
        } catch (error) {
          showNotice('error', error.response?.data?.detail || 'Failed to publish About Us page.');
        } finally {
          setSavingPage('');
          setPublishModal(null);
        }
      },
    });
  };

  const saveFaqsDraft = async () => {
    try {
      setSavingPage('faqs-draft');
      await publicContentAPI.saveFaqsDraft(faqsContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'FAQs page draft saved.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to save FAQs draft.');
    } finally {
      setSavingPage('');
    }
  };

  const publishFaqs = () => {
    const noChanges = publishedSnapshots.current.faqs === JSON.stringify(faqsContent);
    setPublishModal({
      label: 'Publish FAQs Page',
      noChanges,
      onConfirm: async () => {
        try {
          setSavingPage('faqs-publish');
          await publicContentAPI.publishFaqs(faqsContent, portal);
          notifyActivityLogsUpdated();
          publishedSnapshots.current.faqs = JSON.stringify(faqsContent);
          showNotice('success', 'FAQs page published and live on the public site.');
        } catch (error) {
          showNotice('error', error.response?.data?.detail || 'Failed to publish FAQs page.');
        } finally {
          setSavingPage('');
          setPublishModal(null);
        }
      },
    });
  };

  if (loading) {
    return <div className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm">Loading public content manager...</div>;
  }

  if (!isAuthorized) {
    return (
      <div className="space-y-6">
        <WardsPageHero
          eyebrow={portal === 'admin' ? 'Super Admin Dashboard' : 'Branch Admin Dashboard'}
          title="Public Content Management"
          subtitle="Manage the public Tax Payer Guide and Contact pages from one workspace."
        />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
          Access is limited to Super Admin and Branch Admin accounts.
        </div>
      </div>
    );
  }

  const tabs = [
    { key: GUIDE_PAGE, label: 'Tax Payer Guide Page' },
    { key: CONTACT_PAGE, label: 'Contact Page' },
    { key: ABOUT_PAGE, label: 'About Us Page' },
    { key: FAQS_PAGE, label: 'FAQs Page' },
  ];

  const makePageActions = (draftKey, publishKey, onDraft, onPublish, publishLabel) => (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onDraft}
        disabled={Boolean(savingPage)}
        className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === draftKey ? 'Saving draft...' : 'Save Draft'}
      </button>
      <button
        type="button"
        onClick={onPublish}
        disabled={Boolean(savingPage)}
        className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === publishKey ? 'Publishing...' : publishLabel}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {publishModal && (
        <PublishModal
          label={publishModal.label}
          noChanges={publishModal.noChanges}
          onConfirm={publishModal.onConfirm}
          onClose={() => setPublishModal(null)}
          publishing={Boolean(savingPage)}
        />
      )}
      <WardsPageHero
        eyebrow={portal === 'admin' ? 'Super Admin Dashboard' : 'Branch Admin Dashboard'}
        title="Public Content Management"
        subtitle="Maintain the public-facing Tax Payer Guide, Contact, About Us, and FAQs pages with draft saving, live preview, and publish controls."
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActivePage(tab.key)}
              className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${activePage === tab.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {notice.message ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm font-semibold shadow-sm ${notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {notice.message}
        </div>
      ) : null}

      {/* ── Taxpayer Guide ── */}
      {activePage === GUIDE_PAGE ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Tax Payer Guide Editor</h2>
                <p className="text-sm text-slate-500">Update page copy, bilingual guides, FAQs, and the public help box.</p>
              </div>
              {makePageActions('guide-draft', 'guide-publish', saveGuideDraft, publishGuide, 'Publish Tax Payer Guide')}
            </div>

            <EditorLangBanner value={editorLanguage} onChange={switchLanguage} />

            <SectionCard title="Page Header" description="Control the hero title and supporting introduction shown on the public page.">
              <div className="space-y-4">
                <Field label="Title"><input value={guideContent[`page_title_${editorLanguage}`]} onChange={(e) => updateGuideValue(`page_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Subtitle"><textarea value={guideContent[`page_subtitle_${editorLanguage}`]} onChange={(e) => updateGuideValue(`page_subtitle_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <RepeaterCard
              key={`guides-${editorLanguage}`}
              title="Guides"
              description={`Maintain ${editorLanguage === 'en' ? 'English' : 'Tagalog'} guide cards in their public display order.`}
              items={guideContent[`guides_${editorLanguage}`]}
              onChange={(index, field, value) => updateGuideListItem(`guides_${editorLanguage}`, index, field, value)}
              onAdd={() => addGuideListItem(`guides_${editorLanguage}`, makeGuideItem)}
              onRemove={(index) => removeGuideListItem(`guides_${editorLanguage}`, index)}
              fields={[
                { key: 'title', label: 'Guide Title' },
                { key: 'category', label: 'Category' },
                { key: 'content', label: 'Content', multiline: true },
              ]}
            />

            <SectionCard title="Help Box" description="Configure the contact callout shown at the bottom of the guide page.">
              <div className="space-y-4">
                <Field label="Help Title"><input value={guideContent[`help_title_${editorLanguage}`]} onChange={(e) => updateGuideValue(`help_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Help Description"><textarea value={guideContent[`help_description_${editorLanguage}`]} onChange={(e) => updateGuideValue(`help_description_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <RepeaterCard
              title="Help Contacts"
              description="Add the phone, email, or other public support items shown in the guide help box."
              items={guideContent.help_contacts}
              onChange={(index, field, value) => updateGuideListItem('help_contacts', index, field, value)}
              onAdd={() => addGuideListItem('help_contacts', makeHelpContact)}
              onRemove={(index) => removeGuideListItem('help_contacts', index)}
              fields={[
                { key: `label_${editorLanguage}`, label: `${editorLanguage === 'en' ? 'English' : 'Tagalog'} Label` },
                { key: 'value', label: 'Displayed Value' },
              ]}
            />
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
                  <p className="mt-1 text-sm text-slate-500">Review the public page before publishing.</p>
                </div>
                <LanguageToggle value={previewLanguage} onChange={switchLanguage} />
              </div>
            </div>
            <GuidePreview content={guideContent} language={previewLanguage} />
          </div>
        </div>

      /* ── Contact ── */
      ) : activePage === CONTACT_PAGE ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Contact Page Editor</h2>
                <p className="text-sm text-slate-500">Maintain the main office section and the text framing the branch directory.</p>
              </div>
              {makePageActions('contact-draft', 'contact-publish', saveContactDraft, publishContact, 'Publish Contact Page')}
            </div>

            <EditorLangBanner value={editorLanguage} onChange={switchLanguage} />

            <SectionCard title="Page Header" description="Update the main hero copy used on the public Contact page.">
              <div className="space-y-4">
                <Field label="Title"><input value={contactContent[`page_title_${editorLanguage}`]} onChange={(e) => updateContactValue(`page_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Subtitle"><textarea value={contactContent[`page_subtitle_${editorLanguage}`]} onChange={(e) => updateContactValue(`page_subtitle_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <SectionCard title="Main Office Details" description="Manage the office information presented in the featured contact card.">
              <div className="space-y-4">
                <Field label="Section Title"><input value={contactContent[`main_office_title_${editorLanguage}`]} onChange={(e) => updateContactValue(`main_office_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Office Name"><input value={contactContent.office_name} onChange={(e) => updateContactValue('office_name', e.target.value)} className={textInputClass} /></Field>
              </div>
            </SectionCard>

            <ArrayTextField label="Address Lines" values={contactContent.address_lines} onChange={(index, value) => updateContactArray('address_lines', index, value)} addLabel="Add Address Line" />
            <ArrayTextField label="Contact Numbers" values={contactContent.contact_numbers} onChange={(index, value) => updateContactArray('contact_numbers', index, value)} addLabel="Add Contact Number" />
            <ArrayTextField label="Email Addresses" values={contactContent.email_addresses} onChange={(index, value) => updateContactArray('email_addresses', index, value)} addLabel="Add Email Address" />
            <ArrayTextField label="Operating Hours" values={contactContent.office_hours} onChange={(index, value) => updateContactArray('office_hours', index, value)} addLabel="Add Operating Hours Entry" />

            <SectionCard title="Supporting Section Labels" description="Keep the branch directory and message form headings aligned with the public page.">
              <div className="space-y-4">
                <Field label="Branch Section Title"><input value={contactContent[`branch_section_title_${editorLanguage}`]} onChange={(e) => updateContactValue(`branch_section_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Form Title"><input value={contactContent[`form_title_${editorLanguage}`]} onChange={(e) => updateContactValue(`form_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
                  <p className="mt-1 text-sm text-slate-500">Check how the featured office information will appear publicly.</p>
                </div>
                <LanguageToggle value={previewLanguage} onChange={switchLanguage} />
              </div>
            </div>
            <ContactPreview content={contactContent} language={previewLanguage} />
          </div>
        </div>

      /* ── About Us ── */
      ) : activePage === ABOUT_PAGE ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">About Us Page Editor</h2>
                <p className="text-sm text-slate-500">Update the mission, vision, legal basis, and service pledges shown on the public About Us page.</p>
              </div>
              {makePageActions('about-draft', 'about-publish', saveAboutUsDraft, publishAboutUs, 'Publish About Us')}
            </div>

            <EditorLangBanner value={editorLanguage} onChange={switchLanguage} />

            <SectionCard title="Page Header" description="Control the hero title and subtitle shown at the top of the About Us page.">
              <div className="space-y-4">
                <Field label="Title"><input value={aboutUsContent[`page_title_${editorLanguage}`]} onChange={(e) => updateAboutUsValue(`page_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Subtitle"><textarea value={aboutUsContent[`page_subtitle_${editorLanguage}`]} onChange={(e) => updateAboutUsValue(`page_subtitle_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <SectionCard title="Who We Are" description="Describe the City Treasurer's Office.">
              <Field label="Description"><textarea value={aboutUsContent[`who_we_are_${editorLanguage}`]} onChange={(e) => updateAboutUsValue(`who_we_are_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
            </SectionCard>

            <RepeaterCard
              title="Mission Items"
              description="Each item is an ADVOCATE letter with its corresponding mission statement."
              items={aboutUsContent.mission_items}
              onChange={(index, field, value) => updateAboutUsListItem('mission_items', index, field, value)}
              onAdd={() => addAboutUsListItem('mission_items', makeMissionItem)}
              onRemove={(index) => removeAboutUsListItem('mission_items', index)}
              fields={[
                { key: 'letter', label: 'Letter' },
                { key: editorLanguage === 'en' ? 'text' : 'text_tl', label: 'Mission Statement', multiline: true },
              ]}
            />

            <SectionCard title="Vision" description="The vision statement for the office.">
              <Field label="Vision"><textarea value={aboutUsContent[`vision_${editorLanguage}`]} onChange={(e) => updateAboutUsValue(`vision_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
            </SectionCard>

            <SectionCard title="Legal Basis" description="The legal mandate citation for the City Treasurer's Office.">
              <Field label="Legal Basis"><textarea value={aboutUsContent[`legal_basis_${editorLanguage}`]} onChange={(e) => updateAboutUsValue(`legal_basis_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
            </SectionCard>

            <RepeaterCard
              title="Service Pledges"
              description="The numbered service commitments displayed in the Service Pledge section."
              items={aboutUsContent.service_pledges}
              onChange={(index, field, value) => updateAboutUsListItem('service_pledges', index, field, value)}
              onAdd={() => addAboutUsListItem('service_pledges', makeServicePledge)}
              onRemove={(index) => removeAboutUsListItem('service_pledges', index)}
              fields={[
                { key: 'number', label: 'Number (e.g. 01)' },
                { key: editorLanguage === 'en' ? 'text' : 'text_tl', label: 'Pledge Text', multiline: true },
              ]}
            />

            <SectionCard title="Images" description="Upload photos used on the About Us page. Leave blank to keep the default images.">
              <div className="grid gap-6 md:grid-cols-2">
                <ImageUploadField
                  label="City Hall Photo (Mission & Vision section)"
                  value={aboutUsContent.city_hall_image}
                  onChange={(val) => updateAboutUsValue('city_hall_image', val)}
                  hint="Displayed beside the Mission and Vision cards."
                />
                <ImageUploadField
                  label="Office Photo 1 (Service Pledge gallery)"
                  value={aboutUsContent.office_image_1}
                  onChange={(val) => updateAboutUsValue('office_image_1', val)}
                  hint="First photo in the Service Pledge photo strip."
                />
                <ImageUploadField
                  label="Office Photo 2 (Service Pledge gallery)"
                  value={aboutUsContent.office_image_2}
                  onChange={(val) => updateAboutUsValue('office_image_2', val)}
                  hint="Second photo in the Service Pledge photo strip."
                />
                <ImageUploadField
                  label="Office Photo 3 (Service Pledge gallery)"
                  value={aboutUsContent.office_image_3}
                  onChange={(val) => updateAboutUsValue('office_image_3', val)}
                  hint="Third photo in the Service Pledge photo strip."
                />
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
                  <p className="mt-1 text-sm text-slate-500">Review the About Us page before publishing.</p>
                </div>
                <LanguageToggle value={previewLanguage} onChange={switchLanguage} />
              </div>
            </div>
            <AboutUsPreview content={aboutUsContent} language={previewLanguage} />
          </div>
        </div>

      /* ── FAQs ── */
      ) : activePage === FAQS_PAGE ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">FAQs Page Editor</h2>
                <p className="text-sm text-slate-500">Update the page header and manage all FAQ items in English and Tagalog.</p>
              </div>
              {makePageActions('faqs-draft', 'faqs-publish', saveFaqsDraft, publishFaqs, 'Publish FAQs Page')}
            </div>

            <EditorLangBanner value={editorLanguage} onChange={switchLanguage} />

            <SectionCard title="Page Header" description="Control the hero title and subtitle shown at the top of the public FAQs page.">
              <div className="space-y-4">
                <Field label="Title"><input value={faqsContent[`page_title_${editorLanguage}`]} onChange={(e) => updateFaqsValue(`page_title_${editorLanguage}`, e.target.value)} className={textInputClass} /></Field>
                <Field label="Subtitle"><textarea value={faqsContent[`page_subtitle_${editorLanguage}`]} onChange={(e) => updateFaqsValue(`page_subtitle_${editorLanguage}`, e.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <RepeaterCard
              key={`faqs-${editorLanguage}`}
              title="FAQs"
              description={`Manage ${editorLanguage === 'en' ? 'English' : 'Tagalog'} FAQ items grouped by category.`}
              items={faqsContent[`faqs_${editorLanguage}`]}
              onChange={(index, field, value) => updateFaqsListItem(`faqs_${editorLanguage}`, index, field, value)}
              onAdd={() => addFaqsListItem(`faqs_${editorLanguage}`)}
              onRemove={(index) => removeFaqsListItem(`faqs_${editorLanguage}`, index)}
              fields={[
                { key: 'question', label: 'Question' },
                { key: 'category', label: 'Category' },
                { key: 'answer', label: 'Answer', multiline: true },
              ]}
            />
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
                  <p className="mt-1 text-sm text-slate-500">Preview of the FAQs page header and items.</p>
                </div>
                <LanguageToggle value={previewLanguage} onChange={switchLanguage} />
              </div>
            </div>
            <FaqsPreview content={faqsContent} language={previewLanguage} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PublicContentManagement;
