import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { authAPI } from '../services/api'

const PENDING_MFA_STORAGE_KEY = 'pendingMfaLogin'

function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false)
  const [mfaSecret, setMfaSecret] = useState('')
  const [otpauthUri, setOtpauthUri] = useState('')
  const [pendingUser, setPendingUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const savedMfaState = sessionStorage.getItem(PENDING_MFA_STORAGE_KEY)
    if (!savedMfaState) {
      return
    }

    try {
      const parsedState = JSON.parse(savedMfaState)
      if (!parsedState?.challengeToken) {
        sessionStorage.removeItem(PENDING_MFA_STORAGE_KEY)
        return
      }

      setChallengeToken(parsedState.challengeToken)
      setMfaSetupRequired(Boolean(parsedState.mfaSetupRequired))
      setMfaSecret(parsedState.mfaSecret || '')
      setOtpauthUri(parsedState.otpauthUri || '')
      setPendingUser(parsedState.pendingUser || null)
    } catch (err) {
      sessionStorage.removeItem(PENDING_MFA_STORAGE_KEY)
    }
  }, [])

  const persistPendingMfaState = ({
    challengeToken: nextChallengeToken,
    mfaSetupRequired: nextMfaSetupRequired,
    mfaSecret: nextMfaSecret,
    otpauthUri: nextOtpauthUri,
    pendingUser: nextPendingUser,
  }) => {
    sessionStorage.setItem(PENDING_MFA_STORAGE_KEY, JSON.stringify({
      challengeToken: nextChallengeToken,
      mfaSetupRequired: Boolean(nextMfaSetupRequired),
      mfaSecret: nextMfaSecret || '',
      otpauthUri: nextOtpauthUri || '',
      pendingUser: nextPendingUser || null,
    }))
  }

  const clearPendingMfaState = () => {
    sessionStorage.removeItem(PENDING_MFA_STORAGE_KEY)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await authAPI.login({
        username: username,
        password: password
      })

      if (response.data.mfa_required) {
        setChallengeToken(response.data.challenge_token)
        setMfaSetupRequired(response.data.mfa_setup_required)
        setMfaSecret(response.data.mfa_secret || '')
        setOtpauthUri(response.data.otpauth_uri || '')
        setPendingUser(response.data.user)
        persistPendingMfaState({
          challengeToken: response.data.challenge_token,
          mfaSetupRequired: response.data.mfa_setup_required,
          mfaSecret: response.data.mfa_secret,
          otpauthUri: response.data.otpauth_uri,
          pendingUser: response.data.user,
        })
        return
      }

      clearPendingMfaState()
      localStorage.setItem('token', response.data.access_token)
      localStorage.setItem('user', JSON.stringify(response.data.user))
      navigate(response.data.user?.role === 'branch_staff' ? '/admin/queue' : '/admin')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyMfa = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await authAPI.verifyMfa({
        challenge_token: challengeToken,
        otp_code: otpCode,
      })

      clearPendingMfaState()
      localStorage.setItem('token', response.data.access_token)
      localStorage.setItem('user', JSON.stringify(response.data.user))
      navigate('/admin/queue')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid OTP code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const resetLoginFlow = () => {
    clearPendingMfaState()
    setOtpCode('')
    setChallengeToken('')
    setMfaSetupRequired(false)
    setMfaSecret('')
    setOtpauthUri('')
    setPendingUser(null)
    setError('')
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            {challengeToken ? 'Microsoft Authenticator Verification' : 'Staff Login'}
          </h1>
          <p className="text-gray-600">
            {challengeToken
              ? 'Enter the 6-digit OTP from Microsoft Authenticator to continue.'
              : 'Access the administrative dashboard or your queue window portal.'}
          </p>
        </div>

        <form onSubmit={challengeToken ? handleVerifyMfa : handleSubmit}>
          {!challengeToken ? (
            <>
              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">
                  Email or Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="Enter your email or username"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-gray-700 font-semibold mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="Enter your password"
                  required
                />
              </div>
            </>
          ) : (
            <>
              {mfaSetupRequired && (
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                  <p className="font-semibold mb-2">First-time setup for {pendingUser?.window_label || pendingUser?.full_name}</p>
                  <p className="mb-2">
                    Add this account to Microsoft Authenticator using the manual key below, then enter the current 6-digit OTP.
                  </p>
                  <p className="font-mono break-all bg-white border border-blue-200 rounded px-3 py-2 mb-2">
                    {mfaSecret}
                  </p>
                  {otpauthUri && (
                    <a
                      href={otpauthUri}
                      className="text-primary-700 font-semibold break-all hover:underline"
                    >
                      Open authenticator setup link
                    </a>
                  )}
                </div>
              )}

              <div className="mb-6">
                <label className="block text-gray-700 font-semibold mb-2">
                  OTP Code
                </label>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input-field"
                  placeholder="Enter 6-digit code"
                  required
                />
              </div>
            </>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait...' : challengeToken ? 'Verify OTP' : 'Sign In'}
          </button>
        </form>

        {challengeToken && (
          <button
            type="button"
            onClick={resetLoginFlow}
            className="mt-4 w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Back to Username and Password
          </button>
        )}

        {!challengeToken && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-gray-700 mb-2">
              <strong>Default Admin Credentials:</strong>
            </p>
            <p className="text-sm text-gray-600">Username: <code className="bg-gray-200 px-2 py-1 rounded">admin</code></p>
            <p className="text-sm text-gray-600">Password: <code className="bg-gray-200 px-2 py-1 rounded">admin123</code></p>
          </div>
        )}
      </div>

      {!challengeToken && (
      <div className="mt-6 card bg-green-50">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Admin Dashboard Features</h2>
        <ul className="space-y-2 text-gray-700">
          <li className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Call Next Client
          </li>
          <li className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Complete Service
          </li>
          <li className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Mark No Show
          </li>
          <li className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Skip Client
          </li>
          <li className="flex items-start">
            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Real-time Queue Monitoring
          </li>
        </ul>
      </div>
      )}

      {!challengeToken && (
      <div className="mt-6 text-center">
        <Link
          to="/taxpayer-signup"
          className="text-primary-700 font-semibold hover:underline"
        >
          Taxpayer? Create an account with email OTP verification
        </Link>
      </div>
      )}
    </div>
  )
}

export default Login
