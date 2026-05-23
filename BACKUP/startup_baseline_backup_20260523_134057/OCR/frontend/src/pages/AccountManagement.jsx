import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { adminAPI, authAPI } from '../services/api'

function AccountManagement() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [windowCount, setWindowCount] = useState(3)
  const [maxWindows, setMaxWindows] = useState(5)
  const [availableWindows, setAvailableWindows] = useState([])
  const [emailAssignments, setEmailAssignments] = useState({})
  const [accounts, setAccounts] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    checkAuthAndLoad()
  }, [])

  const activeWindows = useMemo(
    () => availableWindows.slice(0, windowCount),
    [availableWindows, windowCount],
  )

  const checkAuthAndLoad = async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/login')
      return
    }

    try {
      const authResponse = await authAPI.verify(token)
      if (authResponse.data.user?.role !== 'admin') {
        navigate('/admin/queue')
        return
      }

      const response = await adminAPI.getAccountManagement(token)
      const payload = response.data
      const nextAssignments = {}

      payload.accounts.forEach((account) => {
        nextAssignments[account.window_code] = account.email
      })

      setWindowCount(payload.window_count)
      setMaxWindows(payload.max_windows)
      setAvailableWindows(payload.available_windows)
      setEmailAssignments(nextAssignments)
      setAccounts(payload.accounts)
    } catch (err) {
      console.error(err)
      localStorage.removeItem('token')
      navigate('/login')
    } finally {
      setLoading(false)
    }
  }

  const handleEmailChange = (windowCode, value) => {
    setEmailAssignments((current) => ({
      ...current,
      [windowCode]: value,
    }))
  }

  const handleSave = async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/login')
      return
    }

    setSaving(true)
    setMessage('')
    setError('')

    try {
      const assignments = activeWindows.map((windowItem) => ({
        window_code: windowItem.window_code,
        email: (emailAssignments[windowItem.window_code] || '').trim(),
      }))

      const response = await adminAPI.syncAccountManagement(token, {
        window_count: windowCount,
        assignments,
      })

      const nextAccounts = response.data.accounts || []
      const nextAssignments = { ...emailAssignments }
      nextAccounts.forEach((account) => {
        nextAssignments[account.window_code] = account.email
      })

      setAccounts(nextAccounts)
      setEmailAssignments(nextAssignments)

      if (response.data.generated_windows?.length) {
        setMessage(`Generated and emailed queue-only staff accounts for: ${response.data.generated_windows.join(', ')}.`)
      } else {
        setMessage('Service window count and branch staff accounts were updated successfully.')
      }
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.detail || 'Failed to sync queue window staff accounts.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-14 w-14 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading account management...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow p-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Account Management</h1>
              <p className="mt-2 text-gray-600">
                Keep service counters and queue-only branch staff accounts in sync. Each active window gets one generated staff account, up to {maxWindows}.
              </p>
            </div>
            <button
              onClick={() => navigate('/admin')}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Service Counters / Queue Window Staff Accounts</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-900 mb-6">
            Service counters and queue window staff accounts are the same configuration. If you set 1 service counter, the system keeps 1 queue-only branch staff account. If you set 5 service counters, the system keeps 5 queue-only branch staff accounts.
          </div>

          <div className="max-w-sm mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Number of Service Counters
            </label>
            <select
              value={windowCount}
              onChange={(e) => setWindowCount(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-4 py-3"
            >
              {Array.from({ length: maxWindows }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count} Service Window{count > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-gray-500">
              This automatically defines how many queue-only branch staff accounts the system will generate and keep active.
            </p>
          </div>

          <h3 className="text-xl font-bold text-gray-800 mb-4">Generated Queue Window Staff Accounts</h3>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-900 mb-6">
            Each active service counter automatically gets one queue-only branch staff account. Usernames are assigned by window order as Staff 1, Staff 2, Staff 3, and so on. Every account receives a temporary password, a verification email, and Microsoft Authenticator MFA setup on first login.
          </div>

          <div className="space-y-4">
            {activeWindows.map((windowItem) => (
              <div key={windowItem.window_code} className="border border-gray-200 rounded-xl p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-800">{windowItem.window_label}</h3>
                    <p className="text-sm text-gray-600 mt-1">{windowItem.description}</p>
                  </div>
                  <div className="w-full md:w-96">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Staff Email Address
                    </label>
                    <input
                      type="email"
                      value={emailAssignments[windowItem.window_code] || ''}
                      onChange={(e) => handleEmailChange(windowItem.window_code, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3"
                      placeholder="staff@example.com"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="mt-5 p-4 rounded-lg bg-red-100 border border-red-300 text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div className="mt-5 p-4 rounded-lg bg-green-100 border border-green-300 text-green-700">
              {message}
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-lg"
            >
              {saving ? 'Saving Counter and Staff Setup...' : 'Save Service Counter Setup'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Active Branch Staff Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-gray-600">No queue-only branch staff accounts have been generated yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 border-b">Window</th>
                    <th className="text-left px-4 py-3 border-b">Username</th>
                    <th className="text-left px-4 py-3 border-b">Email</th>
                    <th className="text-left px-4 py-3 border-b">Portal Access</th>
                    <th className="text-left px-4 py-3 border-b">MFA</th>
                    <th className="text-left px-4 py-3 border-b">Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-b">
                      <td className="px-4 py-3 font-semibold text-gray-800">{account.window_label}</td>
                      <td className="px-4 py-3">{account.username}</td>
                      <td className="px-4 py-3">{account.email}</td>
                      <td className="px-4 py-3">Queue Management Only</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          account.mfa_enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {account.mfa_enabled ? 'Enabled' : 'Pending Setup'}
                        </span>
                      </td>
                      <td className="px-4 py-3">{account.last_login || 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AccountManagement
