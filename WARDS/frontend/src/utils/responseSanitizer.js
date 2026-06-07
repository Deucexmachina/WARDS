// NOTE: This is NOT an XSS sanitizer. It does not sanitize HTML or URLs.
// This utility only strips hash suffixes from placeholder field names for display purposes.
// For XSS protection, the application relies on React's built-in auto-escaping and
// backend output encoding (html.escape in Python email templates).

const HASHED_PLACEHOLDER_PATTERN = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_[a-f0-9]{16}\b/g;

export const stripPlaceholderSuffixInText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(HASHED_PLACEHOLDER_PATTERN, '$1');
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  Object.prototype.toString.call(value) === '[object Object]';

export const stripPlaceholderSuffixInResponse = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripPlaceholderSuffixInResponse);
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((acc, [key, itemValue]) => {
      acc[key] = stripPlaceholderSuffixInResponse(itemValue);
      return acc;
    }, {});
  }

  return stripPlaceholderSuffixInText(value);
};
