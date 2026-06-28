import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App.jsx'
import './index.css'
import { stripPlaceholderSuffixInResponse } from './utils/responseSanitizer'

axios.interceptors.response.use(
  (response) => {
    const responseType = response?.config?.responseType
    if (responseType === 'blob' || responseType === 'arraybuffer') {
      return response
    }
    response.data = stripPlaceholderSuffixInResponse(response.data)
    return response
  },
  (error) => Promise.reject(error)
)

console.log('[WARDS] deploy v2024.06.24')
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />,
)
