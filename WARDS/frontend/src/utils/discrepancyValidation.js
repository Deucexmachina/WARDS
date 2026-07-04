import { getFriendlyErrorMessage } from './errorMessages';

export const DISCREPANCY_TITLE_MAX_LENGTH = 255;

export const DISCREPANCY_ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
export const DISCREPANCY_ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

export const getCurrentSystemDateInputValue = () => {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().split('T')[0];
};

export const getInitialDiscrepancyForm = () => ({
  title: '',
  report_date: getCurrentSystemDateInputValue(),
  discrepancy_type: '',
  description: '',
  other_specification: '',
  supporting_documents: '',
  submitted_offline: false,
});

export const validateDiscrepancyAttachment = (file) => {
  if (!file) {
    return '';
  }

  const name = String(file.name || '');
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!DISCREPANCY_ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return 'Unsupported file type. Only PDF, PNG, or JPEG files are allowed.';
  }

  const mimeType = String(file.type || '');
  if (mimeType && !DISCREPANCY_ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
    return 'Unsupported file type. Only PDF, PNG, or JPEG files are allowed.';
  }

  return '';
};

export const getDiscrepancyValidationErrors = (formData, attachmentFile = null) => {
  const errors = {};
  const title = String(formData?.title || '').trim();
  const reportDate = String(formData?.report_date || '').trim();
  const discrepancyType = String(formData?.discrepancy_type || '').trim();
  const description = String(formData?.description || '').trim();
  const otherSpecification = String(formData?.other_specification || '').trim();

  if (!title) {
    errors.title = 'Please enter the Title / Subject.';
  } else if (title.length > DISCREPANCY_TITLE_MAX_LENGTH) {
    errors.title = `Title / Subject must not exceed ${DISCREPANCY_TITLE_MAX_LENGTH} characters.`;
  }

  if (!reportDate) {
    errors.report_date = 'Report Date is required.';
  }

  if (!discrepancyType) {
    errors.discrepancy_type = 'Please select a discrepancy type.';
  }

  if (discrepancyType === 'Other' && !otherSpecification) {
    errors.other_specification = 'Please specify the discrepancy type.';
  }

  if (!description) {
    errors.description = 'Please enter the Discrepancy Details.';
  }

  const attachmentError = validateDiscrepancyAttachment(attachmentFile);
  if (attachmentError) {
    errors.attachment = attachmentError;
  }

  return errors;
};

export const getDiscrepancyValidationSummary = (errors) => (
  Object.keys(errors || {}).length
    ? 'Please correct the highlighted discrepancy fields before submitting.'
    : ''
);

export const getDiscrepancySubmitErrorMessage = (error) => (
  getFriendlyErrorMessage(error, 'Failed to submit discrepancy report.')
);
