import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../../services/api';

const announcementsPerPage = 3;

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-primary mb-4">Latest Announcements</h2>
            <p className="text-gray-600">Stay updated with important notices from the City Treasurer's Office</p>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {announcements.length === 0 ? (
              <div className="md:col-span-2 xl:col-span-3 text-center py-12">
                <p className="text-gray-500">No announcements at this time.</p>
              </div>
            ) : (
              paginatedAnnouncements.map((announcement) => {
                const colorClass = getIconColorClass(announcement.icon_color);
                return (
                  <div key={announcement.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition duration-300 border border-slate-100">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center">
                        <div className={`${colorClass.bg} p-3 rounded-full`}>
                          <svg className={`w-6 h-6 ${colorClass.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(announcement.icon_type)}></path>
                          </svg>
                        </div>
                        <div className="ml-4">
                          <span className="text-xs text-gray-500">{formatDate(announcement.publish_date)}</span>
                        </div>
                      </div>
                      {announcement.branch_name ? (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          From {announcement.branch_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                          Main Admin
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-bold text-primary mb-3">{announcement.title}</h3>
                    <p className="text-gray-600 mb-4">{announcement.content}</p>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-gray-500">
                        {announcement.branch_name ? 'Branch advisory' : 'Office-wide update'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedAnnouncement(announcement)}
                        className="flex items-center text-accent font-semibold hover:text-blue-700 transition duration-300"
                      >
                        <span className="text-sm">Read more</span>
                        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {announcements.length > announcementsPerPage && (
            <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-gray-500">
                Showing {(activePage - 1) * announcementsPerPage + 1}-{Math.min(activePage * announcementsPerPage, announcements.length)} of {announcements.length} announcements
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={activePage === 1}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-10 h-10 rounded-lg font-semibold transition ${
                      activePage === page
                        ? 'bg-primary text-white shadow'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={activePage === totalPages}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
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
