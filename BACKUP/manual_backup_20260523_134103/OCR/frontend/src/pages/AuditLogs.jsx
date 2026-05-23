import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function AuditLogs() {
  const navigate = useNavigate()

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('user') || 'null')
    if (storedUser?.role === 'branch_staff') {
      navigate('/admin/queue')
    }
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-xl shadow p-10 max-w-2xl w-full text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">Audit & Logs</h1>
        <p className="text-gray-600">
          This module remains admin-only. The branch staff portal does not expose this area.
        </p>
      </div>
    </div>
  )
}

export default AuditLogs
