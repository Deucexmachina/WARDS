export const ACTIVITY_LOGS_UPDATED_EVENT = 'activity-logs-updated';
export const ACTIVITY_LOGS_VIEWED_EVENT = 'activity-logs-viewed';

const buildActivityLogStorageKey = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const username = adminUser?.username || adminUser?.email || 'admin';
  const role = adminUser?.internal_role || adminUser?.role || 'admin';
  return `wards:activity-logs:last-viewed:${role}:${username}`;
};

export const getActivityLogsLastViewedAt = () => localStorage.getItem(buildActivityLogStorageKey()) || '';

export const markActivityLogsViewed = () => {
  const viewedAt = new Date().toISOString();
  localStorage.setItem(buildActivityLogStorageKey(), viewedAt);
  window.dispatchEvent(new CustomEvent(ACTIVITY_LOGS_VIEWED_EVENT, {
    detail: {
      unreadCount: 0,
      viewedAt,
    },
  }));
  return viewedAt;
};

export const notifyActivityLogsUpdated = () => {
  window.dispatchEvent(new CustomEvent(ACTIVITY_LOGS_UPDATED_EVENT));
};
