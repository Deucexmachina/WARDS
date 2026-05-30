import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import { announceQueue, recallQueue } from '../../utils/queueAnnouncement';

const queueWindowLabels = {
  RPT: 'RPT',
  BUSINESS: 'BT',
  MISC: 'MISC',
  QW4: 'Queue Window 4',
  QW5: 'Queue Window 5',
};

const getWindowLabel = (windowKey, windowData) => (
  windowData?.window_label || queueWindowLabels[windowKey] || windowKey
);

const LiveQueueMonitor = () => {
  const { branchSlug } = useParams();
  const [queueData, setQueueData] = useState({
    serving: [],
    waiting: [],
    completed: [],
    skipped: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isAnnouncementPlaying, setIsAnnouncementPlaying] = useState(false);
  const previousServingQueuesRef = useRef([]);
  const lastAnnouncedQueueRef = useRef(null);
  const lastProcessedTriggerRef = useRef(null);

  const fetchQueueData = async () => {
    try {
      const response = await api.get('/branch/queue/live-monitor');
      const responseData = response.data;
      
      // Keep the original window structure for column-based layout
      const transformedData = {
        windows: responseData.windows || {},
        branchInfo: responseData.branch,
        // Keep flat arrays for backward compatibility with existing UI elements
        serving: [],
        waiting: [],
        completed: [],
        skipped: [],
      };
      
      // Process windows data for flat arrays (backward compatibility)
      if (responseData.windows) {
        Object.values(responseData.windows).forEach(windowData => {
          if (windowData.serving) transformedData.serving.push(...windowData.serving);
          if (windowData.waiting) transformedData.waiting.push(...windowData.waiting);
          if (windowData.completed) transformedData.completed.push(...windowData.completed);
          if (windowData.skipped) transformedData.skipped.push(...windowData.skipped);
        });
      }
      
      setQueueData(transformedData);
      setLastUpdate(new Date());
      setError('');
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load queue data.');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-detect newly called/serving queues and play announcements
  useEffect(() => {
    if (loading || isAnnouncementPlaying) return;

    const currentServingQueues = queueData.serving || [];
    const previousServingQueues = previousServingQueuesRef.current || [];

    // Find newly added serving queue
    const newServingQueue = currentServingQueues.find(queue => {
      return !previousServingQueues.some(prev => prev.queue_number === queue.queue_number);
    });

    if (newServingQueue && newServingQueue.queue_number) {
      // Check if we already announced this queue
      if (lastAnnouncedQueueRef.current !== newServingQueue.queue_number) {
        console.log('🔊 Auto-detected new serving queue:', newServingQueue.queue_number);
        setIsAnnouncementPlaying(true);
        lastAnnouncedQueueRef.current = newServingQueue.queue_number;

        announceQueue(newServingQueue.queue_number, newServingQueue.assigned_window_number || newServingQueue.service_window || 'MISC')
          .then(() => {
            console.log('✅ Auto-announcement completed');
          })
          .catch(err => {
            console.error('❌ Auto-announcement failed:', err);
          })
          .finally(() => {
            setIsAnnouncementPlaying(false);
          });
      }
    }

    // Update previous serving queues
    previousServingQueuesRef.current = currentServingQueues;
  }, [queueData.serving, loading, isAnnouncementPlaying]);

  // Listen for recall triggers from Staff Window via localStorage
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'queue_announcement_trigger' && event.newValue) {
        try {
          const trigger = JSON.parse(event.newValue);
          processAnnouncementTrigger(trigger);
        } catch (err) {
          console.error('Failed to parse announcement trigger:', err);
        }
      }
    };

    // Polling fallback for same-tab triggers (storage event doesn't fire in same tab)
    const pollTrigger = () => {
      try {
        const triggerData = localStorage.getItem('queue_announcement_trigger');
        if (triggerData) {
          const trigger = JSON.parse(triggerData);
          processAnnouncementTrigger(trigger);
        }
      } catch (err) {
        // Ignore parsing errors
      }
    };

    const processAnnouncementTrigger = (trigger) => {
      if (!trigger || !trigger.queue_number || !trigger.timestamp) return;

      // Prevent duplicate processing of same trigger
      if (lastProcessedTriggerRef.current === trigger.timestamp) {
        return;
      }

      // Ignore old triggers (older than 10 seconds)
      const age = Date.now() - trigger.timestamp;
      if (age > 10000) {
        console.log('⏰ Ignoring old trigger:', age, 'ms old');
        return;
      }

      if (isAnnouncementPlaying) {
        console.log('⚠️ Announcement already playing, skipping trigger');
        return;
      }

      console.log('📢 Processing announcement trigger:', trigger);
      lastProcessedTriggerRef.current = trigger.timestamp;
      setIsAnnouncementPlaying(true);

      const playAnnouncement = trigger.recall
        ? recallQueue(trigger.queue_number, trigger.assigned_window_number || trigger.service_window || 'MISC')
        : announceQueue(trigger.queue_number, trigger.assigned_window_number || trigger.service_window || 'MISC');

      playAnnouncement
        .then(() => {
          console.log('✅ Trigger announcement completed');
          lastAnnouncedQueueRef.current = trigger.queue_number;
        })
        .catch(err => {
          console.error('❌ Trigger announcement failed:', err);
        })
        .finally(() => {
          setIsAnnouncementPlaying(false);
        });
    };

    window.addEventListener('storage', handleStorageChange);
    const pollInterval = setInterval(pollTrigger, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(pollInterval);
    };
  }, [isAnnouncementPlaying]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
        <div className="text-center">
          <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-8 border-primary border-t-transparent"></div>
          <p className="text-2xl font-semibold text-slate-700">Loading Queue Monitor...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-red-50 to-slate-100">
        <div className="rounded-3xl bg-white p-12 shadow-2xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
            <svg className="h-10 w-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <h2 className="mb-4 text-center text-3xl font-bold text-slate-800">Connection Error</h2>
          <p className="text-center text-lg text-slate-600">{error}</p>
          <button
            onClick={fetchQueueData}
            className="mt-8 w-full rounded-2xl bg-primary px-6 py-4 text-lg font-semibold text-white transition hover:bg-secondary"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const currentServing = queueData.serving.length > 0 ? queueData.serving[0] : null;
  const waitingQueues = queueData.waiting.slice(0, 15);
  const completedQueues = queueData.completed.slice(-8);

  return (
    <>
      {/* Full-screen monitoring styles */}
      <style jsx>{`
        :global(body) {
          overflow: hidden !important;
          background-color: #f8f9fa !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        :global(html) {
          overflow: hidden !important;
        }
        /* Hide all navigation elements */
        :global(.sidebar),
        :global(.navbar),
        :global(.header),
        :global(.navigation),
        :global(.menu),
        :global(.nav),
        :global(.top-nav),
        :global(.side-nav),
        :global(.main-nav),
        :global(.app-header),
        :global(.app-sidebar),
        :global(.layout-sidebar),
        :global(.layout-header) {
          display: none !important;
          visibility: hidden !important;
          width: 0 !important;
          height: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        /* Full viewport usage */
        :global(.main-content),
        :global(.content),
        :global(.app-content),
        :global(.layout-content),
        :global(#root),
        :global(body > div),
        :global(body > div > div) {
          margin: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          position: relative !important;
        }
        /* Ensure our component takes full screen */
        :global(.min-h-screen) {
          height: 100vh !important;
          min-height: 100vh !important;
        }
      `}</style>
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="w-full px-4">
          {/* Header Card */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <div className="flex items-center justify-between pb-6 border-b-2 border-gray-200">
              <div>
                <h1 className="text-4xl font-bold text-blue-900">Live Queue Monitor</h1>
                <p className="mt-2 text-lg text-gray-600">
                  {queueData.branchInfo?.name || (branchSlug ? branchSlug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) + ' Branch' : 'Branch Queue')} - {queueData.branchInfo?.counters || 1} Window{(queueData.branchInfo?.counters || 1) > 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 animate-pulse rounded-full bg-green-500"></div>
                  <span className="text-lg font-semibold text-green-600">Live</span>
                </div>
                {lastUpdate && (
                  <p className="mt-2 text-sm text-gray-500">
                    Updated: {lastUpdate.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          </div>

        {(() => {
            const windowCount = Object.keys(queueData.windows).length;
            
            // Dynamic spacing and sizing based on window count
            let containerClasses = "flex overflow-x-auto pb-4";
            let cardClasses = "flex-shrink-0";
            
            // Calculate optimal spacing and card width based on window count
            if (windowCount === 1) {
              containerClasses += " justify-center";
              cardClasses += " w-[500px]";
            } else if (windowCount === 2) {
              containerClasses += " justify-center gap-8";
              cardClasses += " w-[450px]";
            } else if (windowCount === 3) {
              containerClasses += " justify-center gap-6";
              cardClasses += " w-[400px]";
            } else if (windowCount === 4) {
              containerClasses += " justify-center gap-6";
              cardClasses += " w-[380px]";
            } else if (windowCount === 5) {
              containerClasses += " justify-center gap-4";
              cardClasses += " w-[360px]";
            } else if (windowCount === 6) {
              containerClasses += " justify-center gap-4";
              cardClasses += " w-[340px]";
            } else {
              // For 7+ windows
              containerClasses += " gap-3";
              cardClasses += " w-[320px]";
            }
            
            if (windowCount === 0) {
              return (
                <div className="bg-white rounded-2xl p-12 shadow-xl text-center">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
                    <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-700 mb-2">No Queue Data Available</h3>
                  <p className="text-gray-500">Waiting for queue activity to begin...</p>
                </div>
              );
            }
            
            return (
              <div className={containerClasses}>
                {Object.entries(queueData.windows).map(([windowKey, windowData]) => {
                  const currentServing = windowData.serving?.[0] || null;
                  const waitingQueues = windowData.waiting?.slice(0, 8) || [];
                  const completedQueues = windowData.completed?.slice(-4) || [];
                  
                  return (
                    <div key={windowKey} className={`${cardClasses} bg-white rounded-2xl shadow-lg overflow-hidden`}>
                      {/* Blue Top Banner */}
                      <div className="bg-blue-600 p-4 text-white">
                        <h3 className="text-xl font-bold text-center">
                          {getWindowLabel(windowKey, windowData)}
                        </h3>
                      </div>
                      
                      {/* NOW SERVING Section */}
                      <div className="p-6 border-b border-gray-200">
                        <div className="text-center">
                          <p className="text-lg font-semibold text-gray-700 mb-4">NOW SERVING</p>
                          {currentServing ? (
                            <div>
                              <p className="text-4xl font-bold text-blue-600">{currentServing.queue_number}</p>
                              <div className="mt-3 inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-800">
                                {currentServing.status === 'serving' ? 'SERVING' : 'CALLED'}
                              </div>
                            </div>
                          ) : (
                            <div className="py-6">
                              <p className="text-3xl font-semibold text-gray-400">NO QUEUE</p>
                              <p className="text-sm text-gray-500 mt-2">Waiting for next customer</p>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* WAITING QUEUE Section */}
                      <div className="p-6 border-b border-gray-200">
                        <div className="mb-4">
                          <p className="text-lg font-semibold text-gray-700">Waiting Queue</p>
                          <p className="text-sm text-gray-500">{waitingQueues.length} in line</p>
                        </div>
                        <div className="space-y-3">
                          {waitingQueues.length > 0 ? (
                            waitingQueues.map((queue, index) => (
                              <div
                                key={index}
                                className="flex items-center justify-between bg-yellow-50 rounded-lg p-5 border border-yellow-200"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-200 text-sm font-bold text-yellow-800">
                                    {index + 1}
                                  </div>
                                  <p className="text-2xl font-bold text-gray-800">{queue.queue_number}</p>
                                </div>
                                <div className="rounded-full bg-yellow-100 px-4 py-2 text-sm font-bold text-yellow-700">
                                  Waiting
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-6">
                              <p className="text-sm text-gray-500">No queues waiting</p>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* RECENTLY COMPLETED Section */}
                      <div className="p-6">
                        <div className="mb-4">
                          <p className="text-lg font-semibold text-gray-700">Recently Completed</p>
                          <p className="text-sm text-gray-500">Last {completedQueues.length} served</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {completedQueues.length > 0 ? (
                            completedQueues.map((queue, index) => (
                              <div
                                key={index}
                                className="bg-green-50 rounded-lg p-3 text-center border border-green-200"
                              >
                                <p className="text-sm font-bold text-green-800">{queue.queue_number}</p>
                              </div>
                            ))
                          ) : (
                            <div className="col-span-2 text-center py-4">
                              <p className="text-sm text-gray-500">No completed queues</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
      </div>
    </div>
    </>
  );
};

export default LiveQueueMonitor;
