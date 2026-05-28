export const BRANCH_REPORT_VIEWED_EVENT = 'branch-report-viewed';
export const BRANCH_REPORTS_UPDATED_EVENT = 'branch-reports-updated';

const getBranchReportViewStorageKey = (branchUser) => {
  const branchId = branchUser?.branch_id || 'unknown-branch';
  const username = branchUser?.username || branchUser?.full_name || 'unknown-user';
  return `branchViewedReports:${branchId}:${username}`;
};

export const getViewedBranchReportIds = (branchUser) => {
  try {
    const rawValue = window.localStorage.getItem(getBranchReportViewStorageKey(branchUser));
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsedValue) ? parsedValue.map((value) => Number(value)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
};

export const setViewedBranchReportIds = (branchUser, reportIds) => {
  const normalized = Array.from(new Set((reportIds || []).map((value) => Number(value)).filter(Number.isFinite)));
  window.localStorage.setItem(getBranchReportViewStorageKey(branchUser), JSON.stringify(normalized));
  return normalized;
};

export const markBranchReportViewed = (branchUser, reportId) => {
  const normalizedId = Number(reportId);
  if (!Number.isFinite(normalizedId)) {
    return getViewedBranchReportIds(branchUser);
  }

  const currentIds = getViewedBranchReportIds(branchUser);
  if (currentIds.includes(normalizedId)) {
    return currentIds;
  }

  const nextIds = [...currentIds, normalizedId];
  setViewedBranchReportIds(branchUser, nextIds);
  return nextIds;
};

export const applyBranchReportViewedState = (reports, branchUser) => {
  const viewedIds = new Set(getViewedBranchReportIds(branchUser));
  return (reports || []).map((report) => ({
    ...report,
    is_viewed: viewedIds.has(Number(report?.id)),
  }));
};

export const getUnreadBranchReportCount = (reports, branchUser) => {
  const viewedIds = new Set(getViewedBranchReportIds(branchUser));
  return (reports || []).filter((report) => !viewedIds.has(Number(report?.id))).length;
};

