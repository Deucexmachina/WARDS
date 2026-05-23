import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App.jsx'
import './index.css'
import { sanitizeApiResponseData } from './utils/responseSanitizer'

axios.interceptors.response.use(
  (response) => {
    const responseType = response?.config?.responseType
    if (responseType === 'blob' || responseType === 'arraybuffer') {
      return response
    }

    response.data = sanitizeApiResponseData(response.data)
    return response
  },
  (error) => Promise.reject(error)
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
