const HASHED_PLACEHOLDER_PATTERN = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)_[a-f0-9]{16}\b/g;

export const sanitizeHashedPlaceholdersInText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(HASHED_PLACEHOLDER_PATTERN, '$1');
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  Object.prototype.toString.call(value) === '[object Object]';

export const sanitizeApiResponseData = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizeApiResponseData);
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((acc, [key, itemValue]) => {
      acc[key] = sanitizeApiResponseData(itemValue);
      return acc;
    }, {});
  }

  return sanitizeHashedPlaceholdersInText(value);
};
