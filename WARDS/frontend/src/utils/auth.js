import { clearStoredPublicUser, setStoredPublicUser } from './publicSession';

const DEFAULT_BRANCH_PORTAL_PATH = '/branch-dashboard/branch-portal';

export const getBranchPortalPath = (branchUser) => {
  const isQueueWindowAccount = branchUser?.account_scope === 'queue_window';

  const dashboardUrl = branchUser?.dashboard_url;

  if (dashboardUrl) {
    try {
      const parsed = new URL(dashboardUrl);
      const resolvedPath = parsed.pathname || DEFAULT_BRANCH_PORTAL_PATH;
      return isQueueWindowAccount && !resolvedPath.endsWith('/queue')
        ? `${resolvedPath}/queue`
        : resolvedPath;
    } catch {
      if (dashboardUrl.startsWith('/')) {
        return isQueueWindowAccount && !dashboardUrl.endsWith('/queue')
          ? `${dashboardUrl}/queue`
          : dashboardUrl;
      }
    }
  }

  if (branchUser?.branch_id) {
    const fallbackPath = `/branch-dashboard/branch-${branchUser.branch_id}`;
    return isQueueWindowAccount ? `${fallbackPath}/queue` : fallbackPath;
  }

  return isQueueWindowAccount ? `${DEFAULT_BRANCH_PORTAL_PATH}/queue` : DEFAULT_BRANCH_PORTAL_PATH;
};

export const getStoredPortal = () => {
  const portal = localStorage.getItem('wardsPortal');
  if (portal) {
    return portal;
  }
  return null;
};

export const getPortalHome = (portal) => {
  if (portal === 'admin') {
    return '/admin-dashboard';
  }

  if (portal === 'branch') {
    try {
      const branchUser = JSON.parse(localStorage.getItem('branchUser') || '{}');
      return getBranchPortalPath(branchUser);
    } catch {
      return DEFAULT_BRANCH_PORTAL_PATH;
    }
  }

  return '/';
};

export const persistSession = ({
  portal,
  access_token,
  user,
  mfa_setup_required,
  preserveAdminSession = false,
}) => {
  const enrichedUser = mfa_setup_required !== undefined
    ? { ...user, mfa_setup_required }
    : user;

  if (portal === 'admin') {
    localStorage.setItem('wardsPortal', 'admin');
    localStorage.setItem('adminUser', JSON.stringify(enrichedUser));
    localStorage.setItem('adminAuthenticatedAt', new Date().toISOString());
    localStorage.removeItem('securityAuthenticated');
    localStorage.removeItem('securityAuthenticatedAt');
    localStorage.removeItem('settingsAuthenticated');
    localStorage.removeItem('settingsAuthenticatedAt');
    sessionStorage.removeItem('securityAuthenticated');
    sessionStorage.removeItem('securityAuthenticatedAt');
    sessionStorage.removeItem('settingsAuthenticated');
    sessionStorage.removeItem('settingsAuthenticatedAt');
    // Clean up legacy tokens
    localStorage.removeItem('branchToken');
    localStorage.removeItem('branchUser');
    localStorage.removeItem('userToken');
    clearStoredPublicUser();
    return;
  }

  if (portal === 'branch') {
    localStorage.setItem('wardsPortal', 'branch');
    localStorage.setItem('branchUser', JSON.stringify(enrichedUser));
    localStorage.setItem('branchAuthenticatedAt', new Date().toISOString());
    localStorage.removeItem('branchSettingsAuthenticated');
    localStorage.removeItem('branchSettingsAuthenticatedAt');
    sessionStorage.removeItem('branchSettingsAuthenticated');
    sessionStorage.removeItem('branchSettingsAuthenticatedAt');
    if (!preserveAdminSession) {
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
    }
    // Clean up legacy tokens
    localStorage.removeItem('userToken');
    localStorage.removeItem('adminToken');
    clearStoredPublicUser();
    return;
  }

  localStorage.setItem('wardsPortal', 'public');
  setStoredPublicUser(enrichedUser);
  localStorage.setItem('userAuthenticatedAt', new Date().toISOString());
  // Clean up legacy tokens
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  localStorage.removeItem('branchToken');
  localStorage.removeItem('branchUser');
};

export const clearSession = (portal) => {
  if (portal === 'admin') {
    localStorage.removeItem('wardsPortal');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    localStorage.removeItem('adminAuthenticatedAt');
    localStorage.removeItem('securityAuthenticated');
    localStorage.removeItem('securityAuthenticatedAt');
    localStorage.removeItem('settingsAuthenticated');
    localStorage.removeItem('settingsAuthenticatedAt');
    sessionStorage.removeItem('securityAuthenticated');
    sessionStorage.removeItem('securityAuthenticatedAt');
    sessionStorage.removeItem('settingsAuthenticated');
    sessionStorage.removeItem('settingsAuthenticatedAt');
    return;
  }

  if (portal === 'branch') {
    localStorage.removeItem('wardsPortal');
    localStorage.removeItem('branchToken');
    localStorage.removeItem('branchUser');
    localStorage.removeItem('branchAuthenticatedAt');
    localStorage.removeItem('branchSettingsAuthenticated');
    localStorage.removeItem('branchSettingsAuthenticatedAt');
    sessionStorage.removeItem('branchSettingsAuthenticated');
    sessionStorage.removeItem('branchSettingsAuthenticatedAt');
    return;
  }

  localStorage.removeItem('wardsPortal');
  localStorage.removeItem('userToken');
  clearStoredPublicUser();
  localStorage.removeItem('userAuthenticatedAt');
};
