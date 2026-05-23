import { useEffect, useMemo, useState } from 'react';
import api, { memoAPI } from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const EMPTY_FORM = {
  title: '',
  content: '',
  recipient_type: 'all',
  recipient_branch_ids: [],
  priority: 'normal',
  attachment: null,
};

const priorityStyles = {
  low: 'bg-slate-100 text-slate-700',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-red-100 text-red-700',
};

const formatDateTime = (value) => formatUtc8DateTime(value);

const Memos = () => {
  const [memos, setMemos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingMemo, setViewingMemo] = useState(null);
  const [editingMemo, setEditingMemo] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedContent, setExpandedContent] = useState(false);

  const fetchMemoModule = async () => {
    try {
      setLoading(true);
      setError('');
      const [memosResponse, branchesResponse] = await Promise.all([
        memoAPI.getAll(),
        memoAPI.getBranches(),
      ]);
      setMemos(memosResponse.data || []);
      setBranches(branchesResponse.data || []);
    } catch (fetchError) {
      console.error('Failed to load memos:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load internal memos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemoModule();
  }, []);

  const filteredMemos = useMemo(() => {
    if (!searchQuery.trim()) return memos;
    const query = searchQuery.toLowerCase();
    return memos.filter(memo => 
      memo.title.toLowerCase().includes(query) ||
      memo.content.toLowerCase().includes(query) ||
      memo.author.toLowerCase().includes(query)
    );
  }, [memos, searchQuery]);

  const summary = useMemo(() => ({
    total: memos.length,
    allBranches: memos.filter((memo) => memo.recipient_type === 'all').length,
    targeted: memos.filter((memo) => memo.recipient_type === 'specific_branches').length,
    highPriority: memos.filter((memo) => memo.priority === 'high').length,
  }), [memos]);
  const newestMemoId = useMemo(() => memos[0]?.id || null, [memos]);

  const openCreateModal = () => {
    setEditingMemo(null);
    setFormData(EMPTY_FORM);
    setShowFormModal(true);
  };

  const openEditModal = (memo) => {
    setEditingMemo(memo);
    setFormData({
      title: memo.title || '',
      content: memo.content || '',
      recipient_type: memo.recipient_type || 'all',
      recipient_branch_ids: memo.recipient_branch_ids || [],
      priority: memo.priority || 'normal',
      attachment: null,
    });
    setShowFormModal(true);
  };

  const openViewModal = async (memo) => {
    setViewingMemo(memo);
    setExpandedContent(false);
    setShowViewModal(true);
    if (!memo.is_viewed) {
      try {
        await memoAPI.markViewed(memo.id);
        setMemos((currentMemos) => currentMemos.map((item) => (
          item.id === memo.id ? { ...item, is_viewed: true } : item
        )));
        window.dispatchEvent(new Event('admin-memo-read'));
      } catch (viewError) {
        console.error('Failed to mark memo as viewed:', viewError);
      }
    }
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingMemo(null);
    setFormData(EMPTY_FORM);
  };

  const closeViewModal = () => {
    setShowViewModal(false);
    setViewingMemo(null);
    setExpandedContent(false);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFormData((previous) => ({ ...previous, attachment: file }));
  };

  const toggleBranchRecipient = (branchId) => {
    setFormData((previous) => ({
      ...previous,
      recipient_branch_ids: previous.recipient_branch_ids.includes(branchId)
        ? previous.recipient_branch_ids.filter((id) => id !== branchId)
        : [...previous.recipient_branch_ids, branchId],
    }));
  };

  const buildPayload = () => {
    const payload = new FormData();
    payload.append('title', formData.title.trim());
    payload.append('content', formData.content.trim());
    payload.append('recipient_type', formData.recipient_type);
    payload.append('recipients', formData.recipient_type === 'specific_branches'
      ? formData.recipient_branch_ids.join(',')
      : 'all');
    payload.append('priority', formData.priority);
    if (formData.attachment) {
      payload.append('attachment', formData.attachment);
    }
    return payload;
  };

  const handleSaveMemo = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      setError('Memo title and content are required.');
      return;
    }

    if (formData.recipient_type === 'specific_branches' && !formData.recipient_branch_ids.length) {
      setError('Select at least one branch recipient.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      if (editingMemo) {
        await memoAPI.update(editingMemo.id, buildPayload());
      } else {
        await memoAPI.create(buildPayload());
      }
      closeFormModal();
      await fetchMemoModule();
    } catch (saveError) {
      console.error('Failed to save memo:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to save memo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMemo = async (memoId) => {
    if (!window.confirm('Delete this internal memo?')) {
      return;
    }

    try {
      await memoAPI.delete(memoId);
      await fetchMemoModule();
    } catch (deleteError) {
      console.error('Failed to delete memo:', deleteError);
      setError(deleteError.response?.data?.detail || 'Failed to delete memo.');
    }
  };

  const handleDownloadAttachment = async (memo) => {
    try {
      const response = await api.get(`/memos/${memo.id}/download-attachment`, {
        responseType: 'blob',
      });
      const downloadUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = memo.attachment_filename || `memo_attachment_${memo.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (downloadError) {
      console.error('Failed to download memo attachment:', downloadError);
      setError(downloadError.response?.data?.detail || 'Failed to download memo attachment.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading internal memos...</p>
        </div>
      </div>
    );
  }

  const MemoCard = ({ memo }) => (
    <div className={`rounded-xl shadow-md p-5 hover:shadow-lg transition duration-300 border-l-4 ${!memo.is_viewed ? 'bg-blue-50/40 border-l-primary ring-1 ring-blue-100' : 'bg-white border-l-primary'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-bold text-gray-900">{memo.title}</h3>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${priorityStyles[memo.priority] || priorityStyles.normal}`}>
              {(memo.priority || 'normal').toUpperCase()}
            </span>
            {!memo.is_viewed ? (
              <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary text-white">
                {memo.id === newestMemoId ? 'Recently Added' : 'New'}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-600 line-clamp-2">{memo.content}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mt-4">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {memo.author}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatDateTime(memo.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {memo.recipient_label}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => openViewModal(memo)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
          >
            View
          </button>
          <button
            onClick={() => openEditModal(memo)}
            className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
          >
            Edit
          </button>
          <button
            onClick={() => handleDeleteMemo(memo.id)}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Internal Memos"
        subtitle="Create and distribute internal policies, operational instructions, and internal announcements to all branches or selected branch offices."
        actions={(
          <button
            onClick={openCreateModal}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Memo
          </button>
        )}
        className="mb-6"
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 flex items-center gap-2">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-primary">
          <p className="text-sm text-gray-500 font-medium">Total Memos</p>
          <p className="text-3xl font-bold text-primary mt-2">{summary.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-indigo-500">
          <p className="text-sm text-gray-500 font-medium">Org-Wide</p>
          <p className="text-3xl font-bold text-indigo-600 mt-2">{summary.allBranches}</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-emerald-500">
          <p className="text-sm text-gray-500 font-medium">Targeted</p>
          <p className="text-3xl font-bold text-emerald-600 mt-2">{summary.targeted}</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-red-500">
          <p className="text-sm text-gray-500 font-medium">High Priority</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{summary.highPriority}</p>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="Search memos by title, content, or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
          />
          <svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div className="space-y-4">
        {filteredMemos.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-10 text-center text-gray-500">
            {searchQuery ? 'No memos match your search.' : 'No internal memos have been issued yet.'}
          </div>
        ) : (
          filteredMemos.map((memo) => (
            <MemoCard key={memo.id} memo={memo} />
          ))
        )}
      </div>

      {showViewModal && viewingMemo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between">
              <h3 className="text-2xl font-bold text-primary">Memo Details</h3>
              <button
                onClick={closeViewModal}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-8 py-6">
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-2xl font-bold text-gray-900">{viewingMemo.title}</h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${priorityStyles[viewingMemo.priority] || priorityStyles.normal}`}>
                    {(viewingMemo.priority || 'normal').toUpperCase()}
                  </span>
                </div>
                <div className="h-1 w-20 bg-primary rounded-full"></div>
              </div>

              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Content</h4>
                <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                  <p className="text-gray-800 whitespace-pre-line leading-relaxed">
                    {expandedContent || viewingMemo.content.length <= 500
                      ? viewingMemo.content
                      : `${viewingMemo.content.substring(0, 500)}...`}
                  </p>
                  {viewingMemo.content.length > 500 && (
                    <button
                      onClick={() => setExpandedContent(!expandedContent)}
                      className="mt-3 text-primary hover:text-secondary font-semibold text-sm transition"
                    >
                      {expandedContent ? 'Show Less' : 'See More'}
                    </button>
                  )}
                </div>
              </div>

              {viewingMemo.attachment_filename && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Attachment</h4>
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <div>
                        <p className="font-semibold text-gray-900">{viewingMemo.attachment_filename}</p>
                        <p className="text-xs text-gray-500">Click to download</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadAttachment(viewingMemo)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
                    >
                      Download
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Recipients</p>
                  <p className="text-gray-900 font-medium">{viewingMemo.recipient_label}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Issued By</p>
                  <p className="text-gray-900 font-medium">{viewingMemo.author}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Created</p>
                  <p className="text-gray-900 font-medium">{formatDateTime(viewingMemo.created_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Last Updated</p>
                  <p className="text-gray-900 font-medium">{formatDateTime(viewingMemo.updated_at)}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={closeViewModal}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    closeViewModal();
                    openEditModal(viewingMemo);
                  }}
                  className="flex-1 bg-accent hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition duration-300"
                >
                  Edit Memo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFormModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-primary mb-6">
              {editingMemo ? 'Edit Internal Memo' : 'Create Internal Memo'}
            </h3>

            <div className="space-y-5">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Memo Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  placeholder="Administrative policy, internal announcement, or operations memo"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Memo Content</label>
                <textarea
                  name="content"
                  value={formData.content}
                  onChange={handleInputChange}
                  rows="8"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  placeholder="Write the full memo here..."
                ></textarea>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Memo Priority</label>
                  <select
                    name="priority"
                    value={formData.priority}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Recipients</label>
                  <select
                    name="recipient_type"
                    value={formData.recipient_type}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  >
                    <option value="all">All Branches</option>
                    <option value="specific_branches">Specific Branches</option>
                  </select>
                </div>
              </div>

              {formData.recipient_type === 'specific_branches' && (
                <div>
                  <label className="block text-gray-700 font-semibold mb-3">Select Branch Recipients</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {branches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50"
                      >
                        <input
                          type="checkbox"
                          checked={formData.recipient_branch_ids.includes(branch.id)}
                          onChange={() => toggleBranchRecipient(branch.id)}
                          className="mt-1"
                        />
                        <div>
                          <p className="font-semibold text-gray-800">{branch.name}</p>
                          <p className="text-sm text-gray-500">{branch.location}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Attachment (Optional)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-blue-400 transition">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    className="w-full"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png"
                  />
                  {formData.attachment && (
                    <p className="mt-2 text-sm text-gray-600">
                      Selected: <span className="font-semibold">{formData.attachment.name}</span>
                    </p>
                  )}
                  {editingMemo && editingMemo.attachment_filename && !formData.attachment && (
                    <p className="mt-2 text-sm text-blue-600">
                      Current: <span className="font-semibold">{editingMemo.attachment_filename}</span>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    Supported formats: PDF, Word, Excel, Text, Images (Max 10MB)
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={closeFormModal}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMemo}
                disabled={saving}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingMemo ? 'Update Memo' : 'Issue Memo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Memos;
