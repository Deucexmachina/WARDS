import axios from 'axios';
import { stripPlaceholderSuffixInResponse } from '../utils/responseSanitizer';
import { getFriendlyErrorMessage, getModalToneForError, shouldSuppressGlobalErrorModal } from '../utils/errorMessages';

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
export const API_BASE_URL = rawBaseUrl.endsWith('/api') ? rawBaseUrl : rawBaseUrl + '/api';
export const API_HOST = API_BASE_URL.replace(/\/api$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const isBranchApiRequest = (url = '') => (
  url.includes('/branch/auth')
  || url.includes('/branch/')
  || url.includes('/discrepancies/branch')
);

const isAdminApiRequest = (url = '') => (
  url.includes('/admin/auth')
  || url.includes('/admin/')
  || url.includes('/tax-assessment/admin/')
  || url.includes('/branches')
  || url.includes('/reports')
  || url.includes('/dashboard')
  || url.includes('/security')
  || url.includes('/announcements')
  || url.includes('/memos')
  || url.includes('/activity-logs')
  || url.includes('/backup')
  || url.includes('/policies')
  || url.includes('/settings')
  || url.includes('/rbac')
  || url.includes('/discrepancies/admin')
  || /\/discrepancies\/\d+\/verify(?:\?|$)/.test(url)
);

const isBranchPortalContext = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const pathname = window.location?.pathname || '';
  return pathname.startsWith('/branch-dashboard/') || pathname.startsWith('/live-monitor/');
};

