import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import WardsPageHero from '../../components/WardsPageHero';
import { publicContentAPI } from '../../services/api';
import { notifyActivityLogsUpdated } from '../../utils/activityLogNotifications';

const GUIDE_PAGE = 'taxpayer-guide';
const CONTACT_PAGE = 'contact';

const makeGuideItem = () => ({ title: '', category: '', content: '' });
const makeFaqItem = () => ({ question: '', category: '', answer: '' });
const makeHelpContact = () => ({ label_en: '', label_tl: '', value: '' });

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
  faqs_en: Array.isArray(content.faqs_en) && content.faqs_en.length ? content.faqs_en : [makeFaqItem()],
  faqs_tl: Array.isArray(content.faqs_tl) && content.faqs_tl.length ? content.faqs_tl : [makeFaqItem()],
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

const GuidePreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  const guides = language === 'en' ? content.guides_en : content.guides_tl;
  const faqs = language === 'en' ? content.faqs_en : content.faqs_tl;

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Public Preview</p>
        <h3 className="mt-2 text-3xl font-black text-slate-900">{content[`page_title_${suffix}`]}</h3>
        <p className="mt-2 text-sm text-slate-500">{content[`page_subtitle_${suffix}`]}</p>
      </div>

      <div className="space-y-4">
        {guides.map((guide, index) => (
          <div key={`guide-preview-${index}`} className="rounded-2xl bg-white p-5 shadow-sm">
            <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{guide.category || 'Category'}</span>
            <h4 className="mt-3 text-xl font-bold text-slate-900">{guide.title || 'Untitled guide'}</h4>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{guide.content || 'Guide content preview will appear here.'}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h4 className="text-xl font-bold text-slate-900">{language === 'en' ? 'Frequently Asked Questions' : 'Mga Madalas Itanong'}</h4>
        <div className="mt-4 space-y-3">
          {faqs.map((faq, index) => (
            <div key={`faq-preview-${index}`} className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">{faq.question || 'FAQ question'}</p>
              <p className="mt-2 text-sm text-slate-600">{faq.answer || 'FAQ answer preview will appear here.'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-blue-700 p-5 text-white shadow-sm">
        <h4 className="text-xl font-bold">{content[`help_title_${suffix}`]}</h4>
        <p className="mt-2 text-sm text-blue-100">{content[`help_description_${suffix}`]}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {content.help_contacts.map((contact, index) => (
            <div key={`help-contact-preview-${index}`} className="rounded-xl bg-white/10 p-4">
              <p className="text-sm font-semibold">{contact[`label_${suffix}`] || 'Label'}</p>
              <p className="mt-1 text-sm text-blue-100">{contact.value || 'Value'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ContactPreview = ({ content, language }) => {
  const suffix = language === 'en' ? 'en' : 'tl';
  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Public Preview</p>
        <h3 className="mt-2 text-3xl font-black text-slate-900">{content[`page_title_${suffix}`]}</h3>
        <p className="mt-2 text-sm text-slate-500">{content[`page_subtitle_${suffix}`]}</p>
      </div>
      <div className="rounded-2xl bg-blue-700 p-6 text-white shadow-sm">
        <h4 className="text-2xl font-bold">{content[`main_office_title_${suffix}`]}</h4>
        <p className="mt-2 text-sm font-semibold text-blue-100">{content.office_name}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-sm font-semibold">{language === 'en' ? 'Address' : 'Tirahan'}</p>
            <div className="mt-2 space-y-1 text-sm text-blue-100">
              {content.address_lines.map((line, index) => <p key={`address-preview-${index}`}>{line || 'Address line'}</p>)}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-sm font-semibold">{language === 'en' ? 'Phone' : 'Telepono'}</p>
            <div className="mt-2 space-y-1 text-sm text-blue-100">
              {content.contact_numbers.map((line, index) => <p key={`phone-preview-${index}`}>{line || 'Contact number'}</p>)}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-sm font-semibold">Email</p>
            <div className="mt-2 space-y-1 text-sm text-blue-100">
              {content.email_addresses.map((line, index) => <p key={`email-preview-${index}`}>{line || 'Email address'}</p>)}
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-4">
            <p className="text-sm font-semibold">{language === 'en' ? 'Office Hours' : 'Oras ng Tanggapan'}</p>
            <div className="mt-2 space-y-1 text-sm text-blue-100">
              {content.office_hours.map((line, index) => <p key={`hours-preview-${index}`}>{line || 'Office hour entry'}</p>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PublicContentManagement = ({ portal = 'admin' }) => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [activePage, setActivePage] = useState(GUIDE_PAGE);
  const [previewLanguage, setPreviewLanguage] = useState('en');
  const [guideContent, setGuideContent] = useState(normalizeGuideContent());
  const [contactContent, setContactContent] = useState(normalizeContactContent());
  const [notice, setNotice] = useState({ tone: '', message: '' });
  const [savingPage, setSavingPage] = useState('');

  useEffect(() => {
    const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
    const adminRole = adminUser.internal_role || adminUser.role;
    const branchRole = branchUser.internal_role || branchUser.role;
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
        const [guideResponse, contactResponse] = await Promise.all([
          publicContentAPI.getTaxpayerGuideEditor(portal),
          publicContentAPI.getContactEditor(portal),
        ]);
        setGuideContent(normalizeGuideContent(guideResponse.data || {}));
        setContactContent(normalizeContactContent(contactResponse.data || {}));
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

  const publishGuide = async () => {
    try {
      setSavingPage('guide-publish');
      await publicContentAPI.publishTaxpayerGuide(guideContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'Taxpayer Guide published and synced to the public page.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to publish Taxpayer Guide.');
    } finally {
      setSavingPage('');
    }
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

  const publishContact = async () => {
    try {
      setSavingPage('contact-publish');
      await publicContentAPI.publishContact(contactContent, portal);
      notifyActivityLogsUpdated();
      showNotice('success', 'Contact page published and live on the public site.');
    } catch (error) {
      showNotice('error', error.response?.data?.detail || 'Failed to publish Contact page.');
    } finally {
      setSavingPage('');
    }
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

  const guidePageActions = (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={saveGuideDraft}
        disabled={Boolean(savingPage)}
        className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === 'guide-draft' ? 'Saving draft...' : 'Save Draft'}
      </button>
      <button
        type="button"
        onClick={publishGuide}
        disabled={Boolean(savingPage)}
        className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === 'guide-publish' ? 'Publishing...' : 'Publish Tax Payer Guide'}
      </button>
    </div>
  );

  const contactPageActions = (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={saveContactDraft}
        disabled={Boolean(savingPage)}
        className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === 'contact-draft' ? 'Saving draft...' : 'Save Draft'}
      </button>
      <button
        type="button"
        onClick={publishContact}
        disabled={Boolean(savingPage)}
        className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {savingPage === 'contact-publish' ? 'Publishing...' : 'Publish Contact Page'}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow={portal === 'admin' ? 'Super Admin Dashboard' : 'Branch Admin Dashboard'}
        title="Public Content Management"
        subtitle="Maintain the public-facing Tax Payer Guide and Contact pages with draft saving, live preview, and publish controls."
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActivePage(GUIDE_PAGE)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${activePage === GUIDE_PAGE ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            Tax Payer Guide Page
          </button>
          <button
            type="button"
            onClick={() => setActivePage(CONTACT_PAGE)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${activePage === CONTACT_PAGE ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            Contact Page
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-1">
          {['en', 'tl'].map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => setPreviewLanguage(language)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${previewLanguage === language ? 'bg-white text-primary shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {language}
            </button>
          ))}
        </div>
      </div>

      {notice.message ? (
        <div className={`rounded-2xl border px-5 py-4 text-sm font-semibold shadow-sm ${notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {notice.message}
        </div>
      ) : null}

      {activePage === GUIDE_PAGE ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Tax Payer Guide Editor</h2>
                <p className="text-sm text-slate-500">Update page copy, bilingual guides, FAQs, and the public help box.</p>
              </div>
              {guidePageActions}
            </div>

            <SectionCard title="Page Header" description="Control the hero title and supporting introduction shown on the public page.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="English Title"><input value={guideContent.page_title_en} onChange={(event) => updateGuideValue('page_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Tagalog Title"><input value={guideContent.page_title_tl} onChange={(event) => updateGuideValue('page_title_tl', event.target.value)} className={textInputClass} /></Field>
                <Field label="English Subtitle"><textarea value={guideContent.page_subtitle_en} onChange={(event) => updateGuideValue('page_subtitle_en', event.target.value)} className={textAreaClass} /></Field>
                <Field label="Tagalog Subtitle"><textarea value={guideContent.page_subtitle_tl} onChange={(event) => updateGuideValue('page_subtitle_tl', event.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <RepeaterCard
              title="Guides"
              description="Maintain English guide cards in their public display order."
              items={guideContent.guides_en}
              onChange={(index, field, value) => updateGuideListItem('guides_en', index, field, value)}
              onAdd={() => addGuideListItem('guides_en', makeGuideItem)}
              onRemove={(index) => removeGuideListItem('guides_en', index)}
              fields={[
                { key: 'title', label: 'Guide Title' },
                { key: 'category', label: 'Category' },
                { key: 'content', label: 'Content', multiline: true },
              ]}
            />

            <RepeaterCard
              title="Guides"
              description="Maintain Tagalog guide cards in their public display order."
              items={guideContent.guides_tl}
              onChange={(index, field, value) => updateGuideListItem('guides_tl', index, field, value)}
              onAdd={() => addGuideListItem('guides_tl', makeGuideItem)}
              onRemove={(index) => removeGuideListItem('guides_tl', index)}
              fields={[
                { key: 'title', label: 'Guide Title' },
                { key: 'category', label: 'Category' },
                { key: 'content', label: 'Content', multiline: true },
              ]}
            />

            <RepeaterCard
              title="FAQs"
              description="Keep English FAQs easy to scan and grouped by category."
              items={guideContent.faqs_en}
              onChange={(index, field, value) => updateGuideListItem('faqs_en', index, field, value)}
              onAdd={() => addGuideListItem('faqs_en', makeFaqItem)}
              onRemove={(index) => removeGuideListItem('faqs_en', index)}
              fields={[
                { key: 'question', label: 'Question' },
                { key: 'category', label: 'Category' },
                { key: 'answer', label: 'Answer', multiline: true },
              ]}
            />

            <RepeaterCard
              title="FAQs"
              description="Keep Tagalog FAQs aligned with the English public experience."
              items={guideContent.faqs_tl}
              onChange={(index, field, value) => updateGuideListItem('faqs_tl', index, field, value)}
              onAdd={() => addGuideListItem('faqs_tl', makeFaqItem)}
              onRemove={(index) => removeGuideListItem('faqs_tl', index)}
              fields={[
                { key: 'question', label: 'Question' },
                { key: 'category', label: 'Category' },
                { key: 'answer', label: 'Answer', multiline: true },
              ]}
            />

            <SectionCard title="Help Box" description="Configure the contact callout shown at the bottom of the guide page.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="English Help Title"><input value={guideContent.help_title_en} onChange={(event) => updateGuideValue('help_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Tagalog Help Title"><input value={guideContent.help_title_tl} onChange={(event) => updateGuideValue('help_title_tl', event.target.value)} className={textInputClass} /></Field>
                <Field label="English Help Description"><textarea value={guideContent.help_description_en} onChange={(event) => updateGuideValue('help_description_en', event.target.value)} className={textAreaClass} /></Field>
                <Field label="Tagalog Help Description"><textarea value={guideContent.help_description_tl} onChange={(event) => updateGuideValue('help_description_tl', event.target.value)} className={textAreaClass} /></Field>
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
                { key: 'label_en', label: 'English Label' },
                { key: 'label_tl', label: 'Tagalog Label' },
                { key: 'value', label: 'Displayed Value' },
              ]}
            />
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
              <p className="mt-1 text-sm text-slate-500">Review the public page before publishing.</p>
            </div>
            <GuidePreview content={guideContent} language={previewLanguage} />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Contact Page Editor</h2>
                <p className="text-sm text-slate-500">Maintain the main office section and the text framing the branch directory.</p>
              </div>
              {contactPageActions}
            </div>

            <SectionCard title="Page Header" description="Update the main hero copy used on the public Contact page.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="English Title"><input value={contactContent.page_title_en} onChange={(event) => updateContactValue('page_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Tagalog Title"><input value={contactContent.page_title_tl} onChange={(event) => updateContactValue('page_title_tl', event.target.value)} className={textInputClass} /></Field>
                <Field label="English Subtitle"><textarea value={contactContent.page_subtitle_en} onChange={(event) => updateContactValue('page_subtitle_en', event.target.value)} className={textAreaClass} /></Field>
                <Field label="Tagalog Subtitle"><textarea value={contactContent.page_subtitle_tl} onChange={(event) => updateContactValue('page_subtitle_tl', event.target.value)} className={textAreaClass} /></Field>
              </div>
            </SectionCard>

            <SectionCard title="Main Office Details" description="Manage the office information presented in the featured contact card.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="English Section Title"><input value={contactContent.main_office_title_en} onChange={(event) => updateContactValue('main_office_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Tagalog Section Title"><input value={contactContent.main_office_title_tl} onChange={(event) => updateContactValue('main_office_title_tl', event.target.value)} className={textInputClass} /></Field>
                <div className="md:col-span-2">
                  <Field label="Office Name"><input value={contactContent.office_name} onChange={(event) => updateContactValue('office_name', event.target.value)} className={textInputClass} /></Field>
                </div>
              </div>
            </SectionCard>

            <ArrayTextField label="Address Lines" values={contactContent.address_lines} onChange={(index, value) => updateContactArray('address_lines', index, value)} addLabel="Add Address Line" />
            <ArrayTextField label="Contact Numbers" values={contactContent.contact_numbers} onChange={(index, value) => updateContactArray('contact_numbers', index, value)} addLabel="Add Contact Number" />
            <ArrayTextField label="Email Addresses" values={contactContent.email_addresses} onChange={(index, value) => updateContactArray('email_addresses', index, value)} addLabel="Add Email Address" />
            <ArrayTextField label="Operating Hours" values={contactContent.office_hours} onChange={(index, value) => updateContactArray('office_hours', index, value)} addLabel="Add Operating Hours Entry" />

            <SectionCard title="Supporting Section Labels" description="Keep the branch directory and message form headings aligned with the public page.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Branch Section Title (English)"><input value={contactContent.branch_section_title_en} onChange={(event) => updateContactValue('branch_section_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Branch Section Title (Tagalog)"><input value={contactContent.branch_section_title_tl} onChange={(event) => updateContactValue('branch_section_title_tl', event.target.value)} className={textInputClass} /></Field>
                <Field label="Form Title (English)"><input value={contactContent.form_title_en} onChange={(event) => updateContactValue('form_title_en', event.target.value)} className={textInputClass} /></Field>
                <Field label="Form Title (Tagalog)"><input value={contactContent.form_title_tl} onChange={(event) => updateContactValue('form_title_tl', event.target.value)} className={textInputClass} /></Field>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Live Preview</h2>
              <p className="mt-1 text-sm text-slate-500">Check how the featured office information will appear publicly.</p>
            </div>
            <ContactPreview content={contactContent} language={previewLanguage} />
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicContentManagement;
