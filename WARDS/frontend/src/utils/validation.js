export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CITIZEN_NAME_PATTERN = /^[A-Za-z ]+$/;
export const PH_CONTACT_DIGITS_PATTERN = /^9\d{9}$/;
export const REAL_EMAIL_RULE_MESSAGE = 'Please enter a valid email address.';
export const CITIZEN_NAME_RULE_MESSAGE = 'Full name must contain letters and spaces only.';
export const PH_CONTACT_RULE_MESSAGE = 'Contact number must begin with 9 and contain exactly 10 digits.';

export const PASSWORD_RULE_MESSAGE =
  'Password must be more than 12 characters long and include at least one uppercase letter, one lowercase letter, and at least one number or special character.';

export const DUPLICATE_EMAIL_MESSAGE = 'This email has already been used.';
export const TIN_RULE_MESSAGE = 'Invalid TIN. Please enter a valid 9–12 digit Tax Identification Number.';
export const TIN_DIGITS_PATTERN = /^\d{9,12}$/;

export const isValidEmail = (value) => EMAIL_PATTERN.test(String(value || '').trim());

export const getEmailValidationMessage = (value, { required = true } = {}) => {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return required ? 'Email address is required.' : '';
  }

  if (!isValidEmail(trimmedValue)) {
    return REAL_EMAIL_RULE_MESSAGE;
  }

  return '';
};

export const normalizeTin = (value) => String(value || '').replace(/\D/g, '').slice(0, 12);

export const formatTin = (value) => {
  const digits = normalizeTin(value);
  return digits.replace(/(\d{3})(?=\d)/g, '$1-');
};

export const validateTin = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return TIN_RULE_MESSAGE;
  }

  if (!/^[\d\s-]+$/.test(rawValue)) {
    return TIN_RULE_MESSAGE;
  }

  const digits = normalizeTin(rawValue);
  if (!TIN_DIGITS_PATTERN.test(digits)) {
    return TIN_RULE_MESSAGE;
  }

  return '';
};

export const validateStrongPassword = (password) => {
  if (password.length <= 12) {
    return PASSWORD_RULE_MESSAGE;
  }

  if (!/[A-Z]/.test(password)) {
    return PASSWORD_RULE_MESSAGE;
  }

  if (!/[a-z]/.test(password)) {
    return PASSWORD_RULE_MESSAGE;
  }

  if (!/[\d\W]/.test(password)) {
    return PASSWORD_RULE_MESSAGE;
  }

  return '';
};

export const normalizeCitizenFullName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const validateCitizenFullName = (value) => {
  const normalized = normalizeCitizenFullName(value);
  if (!normalized) {
    return 'Full name is required.';
  }

  if (!CITIZEN_NAME_PATTERN.test(normalized)) {
    return CITIZEN_NAME_RULE_MESSAGE;
  }

  return '';
};

export const normalizePhilippineContactDigits = (value) => {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('63')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits && !digits.startsWith('9')) {
    const firstNineIndex = digits.indexOf('9');
    digits = firstNineIndex >= 0 ? digits.slice(firstNineIndex) : '';
  }

  return digits.slice(0, 10);
};

export const formatPhilippineContactNumber = (digits) => {
  const normalizedDigits = normalizePhilippineContactDigits(digits);
  if (!normalizedDigits) {
    return '';
  }

  const first = normalizedDigits.slice(0, 3);
  const second = normalizedDigits.slice(3, 6);
  const third = normalizedDigits.slice(6, 10);

  return [first, second, third].filter(Boolean).join(' ');
};

export const toCanonicalPhilippineContactNumber = (value) => {
  const normalizedDigits = normalizePhilippineContactDigits(value);
  return normalizedDigits ? `+63${normalizedDigits}` : '';
};

export const validatePhilippineContactDigits = (value) => {
  const normalizedDigits = normalizePhilippineContactDigits(value);
  if (!normalizedDigits) {
    return 'Contact number is required.';
  }

  if (!PH_CONTACT_DIGITS_PATTERN.test(normalizedDigits)) {
    return PH_CONTACT_RULE_MESSAGE;
  }

  return '';
};