api.interceptors.request.use((config) => {
  if (config.headers?.Authorization) {
    return config;
  }

  // Determine which token to use based on the route
  let token = null;
  const url = config.url || '';
  
  if (url.includes('/public-content')) {
    token = isBranchPortalContext()
      ? (localStorage.getItem('branchToken') || localStorage.getItem('adminToken'))
      : (localStorage.getItem('adminToken') || localStorage.getItem('branchToken'));
  } else if (url.includes('/alerts')) {
    token = isBranchPortalContext()
      ? (localStorage.getItem('branchToken') || localStorage.getItem('adminToken'))
      : (localStorage.getItem('adminToken') || localStorage.getItem('branchToken'));
  } else if (url.includes('/accounts')) {
    token = isBranchPortalContext()
      ? (localStorage.getItem('branchToken') || localStorage.getItem('adminToken'))
      : (localStorage.getItem('adminToken') || localStorage.getItem('branchToken'));
  } else if (url.includes('/activity-logs')) {
    token = isBranchPortalContext()
      ? (localStorage.getItem('branchToken') || localStorage.getItem('adminToken'))
      : (localStorage.getItem('adminToken') || localStorage.getItem('branchToken'));
  } else if (isBranchApiRequest(url)) {
    token = localStorage.getItem('branchToken');
  } else if (isAdminApiRequest(url)) {
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

    response.data = stripPlaceholderSuffixInResponse(response.data);
    return response;
  },
  (error) => {
    const url = error?.config?.url || '';
    const status = error?.response?.status;
    const responseDetail = error?.response?.data?.detail;
    const isConfirmationResponse = status === 409 && responseDetail?.requires_confirmation;
    if (status && !isConfirmationResponse && !error?.config?.suppressGlobalErrorModal && !shouldSuppressGlobalErrorModal(error)) {
      window.dispatchEvent(new CustomEvent('wards:system-message', {
        detail: {
          tone: getModalToneForError(error),
          title: status === 429 ? 'Too Many Requests' : 'Request Failed',
          message: getFriendlyErrorMessage(error),
        },
      }));
    }

    const hasAdminToken = Boolean(localStorage.getItem('adminToken'));
    const isAdminRequest =
      isAdminApiRequest(url) ||
      url.includes('/alerts') ||
      url.includes('/public-content') ||
      url.includes('/accounts');

    // Check if this is a password confirmation error (incorrect password, not session expiration)
    const errorDetail = typeof responseDetail === 'string' ? responseDetail : (responseDetail?.message || '');
    const requestPayload = error?.config?.data;
    const isProtectedPasswordRequest = typeof requestPayload === 'string' && requestPayload.toLowerCase().includes('current_admin_password');
    const isPasswordConfirmationError = 
      errorDetail.toLowerCase().includes('incorrect') && 
      (errorDetail.toLowerCase().includes('password') || errorDetail.toLowerCase().includes('super admin') || errorDetail.toLowerCase().includes('main admin') || errorDetail.toLowerCase().includes('branch admin'));

    const isSessionExpirationError = status === 401 && (
      !errorDetail ||
      errorDetail.toLowerCase().includes('credentials') ||
      errorDetail.toLowerCase().includes('session') ||
      errorDetail.toLowerCase().includes('expired') ||
      errorDetail.toLowerCase().includes('logged out') ||
      errorDetail.toLowerCase().includes('token') ||
      errorDetail.toLowerCase().includes('unauthorized')
    );

    const isBranchPortalRequest = isBranchPortalContext() || url.startsWith('/branch/');
    const isSuperadminAccessRequest = /\/branches\/\d+\/superadmin-access/.test(url);

    if (hasAdminToken && isAdminRequest && isSessionExpirationError && !isBranchPortalRequest && !isSuperadminAccessRequest) {
      // Don't redirect if it's a password confirmation error - let the component handle it
      if (isPasswordConfirmationError || (url.includes('/accounts') && isProtectedPasswordRequest)) {
        return Promise.reject(error);
      }
      
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('adminAuthenticatedAt');
      localStorage.removeItem('securityAuthenticated');
      localStorage.removeItem('securityAuthenticatedAt');
      localStorage.removeItem('settingsAuthenticated');
      localStorage.removeItem('settingsAuthenticatedAt');
      sessionStorage.removeItem('securityAuthenticated');
      sessionStorage.removeItem('securityAuthenticatedAt');
      sessionStorage.removeItem('settingsAuthenticated');
      sessionStorage.removeItem('settingsAuthenticatedAt');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  }
);

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
  changePassword: (data) => api.put('/auth/unified/user/password', data),
  submitIdentifier: (formData) => api.post('/tax-assessment/user/account/submissions', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getAssessments: (params) => api.get('/tax-assessment/user/account/assessments', { params }),
  downloadSubmissionFile: (submissionId) => api.get(`/tax-assessment/submissions/${submissionId}/file`, {
    responseType: 'blob'
  }),
};

export const unifiedAuthAPI = {
  login: (credentials) => api.post('/auth/unified/login', credentials),
  logout: () => api.post('/auth/unified/logout'),
  getCurrentUser: () => api.get('/auth/unified/me'),
  setupMfa: (data) => api.post('/auth/unified/setup-mfa', data),
  verifyMfaSetup: (data) => api.post('/auth/unified/verify-mfa-setup', data),
  sendMfaRecoveryOtp: (data) => api.post('/auth/unified/mfa-recovery/send-otp', data),
  verifyMfaRecoveryOtp: (data) => api.post('/auth/unified/mfa-recovery/verify-otp', data),
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
  getUnreadCount: () => api.get('/tax-assessment/admin/assessments/unread-count'),
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
  uploadForOCR: (formData, params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null)
    ).toString();
    const url = query ? `/receipts/records/ocr-upload?${query}` : '/receipts/records/ocr-upload';
    return api.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  createMobileUploadSession: (data) => api.post('/receipts/records/mobile-upload-sessions', data),
  getMobileUploadSession: (token) => api.get(`/receipts/records/mobile-upload-sessions/${token}`),
  getMobileUploadPublicSession: (token) => api.get(`/receipts/records/mobile-upload-sessions/${token}/public`),
    uploadMobileReceipt: (token, formData) => api.post(`/receipts/records/mobile-upload-sessions/${token}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
    saveMobileReceipt: (token, data) => api.post(`/receipts/records/mobile-upload-sessions/${token}/save`, data),
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
  getHistory: (params) => api.get('/reports/history', { params }),
  recover: (historyId) => api.post(`/reports/history/${historyId}/recover`),
  deleteHistory: (historyId) => api.delete(`/reports/history/${historyId}`),
};

export const branchReportAPI = {
  generate: (params) => api.post('/branch/reports/generate', params),
  getAll: (params) => api.get('/branch/reports', { params }),
  getDetails: (reportId) => api.get(`/branch/reports/${reportId}`),
  delete: (reportId) => api.delete(`/branch/reports/${reportId}`),
  getAutomation: () => api.get('/branch/reports/automation'),
  updateAutomation: (data) => api.put('/branch/reports/automation', data),
  getHistory: (params) => api.get('/branch/reports/history', { params }),
  export: (reportId, format) => api.get(`/branch/reports/${reportId}/export/${format}`, { responseType: 'blob' }),
};

export const windowStaffAccountAPI = {
  getProfile: () => api.get('/branch/account/profile'),
  updateProfile: (data) => api.put('/branch/account/profile', data),
  changePassword: (data) => api.put('/auth/unified/branch/staff/password', data),
  resetMfa: (data) => api.post('/auth/unified/branch/staff/reset-mfa', data),
  verifyMfa: (data) => api.post('/auth/unified/branch/staff/verify-mfa', data),
};

export const branchSettingsAPI = {
  getAccess: () => api.get('/branch/settings/access'),
  getAppointmentSettings: () => api.get('/branch/settings/appointments'),
  getSystemSettings: () => api.get('/branch/settings/system'),
  saveSystemSettings: (data) => api.put('/branch/settings/system', data),
  getAppointmentHistory: (params) => api.get('/branch/settings/appointments/history', { params }),
  deleteAppointmentHistoryEntry: (id) => api.delete(`/branch/settings/appointments/history/${id}`),
  saveAppointmentSettings: (data) => api.put('/branch/settings/appointments', data),
  publishAppointmentSettings: (data) => api.post('/branch/settings/appointments/publish', data),
  setupBranchMfa: () => api.post('/branch/auth/setup-mfa-authenticated'),
  listBranchStaff: () => api.get('/branch/auth/admin/staff'),
  resetStaffMfa: (data) => api.post('/branch/auth/admin/reset-staff-mfa', data),
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
    getBranchReportDate: () => api.get('/discrepancies/branch/report-date'),
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
  getAll: (params) => api.get('/alerts', { params }),
  getUnreadCount: () => api.get('/alerts/unread-count'),
  markAsRead: (id) => api.put(`/alerts/${id}/read`),
  markAllAsRead: () => api.put('/alerts/read-all'),
};

export const activityLogAPI = {
  getUnreadCount: (params) => api.get('/activity-logs/unread-count', { params }),
  getAll: (params) => api.get('/activity-logs', { params }),
};

const buildPortalAuthHeaders = (portal = 'admin') => {
  const token = portal === 'branch'
    ? localStorage.getItem('branchToken')
    : localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const publicContentAPI = {
  getPublicTaxpayerGuide: () => api.get('/public-content/public/taxpayer-guide'),
  getPublicContact: () => api.get('/public-content/public/contact'),
  getPublicAboutUs: () => api.get('/public-content/public/about-us'),
  getPublicFaqs: () => api.get('/public-content/public/faqs'),
  getTaxpayerGuideEditor: (portal = 'admin') => api.get('/public-content/taxpayer-guide', { headers: buildPortalAuthHeaders(portal) }),
  saveTaxpayerGuideDraft: (content, portal = 'admin') => api.put('/public-content/taxpayer-guide/draft', { content }, { headers: buildPortalAuthHeaders(portal) }),
  publishTaxpayerGuide: (content, portal = 'admin') => api.post('/public-content/taxpayer-guide/publish', { content }, { headers: buildPortalAuthHeaders(portal) }),
  getContactEditor: (portal = 'admin') => api.get('/public-content/contact', { headers: buildPortalAuthHeaders(portal) }),
  saveContactDraft: (content, portal = 'admin') => api.put('/public-content/contact/draft', { content }, { headers: buildPortalAuthHeaders(portal) }),
  publishContact: (content, portal = 'admin') => api.post('/public-content/contact/publish', { content }, { headers: buildPortalAuthHeaders(portal) }),
  getAboutUsEditor: (portal = 'admin') => api.get('/public-content/about-us', { headers: buildPortalAuthHeaders(portal) }),
  saveAboutUsDraft: (content, portal = 'admin') => api.put('/public-content/about-us/draft', { content }, { headers: buildPortalAuthHeaders(portal) }),
  publishAboutUs: (content, portal = 'admin') => api.post('/public-content/about-us/publish', { content }, { headers: buildPortalAuthHeaders(portal) }),
  getFaqsEditor: (portal = 'admin') => api.get('/public-content/faqs', { headers: buildPortalAuthHeaders(portal) }),
  saveFaqsDraft: (content, portal = 'admin') => api.put('/public-content/faqs/draft', { content }, { headers: buildPortalAuthHeaders(portal) }),
  publishFaqs: (content, portal = 'admin') => api.post('/public-content/faqs/publish', { content }, { headers: buildPortalAuthHeaders(portal) }),
  getPublicHome: () => api.get('/public-content/public/home'),
  getHomeEditor: (portal = 'admin') => api.get('/public-content/home', { headers: buildPortalAuthHeaders(portal) }),
  saveHomeDraft: (content, portal = 'admin') => api.put('/public-content/home/draft', { content }, { headers: buildPortalAuthHeaders(portal) }),
  publishHome: (content, portal = 'admin') => api.post('/public-content/home/publish', { content }, { headers: buildPortalAuthHeaders(portal) }),
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
  getAccess: () => api.get('/settings/access'),
  update: (data) => api.put('/settings', data),
  getHistory: (params) => api.get('/settings/history', { params }),
  deleteHistoryEntry: (id) => api.delete(`/settings/history/${id}`),
  setupAdminMfa: () => api.post('/auth/unified/setup-mfa-authenticated'),
};

export const accountAPI = {
  getAll: (params) => api.get('/accounts', { params }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id, role, data, config = {}) => api.delete(`/accounts/${id}`, { params: { role }, data: data, ...config }),
  deactivate: (id, role, data, config = {}) => api.put(`/accounts/${id}/deactivate`, data, { params: { role }, ...config }),
  activate: (id, role, data, config = {}) => api.put(`/accounts/${id}/activate`, data, { params: { role }, ...config }),
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
