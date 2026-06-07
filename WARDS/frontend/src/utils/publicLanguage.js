import { useEffect, useState } from 'react';

export const PUBLIC_LANGUAGE_STORAGE_KEY = 'wards-public-language';
export const PUBLIC_LANGUAGE_EVENT = 'wards-public-language-change';

export const normalizePublicLanguage = (language) => (language === 'tl' ? 'tl' : 'en');

export const getPublicLanguage = () => normalizePublicLanguage(sessionStorage.getItem(PUBLIC_LANGUAGE_STORAGE_KEY) || 'en');

export const resolvePublicLanguage = (searchParams) => {
  const urlLanguage = searchParams?.get?.('lang');
  if (urlLanguage === 'tl' || urlLanguage === 'en') {
    return urlLanguage;
  }

  return getPublicLanguage();
};

export const setPublicLanguage = (language) => {
  const nextLanguage = normalizePublicLanguage(language);
  sessionStorage.setItem(PUBLIC_LANGUAGE_STORAGE_KEY, nextLanguage);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PUBLIC_LANGUAGE_EVENT));
  }
};

export const appendLanguageParam = (path, language) => {
  const nextLanguage = normalizePublicLanguage(language);
  const input = String(path || '');
  const [pathAndQuery, hash = ''] = input.split('#');
  const [pathname, query = ''] = pathAndQuery.split('?');
  const params = new URLSearchParams(query);
  params.set('lang', nextLanguage);
  const queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ''}${hash ? `#${hash}` : ''}`;
};

export const usePublicLanguage = () => {
  const [language, setLanguageState] = useState(() => getPublicLanguage());

  useEffect(() => {
    const syncLanguage = () => setLanguageState(getPublicLanguage());
    window.addEventListener('storage', syncLanguage);
    window.addEventListener(PUBLIC_LANGUAGE_EVENT, syncLanguage);
    window.addEventListener('focus', syncLanguage);
    return () => {
      window.removeEventListener('storage', syncLanguage);
      window.removeEventListener(PUBLIC_LANGUAGE_EVENT, syncLanguage);
      window.removeEventListener('focus', syncLanguage);
    };
  }, []);

  const setLanguage = (nextValue) => {
    const nextLanguage = typeof nextValue === 'function' ? nextValue(getPublicLanguage()) : nextValue;
    setPublicLanguage(nextLanguage);
    setLanguageState(getPublicLanguage());
  };

  return [language, setLanguage];
};
