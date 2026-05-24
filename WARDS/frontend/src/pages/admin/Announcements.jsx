import { useState, useEffect } from 'react';
import api, { announcementAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';
import {
  AnnouncementAttachmentsField,
  AnnouncementAttachmentsList,
} from '../../components/AnnouncementAttachments';

const Announcements = () => {
  const [announcements, setAnnouncements] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    icon_type: 'megaphone',
    icon_color: 'blue',
    is_active: true
  });

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      const response = await api.get('/announcements/admin/all');
      setAnnouncements(response.data);
    } catch (error) {
      console.error('Failed to fetch announcements:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddAnnouncement = () => {
    setEditingAnnouncement(null);
    setFormData({ title: '', content: '', icon_type: 'megaphone', icon_color: 'blue', is_active: true });
    setPendingFiles([]);
    setExistingAttachments([]);
    setUploadProgress(0);
    setIsUploading(false);
    setShowModal(true);
  };

  const handleEditAnnouncement = (announcement) => {
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      icon_type: announcement.icon_type || 'megaphone',
      icon_color: announcement.icon_color || 'blue',
      is_active: announcement.is_active
    });
    setPendingFiles([]);
    setExistingAttachments(announcement.attachments || []);
    setUploadProgress(0);
    setIsUploading(false);
    setShowModal(true);
  };

  const handleAddPendingFiles = (files) => {
    setPendingFiles((prev) => [...prev, ...files]);
  };

  const handleRemovePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeleteExistingAttachment = async (attachment) => {
    if (!editingAnnouncement) return;
    if (!window.confirm(`Remove "${attachment.filename}" from this announcement?`)) return;
    try {
      await announcementAPI.deleteAttachment(editingAnnouncement.id, attachment.id);
      setExistingAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
    } catch (error) {
      console.error('Failed to remove attachment:', error);
      alert('Failed to remove attachment: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleSaveAnnouncement = async () => {
    if (!formData.title || !formData.content) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
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
          alert('Announcement saved, but attachments failed to upload: ' + (uploadError.response?.data?.detail || uploadError.message));
        } finally {
          setIsUploading(false);
        }
      }

      await fetchAnnouncements();
      setShowModal(false);
      setFormData({ title: '', content: '', icon_type: 'megaphone', icon_color: 'blue', is_active: true });
      setPendingFiles([]);
      setExistingAttachments([]);
      setUploadProgress(0);
    } catch (error) {
      console.error('Failed to save announcement:', error);
      alert('Failed to save announcement: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (window.confirm('Are you sure you want to delete this announcement?')) {
      try {
        await api.delete(`/announcements/${id}`);
        await fetchAnnouncements();
      } catch (error) {
        console.error('Failed to delete announcement:', error);
        alert('Failed to delete announcement: ' + (error.response?.data?.detail || error.message));
      }
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

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
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

      <div className="space-y-6">
        {announcements.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg">No announcements yet. Create your first announcement!</p>
          </div>
        ) : (
          announcements.map((announcement) => (
            <div key={announcement.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition duration-300">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className={`${getColorClasses(announcement.icon_color).bg} p-3 rounded-full flex-shrink-0`}>
                    <svg className={`w-6 h-6 ${getColorClasses(announcement.icon_color).text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={getIconPath(announcement.icon_type)}></path>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-primary">{announcement.title}</h3>
                      {announcement.branch_name && (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                          Branch Source: {announcement.branch_name}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-4">{announcement.content}</p>
                    <div className="flex gap-4 text-sm text-gray-500">
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
            <div className="flex gap-2">
              <button 
                onClick={() => handleEditAnnouncement(announcement)}
                className="bg-accent hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition duration-300"
              >
                Edit
              </button>
              <button 
                onClick={() => handleDeleteAnnouncement(announcement.id)}
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
            {/* Sticky Header */}
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
                onClick={() => setShowModal(false)}
                className="flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Title</label>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    placeholder="Enter a clear, concise title"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Content</label>
                  <textarea
                    name="content"
                    value={formData.content}
                    onChange={handleInputChange}
                    rows="5"
                    className="w-full resize-y rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm leading-6 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    placeholder="Write your announcement..."
                    required
                  ></textarea>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Icon Type</label>
                    <select
                      name="icon_type"
                      value={formData.icon_type}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      <option value="megaphone">Megaphone</option>
                      <option value="check">Check Mark</option>
                      <option value="clock">Clock</option>
                      <option value="info">Info</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Icon Color</label>
                    <select
                      name="icon_color"
                      value={formData.icon_color}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      <option value="blue">Blue</option>
                      <option value="green">Green</option>
                      <option value="yellow">Yellow</option>
                      <option value="red">Red</option>
                    </select>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
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

            {/* Sticky Footer */}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-6 py-3.5 backdrop-blur sm:flex-row sm:justify-end sm:px-8 sm:py-4">
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
    </div>
  );
};

export default Announcements;
