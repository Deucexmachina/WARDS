import axios from 'axios'

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8000`;
const API_BASE_URL = rawBaseUrl.endsWith('/api') ? rawBaseUrl : rawBaseUrl + '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const announcementAPI = {
  getAll: () => api.get('/announcements'),
  getById: (id) => api.get(`/announcements/${id}`),
  create: (data) => api.post('/announcements', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  delete: (id) => api.delete(`/announcements/${id}`),
}

export const serviceAPI = {
  getAll: () => api.get('/services'),
  getById: (id) => api.get(`/services/${id}`),
  create: (data) => api.post('/services', data),
}

export const queueAPI = {
  takeNumber: (data) => api.post('/queue/take-number', data),
  getStatus: (queueNumber) => api.get(`/queue/status/${queueNumber}`),
  getAllQueues: () => api.get('/queue/all'),
  callNext: (serviceId) => api.post(`/queue/call-next/${serviceId}`),
  complete: (serviceId) => api.post(`/queue/complete/${serviceId}`),
  reset: (serviceId) => api.post(`/queue/reset/${serviceId}`),
  getDisplay: () => api.get('/queue/display'),
}

export const taxpayerAuthAPI = {
  requestOtp: (data) => api.post('/taxpayer-auth/request-otp', data),
  register: (data) => api.post('/taxpayer-auth/register', data),
}

export const taxpayerPortalAPI = {
  login: (data) => api.post('/rpt-payments/auth/login', data),
  me: (token) => api.get('/rpt-payments/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  }),
}

export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  verifyMfa: (data) => api.post('/auth/verify-mfa', data),
  verify: (token) => api.get('/auth/verify', {
    headers: { Authorization: `Bearer ${token}` },
  }),
}

export const adminAPI = {
  getAccountManagement: (token) => api.get('/admin/account-management', {
    headers: { Authorization: `Bearer ${token}` },
  }),
  syncAccountManagement: (token, data) => api.post('/admin/account-management/sync', data, {
    headers: { Authorization: `Bearer ${token}` },
  }),
}

export const rptPaymentAPI = {
  getBranches: () => api.get('/rpt-payments/branches'),
  searchProperty: (token, data) => api.post('/rpt-payments/search', data, {
    headers: { Authorization: `Bearer ${token}` },
  }),
  createCheckout: (token, data) => api.post('/rpt-payments/checkout', data, {
    headers: { Authorization: `Bearer ${token}` },
  }),
  uploadProof: (token, transactionId, formData) => api.post(`/rpt-payments/${transactionId}/proof`, formData, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'multipart/form-data',
    },
  }),
  getMyTransactions: (token) => api.get('/rpt-payments/my-transactions', {
    headers: { Authorization: `Bearer ${token}` },
  }),
  getValidationQueue: (token, params = {}) => api.get('/rpt-payments/admin/queue', {
    headers: { Authorization: `Bearer ${token}` },
    params,
  }),
  submitDecision: (token, transactionId, data) => api.post(`/rpt-payments/admin/${transactionId}/decision`, data, {
    headers: { Authorization: `Bearer ${token}` },
  }),
  issueOfficialReceipt: (token, transactionId) => api.post(`/rpt-payments/admin/${transactionId}/issue-or`, {}, {
    headers: { Authorization: `Bearer ${token}` },
  }),
  releaseOfficialReceipt: (token, transactionId, data) => api.post(`/rpt-payments/admin/${transactionId}/release`, data, {
    headers: { Authorization: `Bearer ${token}` },
  }),
}

export default api
