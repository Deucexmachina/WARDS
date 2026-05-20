import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_URL = 'http://localhost:8000/api'

function AdminDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ waiting: 0, serving: 0, completed_today: 0, no_show_today: 0 })
  const [queues, setQueues] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    checkAuth()
    fetchDashboardData()
    const interval = setInterval(fetchDashboardData, 3000)
    return () => clearInterval(interval)
  }, [])

  const checkAuth = async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/login')
      return
    }

    try {
      const response = await axios.get(`${API_URL}/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setUser(response.data.user)
    } catch (error) {
      console.error('Auth error:', error)
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      navigate('/login')
    }
  }

  const fetchDashboardData = async () => {
    const token = localStorage.getItem('token')
    if (!token) return

    try {
      const [statsRes, queuesRes] = await Promise.all([
        axios.get(`${API_URL}/admin/dashboard/stats`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_URL}/admin/queue/all`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ])
      setStats(statsRes.data)
      setQueues(queuesRes.data)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      setLoading(false)
    }
  }

  const playNotificationSound = () => {
    const audio = new Audio('/notification.mp3')
    audio.volume = 0.7
    audio.play().catch(err => console.log('Audio play failed:', err))
  }

  const handleCallNext = async (serviceId) => {
    const token = localStorage.getItem('token')
    setActionLoading(true)

    try {
      const response = await axios.post(
        `${API_URL}/admin/queue/call-next/${serviceId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )

      playNotificationSound()
      alert(response.data.message)
      fetchDashboardData()
    } catch (error) {
      alert(error.response?.data?.detail || 'Error calling next client')
    } finally {
      setActionLoading(false)
    }
  }

  const handleComplete = async (queueNumber) => {
    const token = localStorage.getItem('token')
    setActionLoading(true)

    try {
      await axios.post(
        `${API_URL}/admin/queue/complete`,
        { queue_number: queueNumber },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      alert('Client marked as completed')
      fetchDashboardData()
    } catch (error) {
      alert(error.response?.data?.detail || 'Error completing client')
    } finally {
      setActionLoading(false)
    }
  }

  const handleNoShow = async (queueNumber) => {
    if (!confirm('Mark this client as no-show?')) return

    const token = localStorage.getItem('token')
    setActionLoading(true)

    try {
      await axios.post(
        `${API_URL}/admin/queue/no-show`,
        { queue_number: queueNumber },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      alert('Client marked as no-show')
      fetchDashboardData()
    } catch (error) {
      alert(error.response?.data?.detail || 'Error marking no-show')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSkip = async (queueNumber) => {
    if (!confirm('Skip this client and move to end of queue?')) return

    const token = localStorage.getItem('token')
    setActionLoading(true)

    try {
      await axios.post(
        `${API_URL}/admin/queue/skip`,
        { queue_number: queueNumber },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      alert('Client skipped')
      fetchDashboardData()
    } catch (error) {
      alert(error.response?.data?.detail || 'Error skipping client')
    } finally {
      setActionLoading(false)
    }
  }

  const handleReset = async (serviceId, serviceName) => {
    if (!confirm(`WARNING: This will clear ALL queue entries for ${serviceName}.\n\nThis action cannot be undone. Are you sure?`)) return

    const token = localStorage.getItem('token')
    setActionLoading(true)

    try {
      await axios.post(
        `${API_URL}/admin/queue/reset/${serviceId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      alert(`Queue reset successfully for ${serviceName}`)
      fetchDashboardData()
    } catch (error) {
      alert(error.response?.data?.detail || 'Error resetting queue')
    } finally {
      setActionLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-primary-700 text-white shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                {user?.role === 'branch_staff' ? 'Queue Window Portal' : 'Admin Dashboard'}
              </h1>
              <p className="text-sm text-primary-100">
                {user?.role === 'branch_staff' ? 'Queue Management Only' : 'Queue Management System'}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="font-semibold">{user?.full_name}</p>
                <p className="text-xs text-primary-100">{user?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Waiting</p>
                <p className="text-3xl font-bold text-yellow-600">{stats.waiting}</p>
              </div>
              <div className="text-4xl">⌛</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Serving</p>
                <p className="text-3xl font-bold text-green-600">{stats.serving}</p>
              </div>
              <div className="text-4xl">👥</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Completed Today</p>
                <p className="text-3xl font-bold text-blue-600">{stats.completed_today}</p>
              </div>
              <div className="text-4xl">✅</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">No Show Today</p>
                <p className="text-3xl font-bold text-red-600">{stats.no_show_today}</p>
              </div>
              <div className="text-4xl">❌</div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {queues.map((queue) => (
            <div key={queue.service_id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">Counter {queue.counter}</h2>
                  <p className="text-gray-600">{queue.service_name}</p>
                  {user?.role === 'branch_staff' && (
                    <p className="text-xs uppercase tracking-wide text-primary-700 mt-1">Assigned Queue Window</p>
                  )}
                </div>
                <div className="flex space-x-2">
                  {user?.role !== 'branch_staff' && (
                    <button
                      onClick={() => handleReset(queue.service_id, queue.service_name)}
                      disabled={actionLoading}
                      className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Reset Queue
                    </button>
                  )}
                  <button
                    onClick={() => handleCallNext(queue.service_id)}
                    disabled={actionLoading || queue.waiting_count === 0}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Call Next
                  </button>
                </div>
              </div>

              {queue.current_serving ? (
                <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 mb-4">
                  <p className="text-sm text-green-800 font-semibold mb-2">NOW SERVING</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-green-700">{queue.current_serving.queue_number}</p>
                      <p className="text-gray-700">{queue.current_serving.client_name}</p>
                      {queue.current_serving.priority_tag && (
                        <span className="inline-block bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-semibold mt-1">
                          {queue.current_serving.priority_tag}
                        </span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleComplete(queue.current_serving.queue_number)}
                        disabled={actionLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
                      >
                        Complete
                      </button>
                      <button
                        onClick={() => handleNoShow(queue.current_serving.queue_number)}
                        disabled={actionLoading}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded disabled:opacity-50"
                      >
                        No Show
                      </button>
                      <button
                        onClick={() => handleSkip(queue.current_serving.queue_number)}
                        disabled={actionLoading}
                        className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded disabled:opacity-50"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 border-2 border-gray-300 rounded-lg p-4 mb-4 text-center">
                  <p className="text-gray-500">No one currently being served</p>
                </div>
              )}

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Waiting ({queue.waiting_count})
                </p>
                {queue.waiting.length > 0 ? (
                  <div className="space-y-2">
                    {queue.waiting.map((client, index) => (
                      <div key={client.id} className="bg-gray-50 rounded p-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span className="bg-gray-200 text-gray-700 font-bold px-3 py-1 rounded">
                            #{index + 1}
                          </span>
                          <div>
                            <p className="font-semibold">{client.queue_number}</p>
                            <p className="text-sm text-gray-600">{client.client_name}</p>
                          </div>
                          {client.priority_tag && (
                            <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-semibold">
                              {client.priority_tag}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleSkip(client.queue_number)}
                          disabled={actionLoading}
                          className="text-yellow-600 hover:text-yellow-700 text-sm disabled:opacity-50"
                        >
                          Skip
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No clients waiting</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default AdminDashboard
