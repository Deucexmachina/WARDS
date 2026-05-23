import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { authAPI } from '../services/api'

function AdminHome() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const bootstrap = async () => {
      const token = localStorage.getItem('token')
      if (!token) {
        navigate('/login')
        return
      }

      try {
        const response = await authAPI.verify(token)
        const role = response.data.user?.role
        if (role === 'branch_staff') {
          navigate('/admin/queue')
          return
        }
      } catch (error) {
        console.error(error)
        localStorage.removeItem('token')
        navigate('/login')
        return
      } finally {
        setLoading(false)
      }
    }

    bootstrap()
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-14 w-14 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading admin modules...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white p-10 rounded-xl shadow-lg w-full max-w-5xl">
        <h1 className="text-3xl font-bold text-center mb-2">
          Admin Modules
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Manage queues, service windows, RPT online payments, receipts, and logs
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
          <button
            onClick={() => navigate('/admin/queue')}
            className="bg-blue-600 hover:bg-blue-700 text-white p-6 rounded-lg text-lg font-semibold transition"
          >
            Queue Management
          </button>

          <button
            onClick={() => navigate('/admin/accounts')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white p-6 rounded-lg text-lg font-semibold transition"
          >
            Account Management
          </button>

          <button
            onClick={() => navigate('/admin/receipts')}
            className="bg-green-600 hover:bg-green-700 text-white p-6 rounded-lg text-lg font-semibold transition"
          >
            Receipt Records
          </button>

          <button
            onClick={() => navigate('/admin/rpt-payments')}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 p-6 rounded-lg text-lg font-semibold transition"
          >
            RPT Payments
          </button>

          <button
            onClick={() => navigate('/admin/audit')}
            className="bg-purple-600 hover:bg-purple-700 text-white p-6 rounded-lg text-lg font-semibold transition"
          >
            Audit & Logs
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminHome
