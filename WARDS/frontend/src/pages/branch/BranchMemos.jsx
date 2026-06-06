import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import { UNREAD_CARD_HIGHLIGHT_CLASS, UNREAD_STATUS_BADGE_CLASS } from '../../utils/notificationUI';

const priorityStyles = {
  low: 'bg-slate-100 text-slate-700',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-red-100 text-red-700',
};

const formatDateTime = (value) => formatUtc8DateTime(value);

const BranchMemos = () => {
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingMemo, setViewingMemo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedContent, setExpandedContent] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingMemo, setEditingMemo] = useState(null);
  const [savingMemo, setSavingMemo] = useState(false);
  const [formState, setFormState] = useState({ title: '', content: '', priority: 'normal', attachment: null });
  const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const isBranchAdmin = branchUser?.role === 'branch_admin' || branchUser?.internal_role === 'branch_admin';

  const fetchMemos = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/branch/memos');
      setMemos(response.data || []);
    } catch (fetchError) {
      console.error('Failed to load branch memos:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load internal memos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemos();
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
    highPriority: memos.filter(memo => memo.priority === 'high').length,
    orgWide: memos.filter(memo => memo.recipient_type === 'all').length,
  }), [memos]);
  const openViewModal = async (memo) => {
    setViewingMemo(memo);
    setExpandedContent(false);
    setShowViewModal(true);
    
    if (!memo.is_viewed) {
      try {
        await api.post(`/branch/memos/${memo.id}/mark-viewed`);
        let unreadCount = 0;
        setMemos((prevMemos) => {
          const nextMemos = prevMemos.map((m) =>
            m.id === memo.id ? { ...m, is_viewed: true } : m
          );
          unreadCount = nextMemos.filter((item) => !item.is_viewed).length;
          return nextMemos;
        });
        window.dispatchEvent(new CustomEvent('branch-memo-read', { detail: { unreadCount } }));
      } catch (err) {
        console.error('Failed to mark memo as viewed:', err);
      }
    }
  };

  const closeViewModal = () => {
    setShowViewModal(false);
    setViewingMemo(null);
    setExpandedContent(false);
  };

  const handleDownloadAttachment = async (memo) => {
    try {
      const response = await api.get(`/branch/memos/${memo.id}/download-attachment`, {
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

  const openCreateForm = () => {
    setEditingMemo(null);
    setFormState({ title: '', content: '', priority: 'normal', attachment: null });
    setShowForm(true);
  };

  const openEditForm = (memo) => {
    setEditingMemo(memo);
    setFormState({ title: memo.title || '', content: memo.content || '', priority: memo.priority || 'normal', attachment: null });
    setShowForm(true);
  };

  const saveMemo = async (event) => {
    event.preventDefault();
    setSavingMemo(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('title', formState.title);
      formData.append('content', formState.content);
      formData.append('priority', formState.priority);
      if (formState.attachment) {
        formData.append('attachment', formState.attachment);
      }
      if (editingMemo) {
        await api.put(`/branch/memos/${editingMemo.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/branch/memos', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setShowForm(false);
      setEditingMemo(null);
      await fetchMemos();
    } catch (saveError) {
      setError(saveError.response?.data?.detail || 'Failed to save internal memo.');
    } finally {
      setSavingMemo(false);
    }
  };

  const deleteMemo = async (memo) => {
    if (!window.confirm(`Delete internal memo "${memo.title}"?`)) {
      return;
    }
    try {
      await api.delete(`/branch/memos/${memo.id}`);
      await fetchMemos();
    } catch (deleteError) {
      setError(deleteError.response?.data?.detail || 'Failed to delete internal memo.');
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-purple-600 border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading internal memos...</p>
        </div>
      </div>
    );
  }

  const MemoCard = ({ memo }) => (
    <div className={`rounded-xl border-l-4 p-5 shadow-md transition duration-300 hover:shadow-lg ${!memo.is_viewed ? `${UNREAD_CARD_HIGHLIGHT_CLASS} border-l-purple-600` : 'bg-white border-l-purple-500'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-bold text-gray-900">{memo.title}</h3>
            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${priorityStyles[memo.priority] || priorityStyles.normal}`}>
              {(memo.priority || 'normal').toUpperCase()}
            </span>
            {!memo.is_viewed ? (
              <span className={UNREAD_STATUS_BADGE_CLASS}>
                Unread
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
            {memo.author}{memo.is_mine ? ' (You)' : ''}
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
            {memo.recipient_label || 'All Branches'}
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => openViewModal(memo)}
            className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition duration-300"
          >
            View Details
          </button>
          {isBranchAdmin && memo.is_mine && (
            <>
              <button onClick={() => openEditForm(memo)} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300">Edit</button>
              <button onClick={() => deleteMemo(memo)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700">Delete</button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <WardsPageHero
        eyebrow="Branch Dashboard"
        title="Internal Memos"
        subtitle="View organization-wide and branch-targeted memos issued by the main admin office."
        className="mb-6"
      />

      {isBranchAdmin && (
        <div className="mb-6 flex justify-end">
          <button onClick={openCreateForm} className="rounded-lg bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700">
            Create Internal Memo
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={saveMemo} className="mb-6 rounded-xl bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-purple-700">{editingMemo ? 'Edit Internal Memo' : 'Create Internal Memo'}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <input value={formState.title} onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))} className="rounded-lg border border-gray-300 px-4 py-3" placeholder="Memo title" required />
            <select value={formState.priority} onChange={(event) => setFormState((current) => ({ ...current, priority: event.target.value }))} className="rounded-lg border border-gray-300 px-4 py-3">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <textarea value={formState.content} onChange={(event) => setFormState((current) => ({ ...current, content: event.target.value }))} className="mt-4 min-h-36 w-full rounded-lg border border-gray-300 px-4 py-3" placeholder="Memo content" required />
          <input type="file" onChange={(event) => setFormState((current) => ({ ...current, attachment: event.target.files?.[0] || null }))} className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-3" />
          <button disabled={savingMemo} className="mt-4 rounded-lg bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60">
            {savingMemo ? 'Saving...' : editingMemo ? 'Save Changes' : 'Publish Memo'}
          </button>
        </form>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 flex items-center gap-2">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-purple-600">
          <p className="text-sm text-gray-500 font-medium">Total Memos</p>
          <p className="text-3xl font-bold text-purple-600 mt-2">{summary.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-red-500">
          <p className="text-sm text-gray-500 font-medium">High Priority</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{summary.highPriority}</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-indigo-500">
          <p className="text-sm text-gray-500 font-medium">Organization-Wide</p>
          <p className="text-3xl font-bold text-indigo-600 mt-2">{summary.orgWide}</p>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="Search memos by title, content, or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
          />
          <svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div className="space-y-4">
        {filteredMemos.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-10 text-center text-gray-500">
            {searchQuery ? 'No memos match your search.' : 'No internal memos are available for this branch yet.'}
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
              <h3 className="text-2xl font-bold text-purple-600">Memo Details</h3>
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
                <div className="h-1 w-20 bg-purple-600 rounded-full"></div>
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
                      className="mt-3 text-purple-600 hover:text-purple-700 font-semibold text-sm transition"
                    >
                      {expandedContent ? 'Show Less' : 'See More'}
                    </button>
                  )}
                </div>
              </div>

              {viewingMemo.attachment_filename && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Attachment</h4>
                  <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <div>
                        <p className="font-semibold text-gray-900">{viewingMemo.attachment_filename}</p>
                        <p className="text-xs text-gray-500">Click to download</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadAttachment(viewingMemo)}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
                    >
                      Download
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Recipients</p>
                  <p className="text-gray-900 font-medium">{viewingMemo.recipient_label || 'All Branches'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Issued By</p>
                  <p className="text-gray-900 font-medium">{viewingMemo.author}{viewingMemo.is_mine ? ' (You)' : ''}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Created</p>
                  <p className="text-gray-900 font-medium">{formatDateTime(viewingMemo.created_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-5 py-4 border border-slate-200">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Last Updated</p>
                  <p className="text-gray-900 font-medium">{formatDateTime(viewingMemo.updated_at || viewingMemo.created_at)}</p>
                </div>
              </div>

              <button
                onClick={closeViewModal}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold transition duration-300"
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

export default BranchMemos;
