import { useState, useEffect, useRef } from 'react'
import { queueAPI, announcementAPI } from '../services/api'

function QueueDisplay() {
  const [displayData, setDisplayData] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const previousServingRef = useRef({})

  useEffect(() => {
    fetchDisplayData()
    fetchAnnouncements()
    const displayInterval = setInterval(fetchDisplayData, 3000)
    const announcementInterval = setInterval(fetchAnnouncements, 30000)
    const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000)

    return () => {
      clearInterval(displayInterval)
      clearInterval(announcementInterval)
      clearInterval(timeInterval)
    }
  }, [])

  const playNotificationSound = () => {
    const audio = new Audio('/notification.mp3')
    audio.volume = 0.8
    audio.play().catch(err => console.log('Audio play failed:', err))
  }

  const fetchDisplayData = async () => {
    try {
      const response = await queueAPI.getDisplay()
      const newData = response.data
      
      // Check if any counter has a new serving number
      newData.forEach(counter => {
        const previousServing = previousServingRef.current[counter.counter]
        const currentServing = counter.current_serving
        
        // Play sound if serving number changed and is not null
        if (currentServing && previousServing !== currentServing) {
          playNotificationSound()
        }
        
        // Update previous serving number
        previousServingRef.current[counter.counter] = currentServing
      })
      
      setDisplayData(newData)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching display data:', error)
      setLoading(false)
    }
  }

  const fetchAnnouncements = async () => {
    try {
      const response = await announcementAPI.getAll()
      setAnnouncements(response.data)
    } catch (error) {
      console.error('Error fetching announcements:', error)
    }
  }

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    })
  }

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-700 to-primary-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-24 w-24 border-b-4 border-white"></div>
          <p className="mt-6 text-white text-3xl font-semibold">Loading Queue Display...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 to-primary-900 p-6">
      <header className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-4xl">W</span>
            </div>
            <div>
              <h1 className="text-5xl font-bold text-gray-800">WARDS Queue System</h1>
              <p className="text-2xl text-gray-600 mt-1">Please wait for your number to be called</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-primary-700">{formatTime(currentTime)}</p>
            <p className="text-xl text-gray-600 mt-1">{formatDate(currentTime)}</p>
          </div>
        </div>
      </header>

      {displayData.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-2xl p-12 text-center">
          <div className="text-8xl mb-6">📋</div>
          <h2 className="text-5xl font-bold text-gray-800 mb-4">No Active Queues</h2>
          <p className="text-3xl text-gray-600">Please take a queue number to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayData.map((counter, index) => (
            <div
              key={index}
              className="bg-white rounded-2xl shadow-2xl p-8 transform transition-all duration-300 hover:scale-105"
            >
              <div className="text-center">
                <div className="bg-primary-600 text-white rounded-xl p-4 mb-6">
                  <h3 className="text-2xl font-bold">Counter {counter.counter}</h3>
                </div>

                <div className="mb-6">
                  <p className="text-xl text-gray-600 mb-2">Service</p>
                  <p className="text-2xl font-semibold text-gray-800">{counter.service}</p>
                </div>

                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-8 mb-6 shadow-lg">
                  <p className="text-2xl text-white mb-3 font-semibold">NOW SERVING</p>
                  {counter.current_serving ? (
                    <div className="flex flex-col items-center">
                      <p className="text-7xl font-bold text-white animate-pulse">
                        {counter.current_serving}
                      </p>
                      {counter.current_serving_priority && (
                        <div className="mt-3 flex items-center space-x-2">
                          <span className="bg-white text-purple-700 px-4 py-2 rounded-full text-lg font-bold">
                            {counter.current_serving_priority === 'PWD' && '♿ PWD'}
                            {counter.current_serving_priority === 'Senior' && '👴 SENIOR'}
                            {counter.current_serving_priority === 'Pregnant' && '🤰 PREGNANT'}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-4xl text-white opacity-75">---</p>
                  )}
                </div>

                {counter.next_number && (
                  <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-6 mb-4">
                    <p className="text-lg text-yellow-800 mb-2 font-semibold">NEXT IN LINE</p>
                    <div className="flex flex-col items-center">
                      <p className="text-5xl font-bold text-yellow-700">{counter.next_number}</p>
                      {counter.next_number_priority && (
                        <div className="mt-2">
                          <span className="bg-purple-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                            {counter.next_number_priority === 'PWD' && '♿ PWD'}
                            {counter.next_number_priority === 'Senior' && '👴 SENIOR'}
                            {counter.next_number_priority === 'Pregnant' && '🤰 PREGNANT'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-center space-x-2 text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span className="text-xl font-semibold">{counter.waiting_count} waiting</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {announcements.length > 0 && (
        <div className="mt-8 bg-white rounded-2xl shadow-2xl p-6 overflow-hidden">
          <div className="flex items-center mb-3">
            <div className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold mr-4">
              ANNOUNCEMENTS
            </div>
          </div>
          <div className="announcements-ticker">
            <div className="ticker-content">
              {announcements.map((announcement, index) => (
                <span key={announcement.id} className="text-xl text-gray-800 mx-8">
                  <strong>{announcement.title}:</strong> {announcement.content}
                  {index < announcements.length - 1 && ' • '}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="mt-8 bg-white bg-opacity-20 backdrop-blur-sm rounded-2xl p-6 text-center">
        <p className="text-white text-2xl font-semibold">
          Thank you for your patience • Updates every 3 seconds
        </p>
      </footer>

      <style>{`
        .announcements-ticker {
          overflow: hidden;
          white-space: nowrap;
        }
        .ticker-content {
          display: inline-block;
          animation: ticker 30s linear infinite;
        }
        @keyframes ticker {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  )
}

export default QueueDisplay
