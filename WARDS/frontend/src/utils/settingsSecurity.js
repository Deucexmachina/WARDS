export const SETTINGS_AUTH_STORAGE_KEY = 'settingsAuthenticated';
export const SETTINGS_AUTH_AT_STORAGE_KEY = 'settingsAuthenticatedAt';
export const BRANCH_SETTINGS_AUTH_STORAGE_KEY = 'branchSettingsAuthenticated';
export const BRANCH_SETTINGS_AUTH_AT_STORAGE_KEY = 'branchSettingsAuthenticatedAt';

export const SETTINGS_ALLOWED_ROLES = new Set(['main_admin', 'superadmin']);
export const BRANCH_SETTINGS_ALLOWED_ROLES = new Set(['branch_admin']);

const SETTINGS_SECURITY_CONFIG = {
  admin: {
    authKey: SETTINGS_AUTH_STORAGE_KEY,
    authAtKey: SETTINGS_AUTH_AT_STORAGE_KEY,
    allowedRoles: SETTINGS_ALLOWED_ROLES,
  },
  branch: {
    authKey: BRANCH_SETTINGS_AUTH_STORAGE_KEY,
    authAtKey: BRANCH_SETTINGS_AUTH_AT_STORAGE_KEY,
    allowedRoles: BRANCH_SETTINGS_ALLOWED_ROLES,
  },
};

export const getSettingsSecurityConfig = (scope = 'admin') => (
  SETTINGS_SECURITY_CONFIG[scope] || SETTINGS_SECURITY_CONFIG.admin
);

export const clearScopedSettingsSession = (scope = 'admin') => {
  const { authKey, authAtKey } = getSettingsSecurityConfig(scope);
  localStorage.removeItem(authKey);
  localStorage.removeItem(authAtKey);
  sessionStorage.removeItem(authKey);
  sessionStorage.removeItem(authAtKey);
};

export const startScopedSettingsSession = (scope = 'admin') => {
  const { authKey, authAtKey } = getSettingsSecurityConfig(scope);
  const authenticatedAt = new Date().toISOString();
  sessionStorage.setItem(authKey, 'true');
  sessionStorage.setItem(authAtKey, authenticatedAt);
};

export const isScopedSettingsSessionActive = (scope = 'admin') => {
  const { authKey } = getSettingsSecurityConfig(scope);
  return sessionStorage.getItem(authKey) === 'true';
};

export const isScopedSettingsRoleAllowed = (user, scope = 'admin') => (
  getSettingsSecurityConfig(scope).allowedRoles.has(user?.internal_role)
);

export const clearSettingsSession = () => clearScopedSettingsSession('admin');
export const startSettingsSession = () => startScopedSettingsSession('admin');
export const isSettingsSessionActive = () => isScopedSettingsSessionActive('admin');
export const isSettingsRoleAllowed = (user) => isScopedSettingsRoleAllowed(user, 'admin');
export const clearBranchSettingsSession = () => clearScopedSettingsSession('branch');
export const startBranchSettingsSession = () => startScopedSettingsSession('branch');
export const isBranchSettingsSessionActive = () => isScopedSettingsSessionActive('branch');
export const isBranchSettingsRoleAllowed = (user) => isScopedSettingsRoleAllowed(user, 'branch');
