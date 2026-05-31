import { useEffect, useMemo, useState } from 'react';
import { policyAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8Time, isSameUtc8Day } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { UNREAD_CARD_HIGHLIGHT_CLASS, UNREAD_STATUS_BADGE_CLASS } from '../../utils/notificationUI';

const POLICY_PREVIEW_LENGTH = 180;
const POLICY_MODAL_PREVIEW_LENGTH = 720;
const POLICIES_PER_PAGE = 5;

const CATEGORY_STYLES = {
  Operations: 'bg-blue-100 text-blue-700',
  Security: 'bg-red-100 text-red-700',
  Service: 'bg-emerald-100 text-emerald-700',
  Compliance: 'bg-amber-100 text-amber-700',
  'System Configuration Updates': 'bg-violet-100 text-violet-700',
};
const CONFIG_POLICY_CATEGORIES = new Set(['System Configuration Updates', 'Branch Appointment Schedule Updates']);

const EMPTY_FORM = {
  title: '',
  category: '',
  content: '',
};

const formatDateLabel = (value) => formatUtc8Date(value);
const formatTimeLabel = (value) => formatUtc8Time(value);

const buildMetaRows = (policy) => ([
  { label: 'Date Published', value: formatDateLabel(policy?.created_at) },
  { label: 'Time Published', value: formatTimeLabel(policy?.created_at) },
  { label: 'Last Updated Date', value: formatDateLabel(policy?.updated_at) },
  { label: 'Last Updated Time', value: formatTimeLabel(policy?.updated_at) },
  { label: 'Issued By', value: policy?.author || 'Main Office' },
]);

const getPreviewParagraphs = (content) => {
  const normalized = (content || 'No content available.').trim();
  const shortened = normalized.length > POLICY_PREVIEW_LENGTH
    ? `${normalized.slice(0, POLICY_PREVIEW_LENGTH)}...`
    : normalized;

  return shortened.split('\n').filter(Boolean).slice(0, 3);
};

