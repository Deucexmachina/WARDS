import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { formatUtc8Date, formatUtc8Time, isSameUtc8Day } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { UNREAD_CARD_HIGHLIGHT_CLASS, UNREAD_STATUS_BADGE_CLASS } from '../../utils/notificationUI';

const CATEGORY_STYLES = {
  Operations: 'bg-blue-100 text-blue-700',
  Security: 'bg-red-100 text-red-700',
  Service: 'bg-emerald-100 text-emerald-700',
  Compliance: 'bg-amber-100 text-amber-700',
  'System Configuration Updates': 'bg-violet-100 text-violet-700',
  'Branch Appointment Schedule Updates': 'bg-sky-100 text-sky-700',
};
const CONFIG_POLICY_CATEGORIES = new Set(['System Configuration Updates', 'Branch Appointment Schedule Updates']);

const POLICY_PREVIEW_LENGTH = 100;
const POLICY_MODAL_PREVIEW_LENGTH = 720;
const POLICIES_PER_PAGE = 5;

const formatDateLabel = (value) => formatUtc8Date(value);
const formatTimeLabel = (value) => formatUtc8Time(value, 'en-US', { second: undefined });

const buildMetaRows = (policy) => ([
  { label: 'Published', value: `${formatDateLabel(policy?.created_at)} · ${formatTimeLabel(policy?.created_at)}` },
  { label: 'Last Updated', value: `${formatDateLabel(policy?.updated_at)} · ${formatTimeLabel(policy?.updated_at)}` },
  { label: 'Issued By', value: policy?.author || 'Main Office' },
]);

