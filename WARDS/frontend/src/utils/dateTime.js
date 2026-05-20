export const UTC_PLUS_8_TIME_ZONE = 'Asia/Manila';

const TIMEZONE_SUFFIX_PATTERN = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

export const parseUtcDate = (value) => {
  if (!value) {
    return null;
  }

  const normalizedValue =
    typeof value === 'string' && !TIMEZONE_SUFFIX_PATTERN.test(value)
      ? `${value}Z`
      : value;

  const parsedDate = new Date(normalizedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

export const formatUtc8 = (value, options = {}, locale = 'en-US') => {
  const parsedDate = parseUtcDate(value);
  if (!parsedDate) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: UTC_PLUS_8_TIME_ZONE,
    ...options,
  }).format(parsedDate);
};

export const formatUtc8Date = (value, locale = 'en-US', options = {}) =>
  formatUtc8(
    value,
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...options,
    },
    locale,
  );

export const formatUtc8Time = (value, locale = 'en-US', options = {}) =>
  formatUtc8(
    value,
    {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      ...options,
    },
    locale,
  );

export const formatUtc8DateTime = (value, locale = 'en-US', options = {}) =>
  formatUtc8(
    value,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      ...options,
    },
    locale,
  );

export const getUtc8DateKey = (value) =>
  formatUtc8(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

export const isSameUtc8Day = (leftValue, rightValue = new Date()) => {
  const leftDate = parseUtcDate(leftValue);
  const rightDate = parseUtcDate(rightValue);

  if (!leftDate || !rightDate) {
    return false;
  }

  return getUtc8DateKey(leftDate) === getUtc8DateKey(rightDate);
};
