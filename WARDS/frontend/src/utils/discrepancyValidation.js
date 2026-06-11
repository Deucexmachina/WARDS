import { getFriendlyErrorMessage } from './errorMessages';

export const DISCREPANCY_TITLE_MAX_LENGTH = 255;

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

export const getDiscrepancyValidationErrors = (formData) => {
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