const BranchPolicies = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingPolicy, setViewingPolicy] = useState(null);
  const [isViewingFullContent, setIsViewingFullContent] = useState(false);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/branch/policies');
      setPolicies(response.data || []);
    } catch (fetchError) {
      console.error('Failed to load branch policies:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load published policies and SOPs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const filteredPolicies = useMemo(() => {
    if (!searchQuery.trim()) {
      return policies;
    }

    const query = searchQuery.toLowerCase();
    return policies.filter((policy) =>
      [policy.title, policy.category, policy.content, policy.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [policies, searchQuery]);

  const summary = useMemo(() => ({
    total: policies.length,
    categories: new Set(policies.map((policy) => policy.category).filter(Boolean)).size,
    updatedToday: policies.filter((policy) => {
      return isSameUtc8Day(policy.updated_at);
    }).length,
    configurationUpdates: policies.filter((policy) => policy.category === 'System Configuration Updates').length,
  }), [policies]);

  const totalPages = Math.max(1, Math.ceil(filteredPolicies.length / POLICIES_PER_PAGE));
  const paginatedPolicies = filteredPolicies.slice(
    (currentPage - 1) * POLICIES_PER_PAGE,
    currentPage * POLICIES_PER_PAGE,
  );
  const visibleStart = filteredPolicies.length ? ((currentPage - 1) * POLICIES_PER_PAGE) + 1 : 0;
  const visibleEnd = filteredPolicies.length
    ? Math.min(currentPage * POLICIES_PER_PAGE, filteredPolicies.length)
    : 0;

  const openViewModal = async (policy) => {
    setViewingPolicy(policy);
    setIsViewingFullContent(false);
    setShowViewModal(true);
    if (!policy.is_viewed) {
      try {
        await api.post(`/branch/policies/${policy.id}/mark-viewed`);
        let unreadCount = 0;
        setPolicies((currentPolicies) => {
          const nextPolicies = currentPolicies.map((item) => (
            item.id === policy.id ? { ...item, is_viewed: true } : item
          ));
          unreadCount = nextPolicies.filter((item) => !item.is_viewed).length;
          return nextPolicies;
        });
        window.dispatchEvent(new CustomEvent('branch-policy-read', { detail: { unreadCount } }));
      } catch (error) {
        console.error('Failed to mark branch policy as viewed:', error);
      }
    }
  };

  const closeViewModal = () => {
    setShowViewModal(false);
    setViewingPolicy(null);
    setIsViewingFullContent(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading published policies and SOPs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Policies & SOPs"
        subtitle="View published policies and operating procedures issued by the main admin office."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-gray-500">Published Policies</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.total}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-gray-500">Categories</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.categories}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-gray-500">Updated Today</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.updatedToday}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-gray-500">Configuration Updates</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.configurationUpdates}</p>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow">
        <div className="flex flex-col gap-4 border-b border-gray-100 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <h2 className="text-xl font-bold text-primary">Policy Directory</h2>
            <p className="mt-1 text-sm text-gray-500">Browse the latest policies and SOPs published by the main admin office.</p>
          </div>
          <div className="w-full md:max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search title, category, content, or author"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-700 outline-none transition focus:border-accent focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:mx-6">
            {error}
          </div>
        )}

        <div className="p-5 md:p-6">
          {filteredPolicies.length ? (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
                <span className="text-slate-500">Visible: <strong className="text-primary">{filteredPolicies.length}</strong></span>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span className="text-slate-500">Per page: <strong className="text-primary">{POLICIES_PER_PAGE}</strong></span>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span className="text-slate-500">Page: <strong className="text-primary">{currentPage} / {totalPages}</strong></span>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {paginatedPolicies.map((policy) => {
                const metaRows = buildMetaRows(policy);
                const previewContent = policy.content || 'No content available.';
                const isPreviewTruncated = previewContent.length > POLICY_PREVIEW_LENGTH;
                const isUnread = !policy.is_viewed;
                const showNewBadge = isUnread && CONFIG_POLICY_CATEGORIES.has(policy.category);

                return (
                  <article key={policy.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-300 hover:shadow-md ${isUnread ? UNREAD_CARD_HIGHLIGHT_CLASS : showNewBadge ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}>
                    <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CATEGORY_STYLES[policy.category] || 'bg-slate-200 text-slate-700'}`}>
                          {policy.category || 'Uncategorized'}
                        </span>
                        {isUnread ? (
                          <span className={UNREAD_STATUS_BADGE_CLASS}>Unread</span>
                        ) : null}
                        {showNewBadge ? (
                          <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">New</span>
                        ) : null}
                        <span className="ml-auto text-xs text-slate-400">{formatDateLabel(policy.created_at)} · {formatTimeLabel(policy.created_at)}</span>
                      </div>
                      <h3 className="text-base font-bold text-primary leading-snug">{policy.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {isPreviewTruncated
                          ? `${previewContent.slice(0, POLICY_PREVIEW_LENGTH)}...`
                          : previewContent}
                      </p>
                    </div>

                    <div className="space-y-4 px-5 py-4">
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {metaRows.map((row) => (
                          <div key={`${policy.id}-${row.label}`} className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="font-semibold uppercase tracking-wide text-slate-400">{row.label}:</span>
                            <span className="font-medium text-slate-700">{row.value}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <div className="text-xs text-slate-400">
                          {isPreviewTruncated ? 'Preview shortened for readability.' : 'Full summary shown.'}
                        </div>
                        <button
                          onClick={() => openViewModal(policy)}
                          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition duration-300 hover:bg-secondary"
                        >
                          Preview Details
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              </div>

              <div className="mt-6 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-600">
                    Showing {visibleStart}-{visibleEnd} of {filteredPolicies.length} publications
                  </p>
                  <p className="text-xs text-slate-400">
                    Page {currentPage} of {totalPages}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                    disabled={currentPage <= 1}
                    className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                    disabled={currentPage >= totalPages}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
              <h3 className="text-lg font-semibold text-primary">No matching policies found</h3>
              <p className="mt-2 text-sm text-slate-500">Try a different keyword or check back for newly published policies.</p>
            </div>
          )}
        </div>
      </section>

      {showViewModal && viewingPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-6 md:px-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CATEGORY_STYLES[viewingPolicy.category] || 'bg-slate-200 text-slate-700'}`}>
                      {viewingPolicy.category || 'Uncategorized'}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Policy Details</span>
                  </div>
                  <h3 className="mt-4 text-2xl md:text-3xl font-bold text-primary leading-tight">{viewingPolicy.title}</h3>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 border border-slate-100">
                  <p className="font-semibold text-primary">Issued By</p>
                  <p className="mt-1">{viewingPolicy.author || 'Main Office'}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 px-6 py-6 md:px-8 lg:grid-cols-[1.5fr_0.9fr]">
              <section className="rounded-3xl border border-slate-100 bg-slate-50 p-5 md:p-6">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Content</p>
                  {((viewingPolicy.content || '').length > POLICY_MODAL_PREVIEW_LENGTH) && (
                    <button
                      onClick={() => setIsViewingFullContent((previous) => !previous)}
                      className="text-sm font-semibold text-accent transition duration-300 hover:text-primary"
                    >
                      {isViewingFullContent ? 'Show Less' : 'See More'}
                    </button>
                  )}
                </div>
                <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {(() => {
                    const content = viewingPolicy.content || 'No policy content available.';
                    if (isViewingFullContent || content.length <= POLICY_MODAL_PREVIEW_LENGTH) {
                      return content;
                    }
                    return `${content.slice(0, POLICY_MODAL_PREVIEW_LENGTH)}...`;
                  })()}
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Publication Details</p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Published</p>
                      <p className="mt-1.5 text-sm font-medium text-slate-700">{formatDateLabel(viewingPolicy.created_at)} · {formatTimeLabel(viewingPolicy.created_at)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Last Updated</p>
                      <p className="mt-1.5 text-sm font-medium text-slate-700">{formatDateLabel(viewingPolicy.updated_at)} · {formatTimeLabel(viewingPolicy.updated_at)}</p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 md:flex-row md:justify-end md:px-8">
              <button
                onClick={closeViewModal}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchPolicies;
