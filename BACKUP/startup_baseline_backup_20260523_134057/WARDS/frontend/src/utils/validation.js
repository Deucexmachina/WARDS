export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REAL_EMAIL_RULE_MESSAGE = 'Please enter a real email address, like name@example.com.';

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
