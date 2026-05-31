export const BRANCH_REPORT_VIEWED_EVENT = 'branch-report-viewed';
export const BRANCH_REPORTS_UPDATED_EVENT = 'branch-reports-updated';

const getScopedReportViewStorageKey = (scope, identifierParts = []) => {
  const normalizedScope = scope || 'report';
  const normalizedParts = identifierParts
    .map((value) => `${value || 'unknown'}`.trim() || 'unknown')
    .join(':');
  return `${normalizedScope}ViewedReports:${normalizedParts}`;
};

const getBranchReportViewStorageKey = (branchUser) => {
  const branchId = branchUser?.branch_id || 'unknown-branch';
  const username = branchUser?.username || branchUser?.full_name || 'unknown-user';
  return getScopedReportViewStorageKey('branch', [branchId, username]);
};

const getAdminReportViewStorageKey = (adminUser) => {
  const role = adminUser?.internal_role || adminUser?.role || 'unknown-role';
  const username = adminUser?.username || adminUser?.full_name || 'unknown-user';
  return getScopedReportViewStorageKey('admin', [role, username]);
};

const getViewedReportIds = (storageKey) => {
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsedValue) ? parsedValue.map((value) => Number(value)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
};

const setViewedReportIds = (storageKey, reportIds) => {
  const normalized = Array.from(new Set((reportIds || []).map((value) => Number(value)).filter(Number.isFinite)));
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
};

const markReportViewed = (storageKey, reportId) => {
  const normalizedId = Number(reportId);
  if (!Number.isFinite(normalizedId)) {
    return getViewedReportIds(storageKey);
  }

  const currentIds = getViewedReportIds(storageKey);
  if (currentIds.includes(normalizedId)) {
    return currentIds;
  }

  const nextIds = [...currentIds, normalizedId];
  setViewedReportIds(storageKey, nextIds);
  return nextIds;
};

const applyReportViewedState = (reports, viewedIds) => (
  (reports || []).map((report) => ({
    ...report,
    is_viewed: viewedIds.has(Number(report?.id)),
  }))
);

const getUnreadReportCount = (reports, viewedIds) => (
  (reports || []).filter((report) => !viewedIds.has(Number(report?.id))).length
);

export const getViewedAdminReportIds = (adminUser) => {
  try {
    return getViewedReportIds(getAdminReportViewStorageKey(adminUser));
  } catch {
    return [];
  }
};

export const getViewedBranchReportIds = (branchUser) => {
  try {
    return getViewedReportIds(getBranchReportViewStorageKey(branchUser));
  } catch {
    return [];
  }
};

export const setViewedBranchReportIds = (branchUser, reportIds) => {
  return setViewedReportIds(getBranchReportViewStorageKey(branchUser), reportIds);
};

export const markBranchReportViewed = (branchUser, reportId) => {
  return markReportViewed(getBranchReportViewStorageKey(branchUser), reportId);
};

export const applyBranchReportViewedState = (reports, branchUser) => {
  const viewedIds = new Set(getViewedBranchReportIds(branchUser));
  return applyReportViewedState(reports, viewedIds);
};

export const getUnreadBranchReportCount = (reports, branchUser) => {
  const viewedIds = new Set(getViewedBranchReportIds(branchUser));
  return getUnreadReportCount(reports, viewedIds);
};

export const setViewedAdminReportIds = (adminUser, reportIds) => (
  setViewedReportIds(getAdminReportViewStorageKey(adminUser), reportIds)
);

export const markAdminReportViewed = (adminUser, reportId) => (
  markReportViewed(getAdminReportViewStorageKey(adminUser), reportId)
);

export const applyAdminReportViewedState = (reports, adminUser) => {
  const viewedIds = new Set(getViewedAdminReportIds(adminUser));
  return applyReportViewedState(reports, viewedIds);
};

export const getUnreadAdminReportCount = (reports, adminUser) => {
  const viewedIds = new Set(getViewedAdminReportIds(adminUser));
  return getUnreadReportCount(reports, viewedIds);
};
