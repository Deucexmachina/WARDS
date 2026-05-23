import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { serviceAPI } from '../services/api'

function Services() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchServices()
    // Auto-refresh every 5 seconds for real-time wait times
    const interval = setInterval(fetchServices, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchServices = async () => {
    try {
      const response = await serviceAPI.getAll()
      setServices(response.data)
    } catch (error) {
      console.error('Error fetching services:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">Service Counters</h1>
        <p className="text-lg text-gray-600">
          Select the counter for your service and get your queue number.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">Loading services...</p>
        </div>
      ) : services.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {services.map((service) => (
            <div key={service.id} className="card hover:shadow-lg transition-shadow border-l-4 border-primary-500">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="bg-primary-600 text-white px-4 py-2 rounded-lg">
                    <span className="text-lg font-bold">Counter {service.counter}</span>
                  </div>
                  <div className="text-4xl">
                    {service.counter === 1 ? '🏠' : service.counter === 2 ? '💼' : '📋'}
                  </div>
                </div>
                <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                  {service.name}
                </h3>
                <p className="text-gray-600 mb-3">{service.description}</p>
                <div className="space-y-2 mb-4">
                  <div className="flex items-center text-sm text-gray-500">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold">Wait time: {service.estimated_time}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span>{service.waiting_count || 0} people waiting</span>
                  </div>
                </div>
              </div>
              <div className="border-t pt-4">
                <Link
                  to="/queue"
                  state={{ selectedService: service.id }}
                  className="block w-full text-center bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  Get Queue Number for Counter {service.counter}
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-gray-600 text-lg">No services available at this time.</p>
        </div>
      )}

      <div className="mt-12 card bg-blue-50">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">Counter Assignment</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg text-center">
            <div className="text-3xl mb-2">🏠</div>
            <div className="font-bold text-primary-700">Counter 1</div>
            <div className="text-sm text-gray-600">Real Property Tax</div>
          </div>
          <div className="bg-white p-4 rounded-lg text-center">
            <div className="text-3xl mb-2">💼</div>
            <div className="font-bold text-primary-700">Counter 2</div>
            <div className="text-sm text-gray-600">Business Tax</div>
          </div>
          <div className="bg-white p-4 rounded-lg text-center">
            <div className="text-3xl mb-2">📋</div>
            <div className="font-bold text-primary-700">Counter 3</div>
            <div className="text-sm text-gray-600">Miscellaneous Tax</div>
          </div>
        </div>
        <div className="text-center text-gray-700">
          <p className="font-semibold mb-2">How It Works:</p>
          <p className="text-sm">Select your service counter → Get queue number → Wait for your turn → Proceed to assigned counter</p>
        </div>
      </div>
    </div>
  )
}

export default Services
