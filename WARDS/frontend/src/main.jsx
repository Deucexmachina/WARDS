import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App.jsx'
import './index.css'
import { sanitizeApiResponseData } from './utils/responseSanitizer'
import { getFriendlyErrorMessage, getModalToneForError, shouldSuppressGlobalErrorModal } from './utils/errorMessages'

const dispatchSystemErrorModal = (error) => {
  const status = error?.response?.status
  if (!status || shouldSuppressGlobalErrorModal(error)) {
    return
  }

  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: {
      tone: getModalToneForError(error),
      title: status === 429 ? 'Too Many Requests' : 'Request Failed',
      message: getFriendlyErrorMessage(error),
    },
  }))
}

axios.interceptors.response.use(
  (response) => {
    const responseType = response?.config?.responseType
    if (responseType === 'blob' || responseType === 'arraybuffer') {
      return response
    }

    response.data = sanitizeApiResponseData(response.data)
    return response
  },
  (error) => {
    dispatchSystemErrorModal(error)
    return Promise.reject(error)
  }
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
