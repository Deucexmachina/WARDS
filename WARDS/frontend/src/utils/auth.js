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
  if (localStorage.getItem('adminToken')) {
    return 'admin';
  }

  if (localStorage.getItem('branchToken')) {
    return 'branch';
  }

  if (localStorage.getItem('userToken')) {
    return 'public';
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

export const persistSession = ({ portal, access_token, user, mfa_setup_required }) => {
  const enrichedUser = mfa_setup_required !== undefined
    ? { ...user, mfa_setup_required }
    : user;

  if (portal === 'admin') {
    localStorage.setItem('adminToken', access_token);
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
    localStorage.removeItem('branchToken');
    localStorage.removeItem('branchUser');
    localStorage.removeItem('userToken');
    clearStoredPublicUser();
    return;
  }

  if (portal === 'branch') {
    localStorage.setItem('branchToken', access_token);
    localStorage.setItem('branchUser', JSON.stringify(enrichedUser));
    localStorage.setItem('branchAuthenticatedAt', new Date().toISOString());
    localStorage.removeItem('branchSettingsAuthenticated');
    localStorage.removeItem('branchSettingsAuthenticatedAt');
    sessionStorage.removeItem('branchSettingsAuthenticated');
    sessionStorage.removeItem('branchSettingsAuthenticatedAt');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    localStorage.removeItem('userToken');
    clearStoredPublicUser();
    return;
  }

  localStorage.setItem('userToken', access_token);
  setStoredPublicUser(enrichedUser);
  localStorage.setItem('userAuthenticatedAt', new Date().toISOString());
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  localStorage.removeItem('branchToken');
  localStorage.removeItem('branchUser');
};

export const clearSession = (portal) => {
  if (portal === 'admin') {
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
    localStorage.removeItem('branchToken');
    localStorage.removeItem('branchUser');
    localStorage.removeItem('branchAuthenticatedAt');
    localStorage.removeItem('branchSettingsAuthenticated');
    localStorage.removeItem('branchSettingsAuthenticatedAt');
    sessionStorage.removeItem('branchSettingsAuthenticated');
    sessionStorage.removeItem('branchSettingsAuthenticatedAt');
    return;
  }

  localStorage.removeItem('userToken');
  clearStoredPublicUser();
  localStorage.removeItem('userAuthenticatedAt');
};
