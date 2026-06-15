import { useEffect, useState } from 'react';
import api, { announcementAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';
import { CustomSelect } from '../../components/FormControls';
import {
  AnnouncementAttachmentsField,
  AnnouncementAttachmentsList,
} from '../../components/AnnouncementAttachments';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';
import { UNREAD_CARD_HIGHLIGHT_CLASS, UNREAD_STATUS_BADGE_CLASS } from '../../utils/notificationUI';

const defaultForm = {
  title: '',
  content: '',
  icon_type: 'megaphone',
  icon_color: 'blue',
  is_active: true,
};

const Announcements = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const [announcements, setAnnouncements] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [formData, setFormData] = useState(defaultForm);
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      setPageLoading(true);
      setPageError('');
      const response = await api.get('/announcements/admin/all');
      setAnnouncements(response.data || []);
    } catch (error) {
      console.error('Failed to fetch announcements:', error);
      setPageError(error.response?.data?.detail || 'Failed to load announcements.');
    } finally {
      setPageLoading(false);
    }
  };

  const markAnnouncementViewedLocally = (announcementId) => {
    let unreadCount = 0;
    setAnnouncements((previous) => {
      const nextAnnouncements = previous.map((announcement) =>
        announcement.id === announcementId
          ? { ...announcement, is_viewed: true }
          : announcement
      );
      unreadCount = nextAnnouncements.filter((announcement) => !announcement.is_viewed).length;
      return nextAnnouncements;
    });
    if (selectedAnnouncement?.id === announcementId) {
      setSelectedAnnouncement((previous) => (
        previous ? { ...previous, is_viewed: true } : previous
      ));
    }
    return unreadCount;
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData({ ...formData, [name]: value });
    if (validationErrors[name]) {
      setValidationErrors((previous) => ({ ...previous, [name]: '' }));
    }
  };

  const handleSelectChange = (fieldName) => (value) => {
    handleInputChange({ target: { name: fieldName, value } });
  };

  const resetEditor = () => {
    setEditingAnnouncement(null);
    setFormData(defaultForm);
    setPendingFiles([]);
    setExistingAttachments([]);
    setUploadProgress(0);
    setIsUploading(false);
    setValidationErrors({});
  };

  const handleAddAnnouncement = () => {
    setPageError('');
    setSuccessMessage('');
    resetEditor();
    setShowModal(true);
  };

  const handleEditAnnouncement = (announcement) => {
    setPageError('');
    setSuccessMessage('');
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      icon_type: announcement.icon_type || 'megaphone',
      icon_color: announcement.icon_color || 'blue',
      is_active: announcement.is_active,
    });
    setPendingFiles([]);
    setExistingAttachments(announcement.attachments || []);
    setUploadProgress(0);
    setIsUploading(false);
    setShowModal(true);
  };

  const handleViewAnnouncement = async (announcement) => {
    try {
      setPageError('');
      setSuccessMessage('');
      await announcementAPI.markViewed(announcement.id);
      const unreadCount = markAnnouncementViewedLocally(announcement.id);
      setSelectedAnnouncement({ ...announcement, is_viewed: true });
      window.dispatchEvent(new CustomEvent('admin-announcement-viewed', { detail: { unreadCount } }));
    } catch (error) {
      console.error('Failed to mark announcement as viewed:', error);
      setSelectedAnnouncement(announcement);
      setPageError(error.response?.data?.detail || 'Failed to open announcement.');
    }
  };

  const handleAddPendingFiles = (files) => {
    setPendingFiles((previous) => [...previous, ...files]);
  };

  const handleRemovePendingFile = (index) => {
    setPendingFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleDeleteExistingAttachment = async (attachment) => {
    if (!editingAnnouncement) return;
    setDeleteTarget({
      type: 'attachment',
      title: 'Remove this attachment?',
      message: `This will permanently remove "${attachment.filename}" from the announcement.`,
      details: [{ label: 'Announcement', value: editingAnnouncement.title }],
      attachment,
    });
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.title.trim()) {
      errors.title = 'Please enter the Announcement Title.';
    }
    if (!formData.content.trim()) {
      errors.content = 'Please enter the Announcement Content.';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveAnnouncement = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setPageError('');
    setSuccessMessage('');
    try {
      let savedAnnouncement;
      if (editingAnnouncement) {
        const response = await api.put(`/announcements/${editingAnnouncement.id}`, formData);
        savedAnnouncement = response.data;
      } else {
        const response = await api.post('/announcements/', formData);
        savedAnnouncement = response.data;
      }

      if (pendingFiles.length > 0 && savedAnnouncement?.id) {
        setIsUploading(true);
        setUploadProgress(0);
        try {
          await announcementAPI.uploadAttachments(
            savedAnnouncement.id,
            pendingFiles,
            (event) => {
              if (event.total) {
                setUploadProgress(Math.round((event.loaded / event.total) * 100));
              }
            }
          );
        } catch (uploadError) {
          console.error('Failed to upload attachments:', uploadError);
          setPageError(uploadError.response?.data?.detail || 'Announcement saved, but attachments failed to upload.');
        } finally {
          setIsUploading(false);
        }
      }

      await fetchAnnouncements();
      resetEditor();
      setShowModal(false);
      setSuccessMessage(editingAnnouncement ? 'Announcement updated successfully.' : 'Announcement published successfully.');
      window.dispatchEvent(new CustomEvent('admin-announcement-viewed'));
    } catch (error) {
      console.error('Failed to save announcement:', error);
      setPageError(error.response?.data?.detail || 'Failed to save announcement.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAnnouncement = async (announcement) => {
    setDeleteTarget({
      type: 'announcement',
      title: 'Delete this announcement?',
      message: `This will permanently remove "${announcement.title}" from the Announcements module.`,
      details: [
        { label: 'Published', value: formatDate(announcement.publish_date) },
        { label: 'Created By', value: announcement.created_by || 'Admin' },
      ],
      announcement,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      setPageError('');
      setSuccessMessage('');
      if (deleteTarget.type === 'attachment') {
        await announcementAPI.deleteAttachment(editingAnnouncement.id, deleteTarget.attachment.id);
        setExistingAttachments((previous) => previous.filter((item) => item.id !== deleteTarget.attachment.id));
        setSuccessMessage('Attachment removed successfully.');
      } else if (deleteTarget.type === 'announcement') {
        const announcementId = deleteTarget.announcement.id;
        await api.delete(`/announcements/${announcementId}`);
        if (selectedAnnouncement?.id === announcementId) {
          setSelectedAnnouncement(null);
        }
        await fetchAnnouncements();
        setSuccessMessage('Announcement deleted successfully.');
        window.dispatchEvent(new CustomEvent('admin-announcement-viewed'));
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error('Failed to delete announcement content:', error);
      setPageError(error.response?.data?.detail || 'Failed to complete the delete action.');
    }
  };

  const getIconPath = (iconType) => {
    const icons = {
      megaphone: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
      check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
      info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    };
    return icons[iconType] || icons.megaphone;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getColorClasses = (color) => {
    const colors = {
      blue: { bg: 'bg-blue-100', text: 'text-primary' },
      green: { bg: 'bg-green-100', text: 'text-green-600' },
      yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
      red: { bg: 'bg-red-100', text: 'text-red-600' },
    };
    return colors[color] || colors.blue;
  };

  if (pageLoading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading announcements...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WardsPageHero
        eyebrow={adminUser?.internal_role === 'superadmin' || adminUser?.role === 'superadmin' ? 'Superadmin Dashboard' : 'Main Admin Dashboard'}
        title="Announcements"
        subtitle="Create, schedule, and manage official announcements that appear across the WARDS platform."
        actions={(
          <button
            onClick={handleAddAnnouncement}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg"
          >
            + Create Announcement
          </button>
        )}
      />

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          {pageError}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-green-700">
          {successMessage}
        </div>
      )}

      <div className="space-y-6 py-6 sm:py-8">
        {announcements.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg">No announcements yet. Create your first announcement!</p>
          </div>
        ) : (
          announcements.map((announcement) => (
            <div key={announcement.id} className={`rounded-xl bg-white p-6 shadow-lg transition duration-300 hover:shadow-xl ${!announcement.is_viewed ? UNREAD_CARD_HIGHLIGHT_CLASS : ''}`}>
              <div className="flex justify-between items-start mb-4 gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className={`${getColorClasses(announcement.icon_color).bg} p-3 rounded-full flex-shrink-0`}>
                    <svg className={`w-6 h-6 ${getColorClasses(announcement.icon_color).text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(announcement.icon_type)}></path>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-primary break-words">{announcement.title}</h3>
                      {announcement.branch_name && (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                          Branch Source: {announcement.branch_name}
                        </span>
                      )}
                      {!announcement.is_viewed && (
                        <span className={UNREAD_STATUS_BADGE_CLASS}>
                          Unread
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-4 break-words overflow-hidden">{announcement.content}</p>
                    <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
                      <span>Published: {formatDate(announcement.publish_date)}</span>
                      <span>Created by: {announcement.created_by || 'Admin'}</span>
                    </div>
                    <AnnouncementAttachmentsList attachments={announcement.attachments} />
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  announcement.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {announcement.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleViewAnnouncement(announcement)}
                  className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-semibold transition duration-300"
                >
                  View
                </button>
                <button
                  onClick={() => handleEditAnnouncement(announcement)}
                  className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition duration-300"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteAnnouncement(announcement)}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition duration-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6">
          <div className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 sm:px-8 sm:py-5">
              <div className="min-w-0">
                <h3 className="text-xl sm:text-2xl font-bold text-primary">
                  {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  When active, the public website displays this with the main admin source label.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetEditor();
                }}
                className="flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title</label>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 ${validationErrors.title ? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-accent focus:ring-accent/30'}`}
                    placeholder="Enter a clear, concise title"
                  />
                  {validationErrors.title && (
                    <p className="mt-2 text-sm font-semibold text-red-600">{validationErrors.title}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Content</label>
                  <textarea
                    name="content"
                    value={formData.content}
                    onChange={handleInputChange}
                    rows="5"
                    className={`w-full resize-y rounded-lg border px-3.5 py-2.5 text-sm leading-6 focus:outline-none focus:ring-2 ${validationErrors.content ? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-accent focus:ring-accent/30'}`}
                    placeholder="Write your announcement..."
                  ></textarea>
                  {validationErrors.content && (
                    <p className="mt-2 text-sm font-semibold text-red-600">{validationErrors.content}</p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Icon Type</label>
                    <CustomSelect value={formData.icon_type} onChange={handleSelectChange('icon_type')} options={[{ value: 'megaphone', label: 'Megaphone' }, { value: 'check', label: 'Check Mark' }, { value: 'clock', label: 'Clock' }, { value: 'info', label: 'Info' }]} placeholder="Select icon" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Icon Color</label>
                    <CustomSelect value={formData.icon_color} onChange={handleSelectChange('icon_color')} options={[{ value: 'blue', label: 'Blue' }, { value: 'green', label: 'Green' }, { value: 'amber', label: 'Amber' }, { value: 'red', label: 'Red' }, { value: 'purple', label: 'Purple' }]} placeholder="Select color" />
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={(event) => setFormData({ ...formData, is_active: event.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent"
                    />
                    <span className="text-sm font-semibold text-slate-700">
                      Active <span className="font-normal text-slate-500">(visible to public)</span>
                    </span>
                  </label>
                </div>
                <AnnouncementAttachmentsField
                  existingAttachments={existingAttachments}
                  pendingFiles={pendingFiles}
                  onAddPending={handleAddPendingFiles}
                  onRemovePending={handleRemovePendingFile}
                  onDeleteExisting={handleDeleteExistingAttachment}
                  disabled={loading || isUploading}
                  uploadProgress={uploadProgress}
                  isUploading={isUploading}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-6 py-3.5 backdrop-blur sm:flex-row sm:justify-end sm:px-8 sm:py-4">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetEditor();
                }}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAnnouncement}
                disabled={loading || isUploading}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary disabled:opacity-50 sm:min-w-[140px]"
              >
                {loading || isUploading ? 'Saving...' : (editingAnnouncement ? 'Update' : 'Publish')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6">
          <div className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 sm:px-8 sm:py-5">
              <div>
                <h3 className="text-xl sm:text-2xl font-bold text-primary">Announcement Details</h3>
                <p className="mt-1 text-sm text-slate-500">Viewing this announcement marks it as read for your account.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                className="flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
              <div className="flex items-start gap-4 mb-5">
                <div className={`${getColorClasses(selectedAnnouncement.icon_color).bg} p-3 rounded-full flex-shrink-0`}>
                  <svg className={`w-6 h-6 ${getColorClasses(selectedAnnouncement.icon_color).text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(selectedAnnouncement.icon_type)}></path>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h4 className="text-2xl font-bold text-primary">{selectedAnnouncement.title}</h4>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedAnnouncement.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedAnnouncement.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
                    <span>Published: {formatDate(selectedAnnouncement.publish_date)}</span>
                    <span>Created by: {selectedAnnouncement.created_by || 'Admin'}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-700 whitespace-pre-wrap">
                {selectedAnnouncement.content}
              </div>
              <AnnouncementAttachmentsList attachments={selectedAnnouncement.attachments} />
            </div>

            <div className="border-t border-slate-200 bg-white/95 px-6 py-3.5 sm:px-8 sm:py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmationModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title}
        message={deleteTarget?.message}
        details={deleteTarget?.details || []}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isLoading={loading}
      />
    </div>
  );
};

export default Announcements;
