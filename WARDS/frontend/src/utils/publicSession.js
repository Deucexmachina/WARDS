export const PUBLIC_USER_STORAGE_EVENT = 'wards:public-user-updated';

export const getStoredPublicUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || localStorage.getItem('publicUser') || 'null');
  } catch {
    return null;
  }
};

export const setStoredPublicUser = (user) => {
  const serialized = JSON.stringify(user || null);
  localStorage.setItem('user', serialized);
  localStorage.setItem('publicUser', serialized);
  window.dispatchEvent(new CustomEvent(PUBLIC_USER_STORAGE_EVENT, { detail: user || null }));
};

export const clearStoredPublicUser = () => {
  localStorage.removeItem('user');
  localStorage.removeItem('publicUser');
  window.dispatchEvent(new CustomEvent(PUBLIC_USER_STORAGE_EVENT, { detail: null }));
};
