import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { announcementAPI } from '../services/api'

function Home() {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnnouncements()
  }, [])

  const fetchAnnouncements = async () => {
    try {
      const response = await announcementAPI.getAll()
      setAnnouncements(response.data)
    } catch (error) {
      console.error('Error fetching announcements:', error)
    } finally {
      setLoading(false)
    }
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 border-red-500 text-red-800'
      case 'normal':
        return 'bg-blue-100 border-blue-500 text-blue-800'
      default:
        return 'bg-gray-100 border-gray-500 text-gray-800'
    }
  }

  return (
    <div>
      <section className="bg-gradient-to-r from-primary-600 to-primary-800 text-white rounded-lg shadow-lg p-8 mb-8">
        <h1 className="text-4xl font-bold mb-4">Welcome to City Treasurer's Office - Galas Branch</h1>
        <p className="text-xl mb-6">
          Blablabla
        </p>
        <p className="text-lg mb-6">
          Blablabla
        </p>
        <div className="flex flex-wrap gap-4">
          <Link to="/queue" className="bg-white text-primary-700 font-semibold py-3 px-6 rounded-lg hover:bg-gray-100 transition-colors">
            Get Queue Number
          </Link>
          <Link to="/rpt-payment" className="bg-amber-400 text-slate-900 font-semibold py-3 px-6 rounded-lg hover:bg-amber-300 transition-colors">
            Pay RPT Online
          </Link>
          <Link to="/services" className="bg-primary-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-primary-400 transition-colors">
            View Services
          </Link>
          <Link to="/display" className="bg-green-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-green-400 transition-colors">
            📺 Queue Display
          </Link>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Announcements</h2>
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Loading announcements...</p>
          </div>
        ) : announcements.length > 0 ? (
          <div className="space-y-4">
            {announcements.map((announcement) => (
              <div
                key={announcement.id}
                className={`border-l-4 p-6 rounded-lg shadow-md ${getPriorityColor(announcement.priority)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2">{announcement.title}</h3>
                    <p className="text-gray-700 mb-2">{announcement.content}</p>
                    <p className="text-sm text-gray-600">
                      Posted: {new Date(announcement.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {announcement.priority === 'high' && (
                    <span className="ml-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                      IMPORTANT
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card text-center py-8">
            <p className="text-gray-600">No announcements at this time.</p>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <div className="text-primary-600 text-4xl mb-4">📋</div>
          <h3 className="text-xl font-semibold mb-2">Easy Registration</h3>
          <p className="text-gray-600">
            Select your service and get a queue number instantly
          </p>
        </div>
        <div className="card text-center">
          <div className="text-primary-600 text-4xl mb-4">⏱️</div>
          <h3 className="text-xl font-semibold mb-2">Real-time Tracking</h3>
          <p className="text-gray-600">
            Monitor your queue position and estimated wait time
          </p>
        </div>
        <div className="card text-center">
          <div className="text-primary-600 text-4xl mb-4">✅</div>
          <h3 className="text-xl font-semibold mb-2">Efficient Service</h3>
          <p className="text-gray-600">
            Organized queue system for faster service delivery
          </p>
        </div>
      </section>
    </div>
  )
}

export default Home
