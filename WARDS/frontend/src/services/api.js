import axios from 'axios';
import { sanitizeApiResponseData } from '../utils/responseSanitizer';

const API_BASE_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  // Determine which token to use based on the route
  let token = null;
  const url = config.url || '';
  
  if (
    url.includes('/user/auth') ||
    url.includes('/user/') ||
    url.includes('/tax-assessment/user/')
  ) {
    token = localStorage.getItem('userToken');
  } else if (url.includes('/branch/auth') || url.includes('/branch/')) {
    token = localStorage.getItem('branchToken');
  } else if (url.includes('/admin/auth') || url.includes('/admin/') ||
             url.includes('/tax-assessment/admin/') ||
             url.includes('/branches') || url.includes('/reports') ||
             url.includes('/dashboard') ||
             url.includes('/security') ||
             url.includes('/announcements') || url.includes('/memos') ||
             url.includes('/alerts') || url.includes('/activity-logs') ||
             url.includes('/backup') || url.includes('/policies') ||
             url.includes('/settings') || url.includes('/accounts') ||
             url.includes('/rbac')) {
    token = localStorage.getItem('adminToken');
  } else {
    // Default to checking all tokens for public routes
    token = localStorage.getItem('userToken') || 
            localStorage.getItem('branchToken') || 
            localStorage.getItem('adminToken');
  }
    
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const responseType = response?.config?.responseType;
    if (responseType === 'blob' || responseType === 'arraybuffer') {
      return response;
    }

    response.data = sanitizeApiResponseData(response.data);
    return response;
  },
  (error) => {
    const url = error?.config?.url || '';
    const hasAdminToken = Boolean(localStorage.getItem('adminToken'));
    const isAdminRequest =
      url.includes('/admin/') ||
      url.includes('/security') ||
      url.includes('/branches') ||
      url.includes('/reports') ||
      url.includes('/dashboard') ||
      url.includes('/announcements') ||
      url.includes('/memos') ||
      url.includes('/alerts') ||
      url.includes('/activity-logs') ||
      url.includes('/backup') ||
      url.includes('/policies') ||
      url.includes('/settings') ||
      url.includes('/accounts') ||
      url.includes('/rbac');

    if (hasAdminToken && isAdminRequest && (!error.response || [401, 403].includes(error.response.status))) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  getCurrentUser: () => api.get('/auth/me'),
};

export const branchAPI = {
  getAll: () => api.get('/branches'),
  getById: (id) => api.get(`/branches/${id}`),
  create: (data) => api.post('/branches', data),
  update: (id, data) => api.put(`/branches/${id}`, data),
  delete: (id) => api.delete(`/branches/${id}`),
  getQueueStatus: (id) => api.get(`/branches/${id}/queue`),
};

