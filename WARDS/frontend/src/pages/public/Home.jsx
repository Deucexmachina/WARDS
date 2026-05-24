import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { buildAttachmentUrl } from '../../components/AnnouncementAttachments';

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
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
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
      <div className="mt-4">
        <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
          {renderTile(visible[0], 0, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
        </div>
      </div>
    );
  }

  // 2 images: 2-col, each 16:9
  if (visible.length === 2) {
    return (
      <div className="mt-4 grid grid-cols-2 gap-2">
        {visible.map((att, idx) => (
          <div key={att.id} className="relative" style={{ aspectRatio: '16 / 9' }}>
            {renderTile(att, idx, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
          </div>
        ))}
      </div>
    );
  }

  // 3 images: first full-width 16:9, then two below in 2 columns
  if (visible.length === 3) {
    return (
      <div className="mt-4 space-y-2">
        <div className="relative" style={{ aspectRatio: '16 / 9' }}>
          {renderTile(visible[0], 0, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {visible.slice(1).map((att, idx) => (
            <div key={att.id} className="relative" style={{ aspectRatio: '16 / 9' }}>
              {renderTile(att, idx + 1, { className: 'h-full', style: { aspectRatio: '16 / 9' } })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4 or more images: 2x2 with +N overlay on the last visible
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {visible.map((att, idx) => (
        <div key={att.id} className="relative" style={{ aspectRatio: '16 / 9' }}>
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
  const [announcements, setAnnouncements] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [announcements.length]);

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

  return (
    <>
      <section className="bg-gradient-to-br from-primary to-secondary py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Welcome to Online Tax Services
          </h1>
          <p className="text-blue-200 text-lg md:text-xl mb-8 max-w-3xl mx-auto">
            Pay your taxes online and request official receipts through our secure government portal.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/get-queue"
              className="bg-purple-500 text-white hover:bg-purple-600 px-8 py-4 rounded-lg font-semibold shadow-lg transition duration-300 inline-flex items-center"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
              </svg>
              Get Queue Number
            </Link>
            <Link
              to="/pay-taxes"
              className="bg-green-500 text-white hover:bg-green-600 px-8 py-4 rounded-lg font-semibold shadow-lg transition duration-300 inline-flex items-center"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
              </svg>
              Pay Taxes Online
            </Link>
            <Link
              to="/request-receipt"
              className="bg-accent text-white hover:bg-blue-600 px-8 py-4 rounded-lg font-semibold shadow-lg transition duration-300 inline-flex items-center"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              Request Receipt
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 bg-lightbg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-primary mb-3">Latest Announcements</h2>
            <p className="text-gray-600">Stay updated with important notices from the City Treasurer's Office</p>
          </div>

          {announcements.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
              <p className="text-gray-500">No announcements at this time.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {paginatedAnnouncements.map((announcement) => {
                const colorClass = getIconColorClass(announcement.icon_color);
                const attachments = announcement.attachments || [];
                const imageAttachments = attachments.filter(isImageAttachment);
                const fileAttachments = attachments.filter((att) => !isImageAttachment(att));
                const sourceName = announcement.branch_name || "Main Admin";
                const sourceSubtitle = announcement.branch_name ? 'Branch advisory' : 'Office-wide update';
                return (
                  <article
                    key={announcement.id}
                    className="rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition duration-300"
                  >
                    {/* Header */}
                    <header className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`${colorClass.bg} flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full`}>
                          <svg className={`w-5 h-5 ${colorClass.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(announcement.icon_type)}></path>
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{sourceName}</p>
                          <p className="text-xs text-slate-500">
                            <span>{sourceSubtitle}</span>
                            <span className="mx-1.5 text-slate-300">&middot;</span>
                            <time dateTime={announcement.publish_date}>{formatDate(announcement.publish_date)}</time>
                          </p>
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          announcement.branch_name
                            ? 'border border-blue-100 bg-blue-50 text-blue-700'
                            : 'border border-slate-100 bg-slate-50 text-slate-600'
                        }`}
                      >
                        {announcement.branch_name ? 'Branch' : 'Main Admin'}
                      </span>
                    </header>

                    {/* Content */}
                    <div className="px-5 sm:px-6 pt-4">
                      <h3 className="text-xl sm:text-2xl font-bold text-primary leading-snug mb-2">
                        {announcement.title}
                      </h3>
                      <p className="whitespace-pre-line text-[15px] leading-7 text-slate-700">
                        {announcement.content}
                      </p>
                    </div>

                    {/* Image gallery */}
                    {imageAttachments.length > 0 && (
                      <div className="px-5 sm:px-6">
                        <ImageGallery
                          images={imageAttachments}
                          onImageClick={() => setSelectedAnnouncement(announcement)}
                        />
                      </div>
                    )}

                    {/* File attachments */}
                    {fileAttachments.length > 0 && (
                      <div className="px-5 sm:px-6 mt-4 space-y-2">
                        {fileAttachments.map((att) => (
                          <FileAttachmentRow key={att.id} attachment={att} />
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <footer className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 px-5 sm:px-6 py-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        {sourceSubtitle}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedAnnouncement(announcement)}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-accent transition hover:bg-blue-50 hover:text-blue-700"
                      >
                        Read more
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}

          {announcements.length > announcementsPerPage && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <nav className="inline-flex items-center gap-1.5" aria-label="Announcements pagination">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={activePage === 1}
                  className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  aria-label="Previous page"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
                  </svg>
                  <span className="hidden sm:inline">Previous</span>
                </button>
                {paginationItems.map((item) => {
                  if (typeof item === 'string') {
                    return (
                      <span key={item} className="flex h-9 w-9 items-center justify-center text-sm text-slate-400" aria-hidden>
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
                      className={`h-9 min-w-[2.25rem] rounded-full px-2 text-sm font-semibold transition ${
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100'
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
                  className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  aria-label="Next page"
                >
                  <span className="hidden sm:inline">Next</span>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
                  </svg>
                </button>
              </nav>
              <p className="text-xs text-slate-500">
                Showing {(activePage - 1) * announcementsPerPage + 1}-{Math.min(activePage * announcementsPerPage, announcements.length)} of {announcements.length}
              </p>
            </div>
          )}
        </div>
      </section>

      {selectedAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Latest Announcement
                </p>
                <h3 className="mt-2 text-2xl font-bold text-primary">
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

            <div className="px-6 py-6">
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
                <p className="whitespace-pre-line text-base leading-7 text-slate-700">
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
    </>
  );
};

export default Home;