const Policies = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [viewingPolicy, setViewingPolicy] = useState(null);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [policyToDelete, setPolicyToDelete] = useState(null);
  const [isViewingFullContent, setIsViewingFullContent] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await policyAPI.getAll();
      setPolicies(response.data || []);
    } catch (fetchError) {
      console.error('Failed to load policies:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load policies and SOPs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter]);

  const categories = useMemo(
    () => Array.from(new Set(policies.map((policy) => policy.category).filter(Boolean))).sort(),
    [policies],
  );

  const filteredPolicies = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return policies.filter((policy) => {
      const matchesQuery = !normalizedQuery || [policy.title, policy.category, policy.content, policy.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesCategory = !categoryFilter || policy.category === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [policies, searchQuery, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPolicies.length / POLICIES_PER_PAGE));
  const paginatedPolicies = filteredPolicies.slice(
    (currentPage - 1) * POLICIES_PER_PAGE,
    currentPage * POLICIES_PER_PAGE,
  );
  const visibleStart = filteredPolicies.length ? ((currentPage - 1) * POLICIES_PER_PAGE) + 1 : 0;
  const visibleEnd = filteredPolicies.length
    ? Math.min(currentPage * POLICIES_PER_PAGE, filteredPolicies.length)
    : 0;

  const summary = useMemo(() => ({
    total: policies.length,
    categories: new Set(policies.map((policy) => policy.category).filter(Boolean)).size,
    updatedToday: policies.filter((policy) => {
      return isSameUtc8Day(policy.updated_at);
    }).length,
    configurationUpdates: policies.filter((policy) => policy.category === 'System Configuration Updates').length,
  }), [policies]);

  const closeViewModal = () => {
    setShowViewModal(false);
    setViewingPolicy(null);
    setIsViewingFullContent(false);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingPolicy(null);
    setFormData(EMPTY_FORM);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setPolicyToDelete(null);
  };

  const openViewModal = async (policy) => {
    setViewingPolicy(policy);
    setIsViewingFullContent(false);
    setShowViewModal(true);
    if (!policy.is_viewed) {
      try {
        await policyAPI.markViewed(policy.id);
        let unreadCount = 0;
        setPolicies((currentPolicies) => {
          const nextPolicies = currentPolicies.map((item) => (
            item.id === policy.id ? { ...item, is_viewed: true } : item
          ));
          unreadCount = nextPolicies.filter((item) => !item.is_viewed).length;
          return nextPolicies;
        });
        window.dispatchEvent(new CustomEvent('admin-policy-read', { detail: { unreadCount } }));
      } catch (viewError) {
        console.error('Failed to mark policy as viewed:', viewError);
      }
    }
  };

  const openEditModal = (policy) => {
    setEditingPolicy(policy);
    setFormData({
      title: policy.title || '',
      category: policy.category || '',
      content: policy.content || '',
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (policy) => {
    setPolicyToDelete(policy);
    setShowDeleteModal(true);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSavePolicy = async () => {
    if (!editingPolicy) {
      return;
    }
    if (!formData.title.trim() || !formData.category.trim() || !formData.content.trim()) {
      setError('Policy title, category, and content are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await policyAPI.update(editingPolicy.id, {
        title: formData.title.trim(),
        category: formData.category.trim(),
        content: formData.content.trim(),
      });
      closeEditModal();
      await fetchPolicies();
    } catch (saveError) {
      console.error('Failed to update policy:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to update the policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePolicy = async () => {
    if (!policyToDelete) {
      return;
    }

    try {
      setDeleteLoading(true);
      setError('');
      await policyAPI.delete(policyToDelete.id);
      closeDeleteModal();
      closeViewModal();
      await fetchPolicies();
    } catch (deleteError) {
      console.error('Failed to delete policy:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete the policy.');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-gray-600">Loading policies and SOPs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Policies & SOPs"
        subtitle="Review, update, and maintain official policy records and system-generated configuration notices."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Total Policies</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.total}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Categories</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.categories}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Updated Today</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.updatedToday}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Configuration Updates</p>
          <p className="mt-2 text-3xl font-bold text-primary">{summary.configurationUpdates}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Directory</p>
              <h2 className="mt-1 text-xl font-bold text-primary">Policy Directory</h2>
              <p className="mt-1 text-sm text-slate-500">Browse official publications in a cleaner workspace with quick filters and a more consistent reading flow.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Visible</p>
                <p className="mt-2 text-lg font-bold text-primary">{filteredPolicies.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Per Page</p>
                <p className="mt-2 text-lg font-bold text-primary">{POLICIES_PER_PAGE}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current Page</p>
                <p className="mt-2 text-lg font-bold text-primary">{currentPage}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_240px_auto]">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search title, category, content, or author"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Category</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('');
                  }}
                  className="w-full rounded-xl bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
                >
                  Reset Filters
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4 p-6">
          {paginatedPolicies.length ? (
            <>
              {paginatedPolicies.map((policy) => {
                const metaRows = buildMetaRows(policy);
                const previewContent = policy.content || 'No content available.';
                const isPreviewTruncated = previewContent.length > POLICY_PREVIEW_LENGTH;
                const previewParagraphs = getPreviewParagraphs(previewContent);
                const isUnread = !policy.is_viewed;
                const showNewBadge = isUnread && CONFIG_POLICY_CATEGORIES.has(policy.category);

                return (
                  <article key={policy.id} className={`rounded-3xl border bg-gradient-to-br p-5 shadow-sm transition duration-300 hover:border-slate-300 hover:shadow-md ${isUnread ? UNREAD_CARD_HIGHLIGHT_CLASS : showNewBadge ? 'border-emerald-300 from-white via-emerald-50 to-slate-50' : 'border-slate-200 from-white via-slate-50 to-slate-100/80'}`}>
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Publication
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CATEGORY_STYLES[policy.category] || 'bg-slate-200 text-slate-700'}`}>
                            {policy.category || 'Uncategorized'}
                          </span>
                          {isUnread ? (
                            <span className={UNREAD_STATUS_BADGE_CLASS}>Unread</span>
                          ) : null}
                          {showNewBadge ? (
                            <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Recently Published</span>
                          ) : null}
                        </div>
                        <h3 className="text-2xl font-bold leading-snug text-primary">{policy.title}</h3>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                          <span>Published {formatDateLabel(policy.created_at)}</span>
                          <span>{formatTimeLabel(policy.created_at)}</span>
                          <span>Issued by {policy.author || 'Main Office'}</span>
                        </div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Preview</p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                          {previewParagraphs.map((paragraph, index) => (
                            <p key={`${policy.id}-preview-${index}`}>{paragraph}</p>
                          ))}
                          </div>
                        </div>
                      </div>

                      <div className="w-full xl:max-w-[340px]">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                          {metaRows.map((row) => (
                            <div key={`${policy.id}-${row.label}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</p>
                              <p className="mt-2 text-sm font-medium text-slate-700">{row.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                        {isPreviewTruncated ? 'Preview shortened for readability.' : 'Full summary shown.'}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => openViewModal(policy)}
                          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition duration-300 hover:bg-secondary"
                        >
                          View
                        </button>
                        <button
                          onClick={() => openEditModal(policy)}
                          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition duration-300 hover:bg-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => openDeleteModal(policy)}
                          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-300 hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}

              <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
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
              <p className="mt-2 text-sm text-slate-500">Try a different keyword or category to narrow the list.</p>
            </div>
          )}
        </div>
      </section>

      {showEditModal && editingPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-5 md:px-8">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Edit Policy</p>
              <h3 className="mt-2 text-2xl font-bold text-primary">Update Publication</h3>
              <p className="mt-2 text-sm text-slate-500">
                Revise the publication while keeping its category, content, and communication clear for branch readers.
              </p>
            </div>

            <div className="space-y-6 px-6 py-6 md:px-8">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Policy Title</label>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Category</label>
                  <input
                    type="text"
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Primary Action</p>
                  <p className="mt-2 text-sm font-medium text-slate-700">Save Policy Changes</p>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Policy Content</label>
                  <textarea
                    name="content"
                    value={formData.content}
                    onChange={handleInputChange}
                    rows="10"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
                  ></textarea>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 md:flex-row md:justify-end md:px-8">
              <button
                onClick={closeEditModal}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePolicy}
                disabled={saving}
                className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white transition duration-300 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? 'Saving...' : 'Save Policy Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <h3 className="mt-4 text-2xl font-bold leading-tight text-primary md:text-3xl">{viewingPolicy.title}</h3>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
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
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Date Published</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatDateLabel(viewingPolicy.created_at)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Time Published</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatTimeLabel(viewingPolicy.created_at)}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Last Updated Details</p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Last Updated Date</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatDateLabel(viewingPolicy.updated_at)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Last Updated Time</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{formatTimeLabel(viewingPolicy.updated_at)}</p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 md:flex-row md:justify-between md:px-8">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    closeViewModal();
                    openEditModal(viewingPolicy);
                  }}
                  className="rounded-2xl bg-accent px-5 py-3 font-semibold text-white transition duration-300 hover:bg-blue-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    closeViewModal();
                    openDeleteModal(viewingPolicy);
                  }}
                  className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition duration-300 hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
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

      {showDeleteModal && policyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Confirm Deletion</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">Delete this publication?</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  This will permanently remove <span className="font-semibold text-slate-800">{policyToDelete.title}</span> from the Policies & SOPs module.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Last Updated</p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {formatDateLabel(policyToDelete.updated_at)} at {formatTimeLabel(policyToDelete.updated_at)}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePolicy}
                disabled={deleteLoading}
                className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition duration-300 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deleteLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Policies;
