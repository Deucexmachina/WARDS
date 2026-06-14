import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { publicContentAPI } from '../../services/api';
import { buildAttachmentUrl } from '../../components/AnnouncementAttachments';
import ViewMyTicket from '../../components/ViewMyTicket';
import { appendLanguageParam, usePublicLanguage } from '../../utils/publicLanguage';

const announcementsPerPage = 5;

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const getExtension = (filename) => {
  const dot = (filename || '').lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

const isImageAttachment = (att) => {
  if (!att) return false;
  if ((att.mime_type || '').startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.includes(getExtension(att.filename));
};

const getFileKindLabel = (att) => {
  const ext = getExtension(att.filename).toUpperCase();
  return ext || 'FILE';
};

const getFileIcon = (att) => {
  const ext = getExtension(att.filename);
  const mime = att.mime_type || '';
  if (mime === 'application/pdf' || ext === 'pdf') {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
      </span>
    );
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-6h6v6m-9 4h12a2 2 0 002-2V7l-5-5H6a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
        </svg>
      </span>
    );
  }
  if (['doc', 'docx', 'txt'].includes(ext)) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h6m-6 4h10M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
        </svg>
      </span>
    );
  }
  if (['mp4', 'mov', 'webm'].includes(ext) || mime.startsWith('video/')) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
      </svg>
    </span>
  );
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const ImageGallery = ({ images, onImageClick }) => {
  if (!images || images.length === 0) return null;
  const visible = images.slice(0, 4);
  const extraCount = Math.max(0, images.length - visible.length);

  const renderTile = (att, index, options = {}) => {
    const isLastWithExtra = options.showOverlay && index === visible.length - 1 && extraCount > 0;
    return (
      <button
        key={att.id}
        type="button"
        onClick={() => onImageClick && onImageClick(att, index)}
        className={`group relative block w-full overflow-hidden rounded-xl bg-slate-100 ${options.className || ''}`}
        style={options.style}
        aria-label={`View image ${att.filename}`}
      >
        <img
          src={buildAttachmentUrl(att.preview_url || att.download_url)}
          alt={att.filename}
          loading="lazy"
          className="absolute inset-0 h-full w-full max-w-full object-cover transition duration-300 group-hover:scale-[1.02]"
        />
        {isLastWithExtra && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">
            +{extraCount}
          </div>
        )}
      </button>
    );
  };

  // 1 image: full-width 16:9
  if (visible.length === 1) {
    return (
      <div className="mt-4 max-w-full">
        <div className="relative w-full max-w-full overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
          {renderTile(visible[0], 0, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
        </div>
      </div>
    );
  }

  // 2 images: 2-col, each 16:9
  if (visible.length === 2) {
    return (
      <div className="mt-4 grid grid-cols-2 gap-2 max-w-full">
        {visible.map((att, idx) => (
          <div key={att.id} className="relative max-w-full" style={{ aspectRatio: '16 / 9' }}>
            {renderTile(att, idx, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
          </div>
        ))}
      </div>
    );
  }

  // 3 images: first full-width 16:9, then two below in 2 columns
  if (visible.length === 3) {
    return (
      <div className="mt-4 space-y-2 max-w-full">
        <div className="relative max-w-full" style={{ aspectRatio: '16 / 9' }}>
          {renderTile(visible[0], 0, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
        </div>
        <div className="grid grid-cols-2 gap-2 max-w-full">
          {visible.slice(1).map((att, idx) => (
            <div key={att.id} className="relative max-w-full" style={{ aspectRatio: '16 / 9' }}>
              {renderTile(att, idx + 1, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4 or more images: 2x2 with +N overlay on the last visible
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 max-w-full">
      {visible.map((att, idx) => (
        <div key={att.id} className="relative max-w-full" style={{ aspectRatio: '16 / 9' }}>
          {renderTile(att, idx, { className: 'h-full', showOverlay: true, style: { aspectRatio: '16 / 9' } })}
        </div>
      ))}
    </div>
  );
};

const FileAttachmentRow = ({ attachment }) => (
  <div className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 transition hover:border-slate-300 hover:bg-slate-100">
    {getFileIcon(attachment)}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-800" title={attachment.filename}>
        {attachment.filename}
      </p>
      <p className="text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide">{getFileKindLabel(attachment)}</span>
        {attachment.size ? <span> &middot; {formatBytes(attachment.size)}</span> : null}
      </p>
    </div>
    <div className="flex flex-shrink-0 items-center gap-1">
      {attachment.preview_url && (
        <a
          href={buildAttachmentUrl(attachment.preview_url)}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-accent"
          aria-label={`View ${attachment.filename}`}
          title="View"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
          </svg>
        </a>
      )}
      <a
        href={buildAttachmentUrl(attachment.download_url)}
        className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-primary"
        aria-label={`Download ${attachment.filename}`}
        title="Download"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"></path>
        </svg>
      </a>
    </div>
  </div>
);

const buildPaginationItems = (totalPages, activePage) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items = new Set([1, totalPages, activePage, activePage - 1, activePage + 1]);
  const sorted = Array.from(items)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const withGaps = [];
  sorted.forEach((page, idx) => {
    if (idx > 0 && page - sorted[idx - 1] > 1) {
      withGaps.push('ellipsis-' + idx);
    }
    withGaps.push(page);
  });
  return withGaps;
};

const Home = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [language] = usePublicLanguage();
  const [announcements, setAnnouncements] = useState([]);
  const [homeSettings, setHomeSettings] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showMfaPrompt, setShowMfaPrompt] = useState(false);
  const [mfaPromptLang, setMfaPromptLang] = useState(language);
  const [viewedIds, setViewedIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('wards_public_viewed_announcements') || '[]'));
    } catch {
      return new Set();
    }
  });

  const s = homeSettings;
  const isTl = language === 'tl';
  const heroText = {
    title: (isTl ? s?.hero_title_tl : s?.hero_title_en) || (isTl ? 'Maligayang Pagdating sa Online Tax Services' : 'Welcome to Online Tax Services'),
    subtitle: (isTl ? s?.hero_subtitle_tl : s?.hero_subtitle_en) || (isTl ? 'Magbayad ng iyong buwis online at humingi ng opisyal na resibo sa pamamagitan ng aming ligtas at maaasahang government portal.' : 'Pay your taxes online and request official receipts through our secure government portal.'),
    getQueueNumber: (isTl ? s?.btn_get_queue_tl : s?.btn_get_queue_en) || (isTl ? 'Kumuha ng Queue Number' : 'Get Queue Number'),
    viewMyTicket: (isTl ? s?.btn_view_ticket_tl : s?.btn_view_ticket_en) || (isTl ? 'Tingnan ang Aking Ticket' : 'View My Ticket'),
    payTaxesOnline: (isTl ? s?.btn_pay_taxes_tl : s?.btn_pay_taxes_en) || (isTl ? 'Magbayad ng Buwis Online' : 'Pay Taxes Online'),
    requestReceipt: (isTl ? s?.btn_request_receipt_tl : s?.btn_request_receipt_en) || (isTl ? 'Humiling ng Resibo' : 'Request Receipt'),
    latestAnnouncements: (isTl ? s?.announcements_title_tl : s?.announcements_title_en) || (isTl ? 'Mga Pinakabagong Anunsyo' : 'Latest Announcements'),
    latestAnnouncementsSubtitle: (isTl ? s?.announcements_subtitle_tl : s?.announcements_subtitle_en) || (isTl ? "Manatiling updated sa mahahalagang anunsyo at abiso mula sa City Treasurer's Office." : "Stay updated with important notices from the City Treasurer's Office."),
  };

  useEffect(() => {
    fetchAnnouncements();
    publicContentAPI.getPublicHome()
      .then((res) => setHomeSettings(res.data || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('modal') === 'ticket') {
      setShowTicketModal(true);
    }
  }, [searchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [announcements.length]);

  useEffect(() => {
    const shouldPrompt = sessionStorage.getItem('wards:publicMfaPrompt') === 'true';
    if (shouldPrompt) {
      setShowMfaPrompt(true);
      sessionStorage.removeItem('wards:publicMfaPrompt');
    }
  }, []);

  useEffect(() => {
    if (showMfaPrompt) {
      setMfaPromptLang(language);
    }
  }, [showMfaPrompt, language]);

  const handleDismissMfaPrompt = () => {
    setShowMfaPrompt(false);
  };

  const handleStartMfaSetup = () => {
    setShowMfaPrompt(false);
    navigate('/account-management?mfaSetup=1');
  };

  const fetchAnnouncements = async () => {
    try {
      const response = await api.get('/public/announcements');
      setAnnouncements(response.data || []);
    } catch (error) {
      console.error('Failed to fetch announcements:', error);
    }
  };

  const getIconPath = (iconType) => {
    const icons = {
      megaphone: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
      check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
      info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    };
    return icons[iconType] || icons.megaphone;
  };

  const getIconColorClass = (color) => {
    const colors = {
      blue: { bg: 'bg-blue-100', text: 'text-primary' },
      green: { bg: 'bg-green-100', text: 'text-green-600' },
      yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
      red: { bg: 'bg-red-100', text: 'text-red-600' }
    };
    return colors[color] || colors.blue;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const totalPages = Math.max(1, Math.ceil(announcements.length / announcementsPerPage));
  const activePage = Math.min(currentPage, totalPages);
  const paginatedAnnouncements = announcements.slice(
    (activePage - 1) * announcementsPerPage,
    activePage * announcementsPerPage
  );
  const paginationItems = useMemo(() => buildPaginationItems(totalPages, activePage), [totalPages, activePage]);
  const modalImages = useMemo(
    () => (selectedAnnouncement?.attachments || []).filter(isImageAttachment),
    [selectedAnnouncement]
  );
  const modalFiles = useMemo(
    () => (selectedAnnouncement?.attachments || []).filter((att) => !isImageAttachment(att)),
    [selectedAnnouncement]
  );

  const closeAnnouncementModal = () => {
    setSelectedAnnouncement(null);
  };

  const closeTicketModal = () => {
    setShowTicketModal(false);
    if (searchParams.get('modal') === 'ticket') {
      navigate(appendLanguageParam('/', language), { replace: true });
    }
  };

  const markViewed = (announcementId) => {
    setViewedIds((prev) => {
      if (prev.has(announcementId)) return prev;
      const next = new Set(prev);
      next.add(announcementId);
      localStorage.setItem('wards_public_viewed_announcements', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  return (
    <>
      {/* ── Hero ── */}
      <section
        className="relative min-h-[520px] flex items-center bg-cover bg-center bg-no-repeat overflow-hidden"
        style={{ backgroundImage: homeSettings?.hero_bg_image ? `url('${homeSettings.hero_bg_image}')` : "url('/Images/hero-bg.jpg')" }}
      >
        {/* Dark base overlay */}
        <div className="absolute inset-0 bg-primary/80"></div>


        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-5">
            <span className="h-px w-8 bg-blue-400 opacity-70"></span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              City Treasurer&rsquo;s Office
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-5 max-w-3xl">
            {heroText.title}
          </h1>
          <p className="text-blue-200/90 text-base sm:text-lg mb-10 max-w-xl leading-relaxed">
            {heroText.subtitle}
          </p>

          {/* Action buttons — 2×2 on mobile, 4-col on md+ */}
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
            <Link
              to="/get-queue"
              className="group relative flex flex-col items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 backdrop-blur-sm px-4 py-5 text-white transition duration-200 text-center"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/90 group-hover:bg-secondary transition duration-200 shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                </svg>
              </span>
              <span className="text-sm font-semibold leading-tight">{heroText.getQueueNumber}</span>
            </Link>

            <button
              onClick={() => setShowTicketModal(true)}
              className="group relative flex flex-col items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 backdrop-blur-sm px-4 py-5 text-white transition duration-200 text-center"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/80 group-hover:bg-accent transition duration-200 shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path>
                </svg>
              </span>
              <span className="text-sm font-semibold leading-tight">{heroText.viewMyTicket}</span>
            </button>

            <Link
              to="/pay-taxes"
              className="group relative flex flex-col items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 backdrop-blur-sm px-4 py-5 text-white transition duration-200 text-center"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/80 group-hover:bg-primary transition duration-200 shadow-lg border border-white/10">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
                </svg>
              </span>
              <span className="text-sm font-semibold leading-tight">{heroText.payTaxesOnline}</span>
            </Link>

            <Link
              to="/request-receipt"
              className="group relative flex flex-col items-center gap-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 backdrop-blur-sm px-4 py-5 text-white transition duration-200 text-center"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/80 group-hover:bg-accent transition duration-200 shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </span>
              <span className="text-sm font-semibold leading-tight">{heroText.requestReceipt}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Announcements ── */}
      <section className="py-10 bg-lightbg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Section header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent mb-0.5">Updates</p>
              <h2 className="text-2xl font-extrabold text-primary leading-none">{heroText.latestAnnouncements}</h2>
            </div>
            <p className="hidden sm:block text-xs text-slate-400 text-right max-w-[200px] leading-relaxed">
              {heroText.latestAnnouncementsSubtitle}
            </p>
          </div>

          {announcements.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 mx-auto mb-2">
                <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </span>
              <p className="text-sm font-medium text-slate-400">No announcements at this time.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {paginatedAnnouncements.map((announcement) => {
                const colorClass = getIconColorClass(announcement.icon_color);
                const attachments = announcement.attachments || [];
                const imageAttachments = attachments.filter(isImageAttachment);
                const fileAttachments = attachments.filter((att) => !isImageAttachment(att));
                const sourceName = announcement.branch_name || 'Main Admin';
                const isBranch = !!announcement.branch_name;

                return (
                  <article
                    key={announcement.id}
                    className={`group flex items-start gap-4 rounded-xl border bg-white p-4 hover:border-primary/25 hover:shadow-sm transition-all duration-200 cursor-pointer ${
                      viewedIds.has(announcement.id) ? 'border-slate-100' : 'border-blue-500'
                    }`}
                    onClick={() => {
                      markViewed(announcement.id);
                      setSelectedAnnouncement(announcement);
                    }}
                  >
                    {/* Icon */}
                    <div className={`${colorClass.bg} flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg`}>
                      <svg className={`h-5 w-5 ${colorClass.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(announcement.icon_type)} />
                      </svg>
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-600 truncate">{sourceName}</span>
                        <span className="text-slate-300">·</span>
                        <time className="text-xs text-slate-400 flex-shrink-0" dateTime={announcement.publish_date}>
                          {formatDate(announcement.publish_date)}
                        </time>
                        {!viewedIds.has(announcement.id) && (
                          <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-blue-500" aria-label="Unread" />
                        )}
                        <span className={`ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          isBranch ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                        }`}>
                          {isBranch ? 'Branch' : 'Office-wide'}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-800 leading-snug mb-1 group-hover:text-primary transition-colors duration-200">
                        {announcement.title}
                      </h3>
                      <p className="text-sm leading-relaxed text-slate-500 line-clamp-2">
                        {announcement.content}
                      </p>

                      {imageAttachments.length > 0 && (
                        <div className="mt-2 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                          <img
                            src={buildAttachmentUrl(imageAttachments[0].preview_url || imageAttachments[0].download_url)}
                            alt={imageAttachments[0].filename}
                            className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                            loading="lazy"
                          />
                          {imageAttachments.length > 1 && (
                            <span className="text-xs font-medium text-slate-400">
                              +{imageAttachments.length - 1} more image{imageAttachments.length > 2 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      )}
                      {fileAttachments.length > 0 && (
                        <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                          {fileAttachments.map((att) => <FileAttachmentRow key={att.id} attachment={att} />)}
                        </div>
                      )}
                    </div>

                    {/* Chevron */}
                    <div className="flex-shrink-0 self-center text-slate-300 group-hover:text-primary transition-colors duration-200">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {announcements.length > announcementsPerPage && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <nav className="inline-flex items-center gap-1" aria-label="Announcements pagination">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={activePage === 1}
                  className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-slate-500 transition hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                  <span className="hidden sm:inline">Prev</span>
                </button>
                {paginationItems.map((item) => {
                  if (typeof item === 'string') {
                    return (
                      <span key={item} className="flex h-8 w-8 items-center justify-center text-xs text-slate-300" aria-hidden>
                        &hellip;
                      </span>
                    );
                  }
                  const isActive = activePage === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCurrentPage(item)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`h-8 min-w-[2rem] rounded-full px-2 text-xs font-bold transition ${
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-500 hover:bg-white hover:shadow-sm'
                      }`}
                    >
                      {item}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={activePage === totalPages}
                  className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-slate-500 transition hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <span className="hidden sm:inline">Next</span>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </nav>
              <p className="text-[11px] text-slate-400">
                {(activePage - 1) * announcementsPerPage + 1}–{Math.min(activePage * announcementsPerPage, announcements.length)} of {announcements.length}
              </p>
            </div>
          )}
        </div>
      </section>

      {selectedAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl min-w-0 max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Latest Announcement
                </p>
                <h3 className="mt-2 text-2xl font-bold text-primary break-words">
                  {selectedAnnouncement.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAnnouncementModal}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition duration-300"
                aria-label="Close announcement details"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="px-6 py-6 overflow-x-hidden">
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {formatDate(selectedAnnouncement.publish_date)}
                </span>
                {selectedAnnouncement.branch_name ? (
                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    From {selectedAnnouncement.branch_name}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    Main Admin
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-5 py-5">
                <p className="whitespace-pre-line break-words text-base leading-7 text-slate-700">
                  {selectedAnnouncement.content}
                </p>
                {modalImages.length > 0 && (
                  <ImageGallery images={modalImages} onImageClick={(att) => window.open(buildAttachmentUrl(att.preview_url || att.download_url), '_blank', 'noopener')} />
                )}
                {modalFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {modalFiles.map((att) => (
                      <FileAttachmentRow key={att.id} attachment={att} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={closeAnnouncementModal}
                className="w-full rounded-lg bg-primary px-5 py-3 font-semibold text-white hover:bg-secondary transition duration-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showTicketModal && (
        <ViewMyTicket onClose={closeTicketModal} />
      )}

      {/* MFA Prompt Modal */}
      {showMfaPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              {mfaPromptLang === 'en' ? 'Account Security' : 'Seguridad ng Account'}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              {mfaPromptLang === 'en'
                ? 'Set Up Multi-Factor Authentication?'
                : 'Mag-set up ng Multi-Factor Authentication?'}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {mfaPromptLang === 'en'
                ? 'MFA adds extra security to your account. If enabled, future logins will require your email/password and a 6-digit code from Microsoft Authenticator.'
                : 'Ang MFA ay dagdag na proteksyon para sa iyong account. Kapag naka-enable, kakailanganin ang email/password at 6-digit code mula sa Microsoft Authenticator sa susunod na login.'}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleDismissMfaPrompt}
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Maybe Later
              </button>
              <button
                type="button"
                onClick={handleStartMfaSetup}
                className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]"
              >
                Set Up MFA
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setMfaPromptLang((prev) => (prev === 'en' ? 'tl' : 'en'))}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                {mfaPromptLang === 'en' ? 'Translate to Tagalog' : 'Translate to English'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Home;
