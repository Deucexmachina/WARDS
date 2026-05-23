import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { serviceAPI, queueAPI } from '../services/api'

function Queue() {
  const location = useLocation()
  const [services, setServices] = useState([])
  const [selectedService, setSelectedService] = useState(location.state?.selectedService || '')
  const [clientName, setClientName] = useState('')
  const [priorityTag, setPriorityTag] = useState('')
  const [ticket, setTicket] = useState(null)
  const [queueStatus, setQueueStatus] = useState(null)
  const [searchNumber, setSearchNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchServices()
    // Auto-refresh services every 5 seconds for real-time wait times
    const interval = setInterval(fetchServices, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (ticket) {
      const interval = setInterval(() => {
        fetchQueueStatus(ticket.queue_number)
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [ticket])

  const fetchServices = async () => {
    try {
      const response = await serviceAPI.getAll()
      setServices(response.data)
    } catch (error) {
      console.error('Error fetching services:', error)
    }
  }

  const getSelectedServiceInfo = () => {
    const service = services.find(s => s.id === parseInt(selectedService))
    return service
  }

  const handleTakeNumber = async (e) => {
    e.preventDefault()
    if (!selectedService) {
      setError('Please select a service')
      return
    }
    if (!clientName || clientName.trim() === '') {
      setError('Please enter your full name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await queueAPI.takeNumber({
        service_id: parseInt(selectedService),
        client_name: clientName.trim(),
        priority_tag: priorityTag || null
      })
      setTicket(response.data)
      setQueueStatus(null)
    } catch (error) {
      setError('Failed to get queue number. Please try again.')
      console.error('Error taking queue number:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchQueueStatus = async (queueNumber) => {
    try {
      const response = await queueAPI.getStatus(queueNumber)
      setQueueStatus(response.data)
    } catch (error) {
      console.error('Error fetching queue status:', error)
    }
  }

  const handleCheckStatus = async (e) => {
    e.preventDefault()
    if (!searchNumber) {
      setError('Please enter a queue number')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await queueAPI.getStatus(searchNumber)
      setQueueStatus(response.data)
      setTicket(null)
    } catch (error) {
      setError('Queue number not found')
      console.error('Error checking status:', error)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setTicket(null)
    setQueueStatus(null)
    setSelectedService('')
    setClientName('')
    setSearchNumber('')
    setError('')
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-gray-800 mb-6">Queue System</h1>

      {!ticket && !queueStatus ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Get Queue Number</h2>
            <form onSubmit={handleTakeNumber}>
              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">
                  Select Service Counter *
                </label>
                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  className="input-field"
                  required
                >
                  <option value="">Choose a counter...</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      Counter {service.counter} - {service.name}
                    </option>
                  ))}
                </select>
                {selectedService && getSelectedServiceInfo() && (
                  <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center text-sm text-blue-800">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-semibold">Current wait time: {getSelectedServiceInfo().estimated_time}</span>
                    </div>
                    <div className="flex items-center text-sm text-blue-700 mt-1">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      <span>{getSelectedServiceInfo().waiting_count || 0} people in line</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="input-field"
                  placeholder="Enter your full name"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">
                  Priority Tag (Optional)
                </label>
                <select
                  value={priorityTag}
                  onChange={(e) => setPriorityTag(e.target.value)}
                  className="input-field"
                >
                  <option value="">None</option>
                  <option value="PWD">PWD (Person with Disability)</option>
                  <option value="Senior">Senior Citizen</option>
                  <option value="Pregnant">Pregnant</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  Select if you qualify for priority service
                </p>
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
                {loading ? 'Processing...' : 'Get Queue Number'}
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Check Queue Status</h2>
            <form onSubmit={handleCheckStatus}>
              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">
                  Queue Number
                </label>
                <input
                  type="text"
                  value={searchNumber}
                  onChange={(e) => setSearchNumber(e.target.value)}
                  className="input-field"
                  placeholder="e.g., DOC-001"
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
                className="btn-secondary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Checking...' : 'Check Status'}
              </button>
            </form>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>Tip:</strong> Save your queue number to check your status anytime.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {ticket && (
            <div className="card bg-green-50 border-2 border-green-500 mb-6">
              <div className="text-center">
                <h2 className="text-2xl font-semibold text-green-800 mb-4">
                  Queue Number Issued
                </h2>
                <div className="bg-white rounded-lg p-6 mb-4 inline-block">
                  <p className="text-sm text-gray-600 mb-2">Your Queue Number</p>
                  <p className="text-5xl font-bold text-primary-700">{ticket.queue_number}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Service</p>
                    <p className="text-lg font-semibold text-gray-800">{ticket.service_name}</p>
                  </div>
                  <div className="bg-primary-600 text-white rounded-lg p-4">
                    <p className="text-sm mb-1">Assigned Counter</p>
                    <p className="text-2xl font-bold">Counter {services.find(s => s.id === ticket.service_id)?.counter}</p>
                  </div>
                </div>
                <div className="text-left bg-white rounded-lg p-4">
                  <p className="text-gray-700 mb-2">
                    <strong>Position in Queue:</strong> #{ticket.position}
                  </p>
                  <p className="text-gray-700 mb-2">
                    <strong>Status:</strong> <span className="text-yellow-600 font-semibold">Waiting</span>
                  </p>
                  {ticket.priority_tag && (
                    <p className="text-gray-700">
                      <strong>Priority:</strong> <span className="inline-block bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-semibold">{ticket.priority_tag}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {queueStatus && (
            <div className="card mb-6">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4">My Queue Status</h2>
              <div className="bg-gray-50 rounded-lg p-6">
                <div className="text-center mb-6">
                  <p className="text-sm text-gray-600 mb-2">Queue Number</p>
                  <p className="text-4xl font-bold text-primary-700">{queueStatus.queue_number}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded p-4">
                    <p className="text-sm text-gray-600">Service</p>
                    <p className="text-lg font-semibold">{queueStatus.service_name}</p>
                  </div>
                  <div className="bg-primary-600 text-white rounded p-4">
                    <p className="text-sm">Assigned Counter</p>
                    <p className="text-xl font-bold">Counter {services.find(s => s.name === queueStatus.service_name)?.counter || 'N/A'}</p>
                  </div>
                  <div className="bg-white rounded p-4">
                    <p className="text-sm text-gray-600">Position in Queue</p>
                    <p className="text-lg font-semibold">#{queueStatus.position}</p>
                  </div>
                  <div className="bg-white rounded p-4">
                    <p className="text-sm text-gray-600">Status</p>
                    <p className={`text-lg font-semibold ${
                      queueStatus.status === 'serving' ? 'text-green-600' :
                      queueStatus.status === 'waiting' ? 'text-yellow-600' :
                      'text-gray-600'
                    }`}>
                      {queueStatus.status.charAt(0).toUpperCase() + queueStatus.status.slice(1)}
                    </p>
                  </div>
                  <div className="bg-white rounded p-4">
                    <p className="text-sm text-gray-600">Estimated Wait</p>
                    <p className="text-lg font-semibold">{queueStatus.estimated_wait}</p>
                  </div>
                  {queueStatus.priority_tag && (
                    <div className="bg-purple-100 rounded p-4">
                      <p className="text-sm text-gray-600">Priority Tag</p>
                      <p className="text-lg font-semibold text-purple-800">{queueStatus.priority_tag}</p>
                    </div>
                  )}
                  {queueStatus.current_serving && (
                    <div className="bg-blue-100 rounded p-4">
                      <p className="text-sm text-gray-600">Currently Serving</p>
                      <p className="text-lg font-semibold text-blue-800">{queueStatus.current_serving}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="text-center">
            <button
              onClick={resetForm}
              className="btn-secondary"
            >
              Get Another Number
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Queue
