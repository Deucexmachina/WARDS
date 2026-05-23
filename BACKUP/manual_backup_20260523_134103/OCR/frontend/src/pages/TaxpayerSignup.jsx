import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { taxpayerAuthAPI, taxpayerPortalAPI } from '../services/api'

function TaxpayerSignup() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleRequestOtp = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const response = await taxpayerAuthAPI.requestOtp({ email })
      setOtpRequested(true)
      setMessage(response.data.message || 'OTP sent to your email.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to send OTP.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const response = await taxpayerAuthAPI.register({
        full_name: fullName,
        email,
        password,
        otp_code: otpCode,
      })
      const loginResponse = await taxpayerPortalAPI.login({ email, password })
      localStorage.setItem('taxpayerToken', loginResponse.data.access_token)
      localStorage.setItem('taxpayerUser', JSON.stringify(loginResponse.data.taxpayer))
      setMessage(response.data.message || 'Taxpayer account created successfully.')
      setOtpCode('')
      setOtpRequested(false)
      setFullName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      navigate('/rpt-payment')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create taxpayer account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="card">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Taxpayer Sign Up</h1>
          <p className="text-gray-600">
            QuickEmailVerification checks the email first, then Brevo sends your OTP.
          </p>
        </div>

        <form onSubmit={otpRequested ? handleRegister : handleRequestOtp}>
          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-field"
              placeholder="Enter your full name"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="Enter your email"
              required
              disabled={otpRequested}
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Create a password"
              minLength={8}
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-field"
              placeholder="Confirm your password"
              minLength={8}
              required
            />
          </div>

          {otpRequested && (
            <div className="mb-6">
              <label className="block text-gray-700 font-semibold mb-2">
                OTP Code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input-field"
                placeholder="Enter the 6-digit OTP"
                required
              />
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? 'Please wait...'
              : otpRequested
                ? 'Create Taxpayer Account'
                : 'Verify Email and Send OTP'}
          </button>
        </form>

        {otpRequested && (
          <button
            type="button"
            onClick={() => {
              setOtpRequested(false)
              setOtpCode('')
              setMessage('')
              setError('')
            }}
            className="mt-3 w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Change Email
          </button>
        )}

        <div className="mt-6 text-sm text-gray-600 text-center">
          <div className="mb-2">
            <Link to="/taxpayer-login" className="text-primary-700 font-semibold hover:underline">
              Already registered? Sign in to taxpayer portal
            </Link>
          </div>
          <Link to="/login" className="text-primary-700 font-semibold hover:underline">
            Admin login
          </Link>
        </div>
      </div>
    </div>
  )
}

export default TaxpayerSignup
