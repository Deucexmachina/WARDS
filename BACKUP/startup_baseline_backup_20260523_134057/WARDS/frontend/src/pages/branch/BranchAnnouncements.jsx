import { useEffect, useState } from 'react';
import api from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';

const defaultForm = {
  title: '',
  content: '',
  icon_type: 'megaphone',
  icon_color: 'blue',
  is_active: true,
};

const BranchAnnouncements = () => {
  const [announcements, setAnnouncements] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [formData, setFormData] = useState(defaultForm);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      setPageLoading(true);
      const response = await api.get('/branch/announcements');
      setAnnouncements(response.data || []);
    } catch (error) {
      console.error('Failed to fetch branch announcements:', error);
    } finally {
      setPageLoading(false);
    }
  };

  const handleInputChange = (event) => {
    setFormData({ ...formData, [event.target.name]: event.target.value });
  };

  const handleAddAnnouncement = () => {
    setEditingAnnouncement(null);
    setFormData(defaultForm);
    setShowModal(true);
  };

  const handleEditAnnouncement = (announcement) => {
    setEditingAnnouncement(announcement);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      icon_type: announcement.icon_type || 'megaphone',
      icon_color: announcement.icon_color || 'blue',
      is_active: announcement.is_active,
    });
    setShowModal(true);
  };

  const handleSaveAnnouncement = async () => {
    if (!formData.title || !formData.content) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      if (editingAnnouncement) {
        await api.put(`/branch/announcements/${editingAnnouncement.id}`, formData);
      } else {
        await api.post('/branch/announcements', formData);
      }
      await fetchAnnouncements();
      setShowModal(false);
      setFormData(defaultForm);
    } catch (error) {
      console.error('Failed to save branch announcement:', error);
      alert('Failed to save announcement: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (window.confirm('Are you sure you want to delete this announcement?')) {
      try {
        await api.delete(`/branch/announcements/${id}`);
        await fetchAnnouncements();
      } catch (error) {
        console.error('Failed to delete branch announcement:', error);
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
        eyebrow="Branch Dashboard"
        title="Announcements"
        subtitle="Publish and manage branch-level announcements for local staff visibility and operations updates."
        actions={(
          <button
            onClick={handleAddAnnouncement}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg"
          >
            + Create Announcement
          </button>
        )}
      />

      <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-blue-900">
        Active branch announcements are shown on the public website with your branch name attached as the source label.
      </div>

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
                      {announcement.branch_name && announcement.is_active && (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                          Branch Source: {announcement.branch_name}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-4">{announcement.content}</p>
                    <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
                      <span>Published: {formatDate(announcement.publish_date)}</span>
                      <span>Created by: {announcement.created_by || 'Branch Staff'}</span>
                    </div>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full mx-4">
            <h3 className="text-2xl font-bold text-primary mb-2">
              {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
            </h3>
            <p className="text-gray-600 mb-6">
              When this announcement is active, the public website will show your branch name as the source.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Content</label>
                <textarea
                  name="content"
                  value={formData.content}
                  onChange={handleInputChange}
                  rows="4"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  required
                ></textarea>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Icon Type</label>
                  <select
                    name="icon_type"
                    value={formData.icon_type}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  >
                    <option value="megaphone">Megaphone</option>
                    <option value="check">Check Mark</option>
                    <option value="clock">Clock</option>
                    <option value="info">Info</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Icon Color</label>
                  <select
                    name="icon_color"
                    value={formData.icon_color}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  >
                    <option value="blue">Blue</option>
                    <option value="green">Green</option>
                    <option value="yellow">Yellow</option>
                    <option value="red">Red</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={formData.is_active}
                    onChange={(event) => setFormData({ ...formData, is_active: event.target.checked })}
                    className="w-5 h-5"
                  />
                  <span className="text-gray-700 font-semibold">Active (visible to public with branch label)</span>
                </label>
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAnnouncement}
                disabled={loading}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {loading ? 'Saving...' : (editingAnnouncement ? 'Update' : 'Publish')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchAnnouncements;
