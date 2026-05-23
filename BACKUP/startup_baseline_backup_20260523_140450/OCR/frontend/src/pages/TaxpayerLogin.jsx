import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { taxpayerPortalAPI } from '../services/api'

function TaxpayerLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await taxpayerPortalAPI.login({ email, password })
      localStorage.setItem('taxpayerToken', response.data.access_token)
      localStorage.setItem('taxpayerUser', JSON.stringify(response.data.taxpayer))
      navigate('/rpt-payment')
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to sign in to the taxpayer portal.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="card">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Taxpayer Portal Login</h1>
          <p className="text-gray-600">
            Sign in to continue with Real Property Tax online payment and proof submission.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 font-semibold mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="Enter your registered email"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-700 font-semibold mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Enter your password"
              required
            />
          </div>

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
            {loading ? 'Signing In...' : 'Sign In to Taxpayer Portal'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-600">
          Need an account?{' '}
          <Link to="/taxpayer-signup" className="text-primary-700 font-semibold hover:underline">
            Create one here
          </Link>
        </div>
      </div>
    </div>
  )
}

export default TaxpayerLogin