export const paymentAPI = {
  generateReference: (data) => api.post('/payments/generate-reference', data),
  processPayment: (data) => api.post('/payments/process', data),
  verifyPayment: (refNumber) => api.get(`/payments/verify/${refNumber}`),
  getTransactions: (params) => api.get('/payments/transactions', { params }),
  getAll: (params) => api.get('/payments', { params }),
  verifyById: (paymentId) => api.put(`/payments/${paymentId}/verify`),
  searchRptProperty: (params) => api.get('/payments/rpt/search', { params }),
  getActiveRptPayment: () => api.get('/payments/rpt/active-payment'),
  generateRptReference: (data) => api.post('/payments/rpt/generate-reference', data),
  uploadRptProof: (refNumber, formData) => api.post(`/payments/rpt/upload-proof/${refNumber}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  validateBusinessTaxRecord: (data) => api.post('/payments/bt/validate-record', data),
  listBusinessTaxApplications: (params) => api.get('/payments/bt/applications', { params }),
  getBusinessTaxApplication: (trackingNumber) => api.get(`/payments/bt/applications/${trackingNumber}`),
  uploadBusinessTaxDocuments: (trackingNumber, formData) => api.post(`/payments/bt/applications/${trackingNumber}/uploads`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  generateBusinessTaxReference: (trackingNumber, data) => api.post(`/payments/bt/applications/${trackingNumber}/generate-reference`, data),
  uploadBusinessTaxProof: (refNumber, formData) => api.post(`/payments/bt/upload-proof/${refNumber}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
};

export const taxpayerAccountAPI = {
  getAccount: () => api.get('/tax-assessment/user/account'),
  updateProfile: (data) => api.put('/tax-assessment/user/account/profile', data),
  submitIdentifier: (formData) => api.post('/tax-assessment/user/account/submissions', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getAssessments: (params) => api.get('/tax-assessment/user/account/assessments', { params }),
  downloadSubmissionFile: (submissionId) => api.get(`/tax-assessment/submissions/${submissionId}/file`, {
    responseType: 'blob'
  }),
};

export const taxAssessmentAPI = {
  listSubmissions: (params) => api.get('/tax-assessment/admin/submissions', { params }),
  reviewSubmission: (submissionId, data) => api.put(`/tax-assessment/admin/submissions/${submissionId}/review`, data),
  deleteSubmission: (submissionId) => api.delete(`/tax-assessment/admin/submissions/${submissionId}`),
  downloadSubmissionFile: (submissionId) => api.get(`/tax-assessment/admin/submissions/${submissionId}/file`, {
    responseType: 'blob'
  }),
  listAssessments: (params) => api.get('/tax-assessment/admin/assessments', { params }),
  saveAssessment: (data) => api.post('/tax-assessment/admin/assessments', data),
  deleteAssessment: (assessmentId) => api.delete(`/tax-assessment/admin/assessments/${assessmentId}`),
};

export const receiptAPI = {
  requestCopy: (data) => api.post('/receipts/request', data),
  getRequestStatus: (requestId) => api.get(`/receipts/request/${requestId}`),
  payRequestFee: (requestId, data) => api.post(`/receipts/request/${requestId}/pay`, data),
  uploadReleaseCopy: (requestId, formData) => api.post(`/receipts/requests/${requestId}/upload-release-copy`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  downloadReleaseCopy: (requestId) => api.get(`/receipts/requests/${requestId}/release-copy`, {
    responseType: 'blob'
  }),
  uploadProof: (formData) => api.post('/receipts/upload-proof', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  listRecords: () => api.get('/receipts/records'),
  uploadForOCR: (formData) => api.post('/receipts/records/ocr-upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  saveRecord: (data) => api.post('/receipts/records', data),
  deleteRecord: (recordId) => api.delete(`/receipts/records/${recordId}`),
  downloadRecordImage: (recordId) => api.get(`/receipts/records/${recordId}/image`, {
    responseType: 'blob'
  }),
  listRequests: () => api.get('/receipts/requests'),
  listRequestHistory: () => api.get('/receipts/requests/history'),
  deleteRequest: (requestId) => api.delete(`/receipts/requests/${requestId}`),
  deleteRequestHistory: (requestId) => api.delete(`/receipts/requests/history/${requestId}`),
  releaseRequest: (requestId) => api.post(`/receipts/requests/${requestId}/release`),
  completeAppointmentRequest: (requestId) => api.post(`/receipts/requests/${requestId}/complete-appointment`),
};

export const reportAPI = {
  getAll: (params) => api.get('/reports', { params }),
  getDetails: (reportId) => api.get(`/reports/${reportId}`),
  export: (reportId, format) => api.get(`/reports/${reportId}/export/${format}`, { responseType: 'blob' }),
  delete: (reportId) => api.delete(`/reports/${reportId}`),
};

export const branchReportAPI = {
  generate: (params) => api.post('/branch/reports/generate', params),
  getAll: (params) => api.get('/branch/reports', { params }),
  getDetails: (reportId) => api.get(`/branch/reports/${reportId}`),
  delete: (reportId) => api.delete(`/branch/reports/${reportId}`),
};

export const branchSettingsAPI = {
  getAppointmentSettings: () => api.get('/branch/settings/appointments'),
  getSystemSettings: () => api.get('/branch/settings/system'),
  saveSystemSettings: (data) => api.put('/branch/settings/system', data),
  getAppointmentHistory: (params) => api.get('/branch/settings/appointments/history', { params }),
  deleteAppointmentHistoryEntry: (id) => api.delete(`/branch/settings/appointments/history/${id}`),
  saveAppointmentSettings: (data) => api.put('/branch/settings/appointments', data),
  publishAppointmentSettings: (data) => api.post('/branch/settings/appointments/publish', data),
  setupBranchMfa: () => api.post('/branch/auth/setup-mfa-authenticated'),
};

const buildAttachmentFormData = (files) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return formData;
};

export const announcementAPI = {
  getAll: () => api.get('/announcements/'),
  getById: (id) => api.get(`/announcements/${id}`),
  getUnreadCount: () => api.get('/announcements/unread-count'),
  markViewed: (id) => api.post(`/announcements/${id}/mark-viewed`),
  create: (data) => api.post('/announcements/', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  delete: (id) => api.delete(`/announcements/${id}`),
  listAttachments: (id) => api.get(`/announcements/${id}/attachments`),
  uploadAttachments: (id, files, onUploadProgress) =>
    api.post(`/announcements/${id}/attachments`, buildAttachmentFormData(files), {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
  deleteAttachment: (id, attachmentId) =>
    api.delete(`/announcements/${id}/attachments/${attachmentId}`),
};

export const branchAnnouncementAPI = {
  getAll: () => api.get('/branch/announcements'),
  getUnreadCount: () => api.get('/branch/announcements/unread-count'),
  markViewed: (id) => api.post(`/branch/announcements/${id}/mark-viewed`),
  create: (data) => api.post('/branch/announcements', data),
  update: (id, data) => api.put(`/branch/announcements/${id}`, data),
  delete: (id) => api.delete(`/branch/announcements/${id}`),
  listAttachments: (id) => api.get(`/branch/announcements/${id}/attachments`),
  uploadAttachments: (id, files, onUploadProgress) =>
    api.post(`/branch/announcements/${id}/attachments`, buildAttachmentFormData(files), {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
  deleteAttachment: (id, attachmentId) =>
    api.delete(`/branch/announcements/${id}/attachments/${attachmentId}`),
};

export const memoAPI = {
  getAll: () => api.get('/memos'),
  getBranches: () => api.get('/memos/branches'),
  create: (data) => api.post('/memos', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, data) => api.put(`/memos/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (id) => api.delete(`/memos/${id}`),
  markViewed: (id) => api.post(`/memos/${id}/mark-viewed`),
  getUnreadCount: () => api.get('/memos/unread-count'),
};

export const discrepancyAPI = {
  getBranchReports: () => api.get('/discrepancies/branch'),
  getBranchUnreadCount: () => api.get('/discrepancies/branch/unread-count'),
  createBranchReport: (data) => api.post('/discrepancies/branch', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteBranchReport: (reportId) => api.delete(`/discrepancies/branch/${reportId}`),
  markBranchViewed: (reportId) => api.put(`/discrepancies/branch/${reportId}/mark-viewed`),
  replyToAdminResponse: (reportId, data) => api.put(`/discrepancies/branch/${reportId}/reply`, data),
  downloadBranchAttachment: (reportId) => api.get(`/discrepancies/branch/${reportId}/attachment`, {
    responseType: 'blob'
  }),
  getAdminReports: () => api.get('/discrepancies/admin'),
  getAdminUnreadCount: () => api.get('/discrepancies/admin/unread-count'),
  markAdminViewed: (reportId) => api.put(`/discrepancies/admin/${reportId}/mark-viewed`),
  deleteAdminReport: (reportId) => api.delete(`/discrepancies/admin/${reportId}`),
  downloadAdminAttachment: (reportId) => api.get(`/discrepancies/admin/${reportId}/attachment`, {
    responseType: 'blob'
  }),
  verifyReport: (reportId, data) => api.put(`/discrepancies/${reportId}/verify`, data),
};

export const alertAPI = {
  getAll: () => api.get('/alerts'),
  markAsRead: (id) => api.put(`/alerts/${id}/read`),
};

export const activityLogAPI = {
  getAll: (params) => api.get('/activity-logs', { params }),
};

export const backupAPI = {
  create: () => api.post('/backup/create'),
  getAll: () => api.get('/backup/list'),
  restore: (backupId) => api.post(`/backup/restore/${backupId}`),
};

export const policyAPI = {
  getAll: () => api.get('/policies'),
  getUnreadCount: () => api.get('/policies/unread-count'),
  markViewed: (id) => api.post(`/policies/${id}/mark-viewed`),
  update: (id, data) => api.put(`/policies/${id}`, data),
  delete: (id) => api.delete(`/policies/${id}`),
};

export const settingsAPI = {
  get: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
  getHistory: (params) => api.get('/settings/history', { params }),
  deleteHistoryEntry: (id) => api.delete(`/settings/history/${id}`),
  setupAdminMfa: () => api.post('/admin/auth/setup-mfa-authenticated'),
};

export const accountAPI = {
  getAll: (params) => api.get('/accounts', { params }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id, role, data) => api.delete(`/accounts/${id}`, { params: { role }, data }),
  deactivate: (id, role, data) => api.put(`/accounts/${id}/deactivate`, data, { params: { role } }),
};

export const ocrAPI = {
  processReceipt: (formData) => api.post('/ocr/process', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
};

export const rbacAPI = {
  getSidebarModules: () => api.get('/rbac/sidebar-modules'),
  getAccessibleBranches: () => api.get('/rbac/accessible-branches'),
  getPermissions: () => api.get('/rbac/permissions'),
};

export const queueAPI = {
  getMyActiveTicket: () => api.get('/public/queue/my-ticket'),
  getMyHistory: () => api.get('/public/queue/history'),
  checkStatus: (queueNumber) => api.get(`/public/queue/${queueNumber}`),
};

export default api;
