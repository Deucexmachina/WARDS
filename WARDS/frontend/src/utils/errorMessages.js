const TECHNICAL_PATTERNS = [
  /client error/i,
  /server error/i,
  /traceback/i,
  /sqlalchemy/i,
  /attributeerror/i,
  /typeerror/i,
  /httpexception/i,
  /bad request for url/i,
  /https?:\/\//i,
  /\{"?errors"?\s*:/i,
  /parameter_format_invalid/i,
];

const extractDetail = (error) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message || item?.detail)
      .filter(Boolean)
      .join(' ');
  }
  if (detail && typeof detail === 'object') {
    return detail.message || detail.error || '';
  }
  return typeof detail === 'string' ? detail : '';
};

const isTechnicalMessage = (message) => (
  TECHNICAL_PATTERNS.some((pattern) => pattern.test(message || ''))
);

export const getFriendlyErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const status = error?.response?.status;
  const url = String(error?.config?.url || '').toLowerCase();

  if (status === 429) {
    return 'Too many requests were sent in a short time. Please wait a moment, then try again.';
  }
  if (status === 401) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status === 403) {
    const detail = extractDetail(error);
    if (detail && !isTechnicalMessage(detail)) {
      return detail;
    }
    return 'You do not have permission to perform this action.';
  }
  if (status === 404) {
    if (url.includes('/payments/rpt/search')) {
      return 'Please select the correct branch.';
    }
    return 'The requested record could not be found.';
  }
  if (status >= 500) {
    const detail = extractDetail(error);
    if (detail && !isTechnicalMessage(detail)) {
      return detail;
    }
    return 'The server encountered a problem. Please try again later.';
  }

  const detail = extractDetail(error);
  if (detail && !isTechnicalMessage(detail)) {
    return detail;
  }

  return fallback;
};

export const getModalToneForError = (error) => (
  error?.response?.status === 429 ? 'error' : 'error'
);

export const shouldSuppressGlobalErrorModal = (error) => {
  const url = String(error?.config?.url || '').toLowerCase();
  return (
    url.includes('/auth/') ||
    url.includes('_auth') ||
    url.includes('/login') ||
    url.includes('/setup-mfa') ||
    url.includes('/verify-mfa') ||
    url.includes('/receipts/') ||
    url.includes('/tax-assessment/') && url.includes('/file')
  );
};
