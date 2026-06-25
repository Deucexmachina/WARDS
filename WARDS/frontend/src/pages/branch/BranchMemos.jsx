import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import { CustomSelect } from '../../components/FormControls';
import SystemMessageModal from '../../components/SystemMessageModal';
import ActionConfirmationModal from '../../components/ActionConfirmationModal';
import { UNREAD_CARD_HIGHLIGHT_CLASS, UNREAD_STATUS_BADGE_CLASS } from '../../utils/notificationUI';

const EMPTY_FORM = {
  title: '',
  content: '',
  priority: 'normal',
  attachment: null,
};

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
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingMemo, setEditingMemo] = useState(null);
  const [memoToDelete, setMemoToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [fileErrorModal, setFileErrorModal] = useState({ open: false, title: '', message: '' });
  const [validationErrors, setValidationErrors] = useState({});
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [updateSuccessModal, setUpdateSuccessModal] = useState({ open: false, title: '', message: '' });
  const [updateErrorModal, setUpdateErrorModal] = useState({ open: false, title: '', message: '' });
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
    setFormState(EMPTY_FORM);
    setValidationErrors({});
    setError('');
    setShowFormModal(true);
  };

  const openEditForm = (memo) => {
    setEditingMemo(memo);
    setFormState({
      title: memo.title || '',
      content: memo.content || '',
      priority: memo.priority || 'normal',
      attachment: null,
    });
    setValidationErrors({});
    setError('');
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingMemo(null);
    setFormState(EMPTY_FORM);
    setValidationErrors({});
    setError('');
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
    if (validationErrors[name]) {
      setValidationErrors((current) => ({ ...current, [name]: '' }));
    }
  };

  const handleSelectChange = (fieldName) => (value) => {
    handleInputChange({ target: { name: fieldName, value } });
  };

  const ALLOWED_MEMO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.docx', '.xlsx'];

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED_MEMO_EXTENSIONS.includes(ext)) {
        setFileErrorModal({
          open: true,
          title: 'Invalid File Type',
          message: 'Only JPG, PNG, DOCX, XLSX, and PDF files are allowed.',
        });
        event.target.value = '';
        return;
      }
    }
    setFormState((current) => ({ ...current, attachment: file }));
  };

  const validateMemoForm = () => {
    const errors = {};
    if (!formState.title.trim()) {
      errors.title = 'Please enter the Memo Title.';
    } else if (formState.title.trim().length > 200) {
      errors.title = 'Memo title must be 200 characters or fewer.';
    }
    if (!formState.content.trim()) {
      errors.content = 'Please enter the Memo Details.';
    } else if (formState.content.trim().length > 10000) {
      errors.content = 'Memo content must be 10,000 characters or fewer.';
    }
    if (!formState.priority) {
      errors.priority = 'Please select a priority level.';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const executeSave = async () => {
    const isEditing = Boolean(editingMemo);
    try {
      setSaving(true);
      setError('');
      setValidationErrors({});
      setShowUpdateConfirm(false);
      const formData = new FormData();
      formData.append('title', formState.title.trim());
      formData.append('content', formState.content.trim());
      formData.append('priority', formState.priority);
      if (formState.attachment) {
        formData.append('attachment', formState.attachment);
      }
      if (isEditing) {
        await api.put(`/branch/memos/${editingMemo.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/branch/memos', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      closeFormModal();
      await fetchMemos();
      if (isEditing) {
        setUpdateSuccessModal({
          open: true,
          title: 'Memo Updated Successfully',
          message: 'The memo has been updated successfully.',
        });
      }
    } catch (saveError) {
      if (isEditing) {
        setUpdateErrorModal({
          open: true,
          title: 'Unable to Update Memo',
          message: 'An unexpected error occurred while updating the memo. Please try again.',
        });
      } else {
        setError(saveError.response?.data?.detail || 'Failed to save internal memo.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMemo = async () => {
    if (!validateMemoForm()) {
      setError('Please review the highlighted fields.');
      return;
    }

    if (editingMemo) {
      setShowUpdateConfirm(true);
      return;
    }

    await executeSave();
  };

  const handleDeleteMemo = async (memoId) => {
    if (!memoToDelete && memoId && typeof memoId === 'object') {
      setMemoToDelete(memoId);
      return;
    }

    const targetMemo = memoToDelete || memos.find((memo) => memo.id === memoId);
    if (!targetMemo) {
      return;
    }

    try {
      setSaving(true);
      await api.delete(`/branch/memos/${targetMemo.id}`);
      await fetchMemos();
      setMemoToDelete(null);
    } catch (deleteError) {
      setError(deleteError.response?.data?.detail || 'Failed to delete internal memo.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading internal memos...</p>
        </div>
      </div>
    );
  }

  const MemoCard = ({ memo }) => (
    <div className={`rounded-xl border-l-4 p-5 shadow-md transition duration-300 hover:shadow-lg ${!memo.is_viewed ? `${UNREAD_CARD_HIGHLIGHT_CLASS} border-l-primary` : 'bg-white border-l-primary'}`}>
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
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
          >
            View
          </button>
          {isBranchAdmin && memo.is_mine && (
            <>
              <button
                onClick={() => openEditForm(memo)}
                className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteMemo(memo)}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition duration-300"
              >
                Delete
              </button>
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
          <button
            onClick={openCreateForm}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Memo
          </button>
        </div>
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
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-primary">
          <p className="text-sm text-gray-500 font-medium">Total Memos</p>
          <p className="text-3xl font-bold text-primary mt-2">{summary.total}</p>
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

              <div className="flex gap-3">
                <button
                  onClick={closeViewModal}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
                >
                  Close
                </button>
                {isBranchAdmin && viewingMemo.is_mine && (
                  <button
                    onClick={() => {
                      closeViewModal();
                      openEditForm(viewingMemo);
                    }}
                    className="flex-1 bg-accent hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition duration-300"
                  >
                    Edit Memo
                  </button>
                )}
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
                  value={formState.title}
                  onChange={handleInputChange}
                  maxLength={200}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                    validationErrors.title ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="Administrative policy, internal announcement, or operations memo"
                />
                {validationErrors.title && (
                  <p className="mt-2 text-sm font-semibold text-red-600">{validationErrors.title}</p>
                )}
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Memo Content</label>
                <textarea
                  name="content"
                  value={formState.content}
                  onChange={handleInputChange}
                  rows="8"
                  maxLength={10000}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                    validationErrors.content ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="Write the full memo here..."
                ></textarea>
                {validationErrors.content && (
                  <p className="mt-2 text-sm font-semibold text-red-600">{validationErrors.content}</p>
                )}
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Memo Priority</label>
                <CustomSelect value={formState.priority} onChange={handleSelectChange('priority')} options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} placeholder="Select priority" hasError={!!validationErrors.priority} />
                {validationErrors.priority && (
                  <p className="mt-2 text-sm font-semibold text-red-600">{validationErrors.priority}</p>
                )}
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Attachment (Optional)</label>
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx"
                  className="mb-4 w-full cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[#0f2f5f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-blue-400 hover:bg-slate-50 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200 transition"
                />
                {formState.attachment && (
                  <p className="mt-2 text-sm text-gray-600">
                    Selected: <span className="font-semibold">{formState.attachment.name}</span>
                  </p>
                )}
                {editingMemo && editingMemo.attachment_filename && !formState.attachment && (
                  <p className="mt-2 text-sm text-blue-600">
                    Current: <span className="font-semibold">{editingMemo.attachment_filename}</span>
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  Supported formats: JPG, JPEG, PNG, PDF, Word, Excel (Max 10MB)
                </p>
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

      <SystemMessageModal
        open={fileErrorModal.open}
        tone="error"
        title={fileErrorModal.title}
        message={fileErrorModal.message}
        buttonLabel="OK"
        onClose={() => setFileErrorModal({ ...fileErrorModal, open: false })}
      />

      <ActionConfirmationModal
        open={showUpdateConfirm}
        title="Confirm Memo Update"
        message="Are you sure you want to save the changes made to this memo?"
        confirmLabel="Yes, Update Memo"
        cancelLabel="Cancel"
        tone="primary"
        isLoading={saving}
        loadingLabel="Updating..."
        onCancel={() => setShowUpdateConfirm(false)}
        onConfirm={executeSave}
      />

      <SystemMessageModal
        open={updateSuccessModal.open}
        tone="success"
        title={updateSuccessModal.title}
        message={updateSuccessModal.message}
        buttonLabel="OK"
        onClose={() => setUpdateSuccessModal({ ...updateSuccessModal, open: false })}
      />

      <SystemMessageModal
        open={updateErrorModal.open}
        tone="error"
        title={updateErrorModal.title}
        message={updateErrorModal.message}
        buttonLabel="OK"
        onClose={() => setUpdateErrorModal({ ...updateErrorModal, open: false })}
      />

      <DeleteConfirmationModal
        open={Boolean(memoToDelete)}
        title="Delete this internal memo?"
        message={`This will permanently remove "${memoToDelete?.title || 'this memo'}" from the Internal Memos module.`}
        details={[
          { label: 'Author', value: memoToDelete?.author || 'Branch Admin' },
          { label: 'Created', value: memoToDelete?.created_at ? formatDateTime(memoToDelete.created_at) : 'N/A' },
        ]}
        onCancel={() => setMemoToDelete(null)}
        onConfirm={() => handleDeleteMemo()}
        isLoading={saving}
      />
    </div>
  );
};

export default BranchMemos;
