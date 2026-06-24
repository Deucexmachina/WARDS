import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import { announceQueue, recallQueue } from '../../utils/queueAnnouncement';

const queueWindowLabels = {
  RPT: 'RPT',
  BUSINESS: 'BT',
  MISC: 'MISC',
  CTC: 'CTC',
  PTR: 'PTR',
  MARKET: 'MARKET',
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

    // Find all newly added serving queues
    const newServingQueues = currentServingQueues.filter(queue => {
      return !previousServingQueues.some(prev => prev.queue_number === queue.queue_number)
        && queue.queue_number !== lastAnnouncedQueueRef.current;
    });

    if (newServingQueues.length > 0) {
      setIsAnnouncementPlaying(true);

      const announceNext = async () => {
        for (const queue of newServingQueues) {
          if (!queue.queue_number) continue;
          console.log('🔊 Auto-detected new serving queue:', queue.queue_number);
          lastAnnouncedQueueRef.current = queue.queue_number;
          try {
            await announceQueue(queue.queue_number, queue.assigned_window_number || queue.service_window || 'MISC');
            console.log('✅ Auto-announcement completed for', queue.queue_number);
          } catch (err) {
            console.error('❌ Auto-announcement failed for', queue.queue_number, err);
          }
        }
      };

      announceNext().finally(() => {
        setIsAnnouncementPlaying(false);
      });
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
        <div className="rounded-3xl bg-white p-6 md:p-12 shadow-2xl">
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
      <div className="h-screen overflow-hidden bg-gray-100 p-2 sm:p-3 lg:p-4">
        <div className="mx-auto flex h-full w-full max-w-[1920px] flex-col px-1 sm:px-2 lg:px-3">
          {/* Header Card */}
          <div className="mb-3 shrink-0 rounded-2xl bg-white p-4 shadow-lg sm:mb-4 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-3 border-b-2 border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between sm:pb-5">
              <div>
                <h1 className="text-2xl font-bold text-blue-900 sm:text-3xl lg:text-4xl">Live Queue Monitor</h1>
                <p className="mt-1 text-sm text-gray-600 sm:mt-2 sm:text-base lg:text-lg">
                  {queueData.branchInfo?.name || (branchSlug ? branchSlug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) + ' Branch' : 'Branch Queue')} - {queueData.branchInfo?.counters || 1} Window{(queueData.branchInfo?.counters || 1) > 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-left sm:text-right">
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
            const windowCount = Object.keys(queueData.windows).length || 1;
            const isSingleWindow = windowCount === 1;
            const isDenseLayout = windowCount >= 5;
            const isUltraDenseLayout = windowCount >= 6;
            
            if (windowCount === 0) {
              return (
                <div className="rounded-2xl bg-white p-6 md:p-12 text-center shadow-xl">
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
              <div
                className={`min-h-0 flex-1 grid gap-2 sm:gap-3 ${
                windowCount === 1
                  ? 'grid-cols-1'
                  : windowCount === 2
                    ? 'grid-cols-1 xl:grid-cols-2'
                  : windowCount === 3
                      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                      : windowCount === 4
                        ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
                      : windowCount === 5
                          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
              }`}
                style={isDenseLayout ? { gridAutoRows: 'minmax(0, 1fr)' } : undefined}
              >
                {Object.entries(queueData.windows)
                  .sort(([, a], [, b]) => (a.assigned_window_number || 0) - (b.assigned_window_number || 0))
                  .map(([windowKey, windowData]) => {
                  const currentServing = windowData.serving?.[0] || null;
                  const waitingQueues = windowData.waiting?.slice(0, isUltraDenseLayout ? 1 : (isDenseLayout ? 2 : 2)) || [];
                  const remainingWaitingCount = Math.max(0, (windowData.waiting?.length || 0) - waitingQueues.length);
                  
                  return (
                    <div key={windowKey} className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-lg ${isSingleWindow ? 'mx-auto h-full w-full max-w-4xl' : ''}`}>
                      {/* Blue Top Banner */}
                      <div className={`bg-blue-600 text-white ${isUltraDenseLayout ? 'px-2 py-2.5' : isDenseLayout ? 'px-3 py-3' : isSingleWindow ? 'px-3 py-2.5' : 'px-3 py-4 sm:px-4'}`}>
                        <h3 className={`text-center font-bold ${isUltraDenseLayout ? 'text-sm sm:text-base' : isDenseLayout ? 'text-base sm:text-lg' : isSingleWindow ? 'text-base' : 'text-lg sm:text-xl'}`}>
                          {getWindowLabel(windowKey, windowData)}
                        </h3>
                      </div>
                      
                      {/* NOW SERVING Section */}
                      <div className={`flex items-center justify-center border-b border-gray-200 ${isUltraDenseLayout ? 'p-2.5 sm:p-3' : isDenseLayout ? 'p-3 sm:p-4' : isSingleWindow ? 'p-6' : 'p-4 sm:p-5 lg:p-6'}`}>
                        <div className="text-center">
                          <p className={`font-semibold text-gray-700 ${isUltraDenseLayout ? 'mb-2 text-xs sm:text-sm' : isDenseLayout ? 'mb-3 text-sm sm:text-base' : isSingleWindow ? 'mb-2 text-sm' : 'mb-4 text-base sm:text-lg'}`}>NOW SERVING</p>
                          {currentServing ? (
                            <div>
                              <p className={`break-words font-bold text-blue-600 ${isUltraDenseLayout ? 'text-xl sm:text-2xl' : isDenseLayout ? 'text-2xl sm:text-3xl' : isSingleWindow ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>{currentServing.queue_number}</p>
                              <div className={`inline-flex rounded-full bg-blue-100 font-bold text-blue-800 ${isUltraDenseLayout ? 'mt-2 px-2.5 py-1 text-[11px] sm:text-xs' : isDenseLayout ? 'mt-3 px-3 py-1.5 text-xs sm:text-sm' : isSingleWindow ? 'mt-2 px-3 py-1 text-xs' : 'mt-3 px-4 py-2 text-sm'}`}>
                                {currentServing.status === 'serving' ? 'SERVING' : 'CALLED'}
                              </div>
                            </div>
                          ) : (
                            <div className={isUltraDenseLayout ? 'py-1.5' : isDenseLayout ? 'py-2' : isSingleWindow ? 'py-6' : 'py-4 sm:py-6'}>
                              <p className={`font-semibold text-gray-400 ${isUltraDenseLayout ? 'text-lg sm:text-xl' : isDenseLayout ? 'text-xl sm:text-2xl' : isSingleWindow ? 'text-xl' : 'text-2xl sm:text-3xl'}`}>NO QUEUE</p>
                              <p className={`mt-1.5 text-gray-500 ${isUltraDenseLayout ? 'text-[11px] sm:text-xs' : isDenseLayout ? 'text-xs sm:text-sm' : 'text-sm'}`}>Waiting for next customer</p>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* WAITING QUEUE Section */}
                      <div className={`min-h-0 border-b border-gray-200 ${isUltraDenseLayout ? 'p-2.5 sm:p-3' : isDenseLayout ? 'p-3 sm:p-4' : isSingleWindow ? 'p-4' : 'p-4 sm:p-5 lg:p-6'}`}>
                        <div className={isUltraDenseLayout ? 'mb-2' : isDenseLayout ? 'mb-3' : 'mb-4'}>
                          <p className={`font-semibold text-gray-700 ${isUltraDenseLayout ? 'text-xs sm:text-sm' : isDenseLayout ? 'text-sm sm:text-base' : isSingleWindow ? 'text-sm' : 'text-base sm:text-lg'}`}>Waiting Queue</p>
                          <p className={`text-gray-500 ${isUltraDenseLayout ? 'text-[11px] sm:text-xs' : isDenseLayout ? 'text-xs sm:text-sm' : 'text-sm'}`}>{windowData.waiting?.length || 0} in line</p>
                        </div>
                        <div className={`space-y-2 ${isDenseLayout ? 'max-h-full overflow-hidden' : ''}`}>
                          {waitingQueues.length > 0 ? (
                            <>
                              {waitingQueues.map((queue, index) => (
                                <div
                                  key={index}
                                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow-200 bg-yellow-50 ${
                                    isUltraDenseLayout ? 'p-2.5' : isDenseLayout ? 'p-3' : isSingleWindow ? 'p-4' : 'p-4 sm:p-5'
                                  }`}
                                >
                                  <div className={`flex min-w-0 items-center ${isUltraDenseLayout ? 'gap-2.5' : isDenseLayout ? 'gap-3' : 'gap-4'}`}>
                                    <div className={`flex items-center justify-center rounded-full bg-yellow-200 font-bold text-yellow-800 ${
                                      isUltraDenseLayout ? 'h-7 w-7 text-[11px]' : isDenseLayout ? 'h-8 w-8 text-xs' : isSingleWindow ? 'h-10 w-10 text-sm' : 'h-10 w-10 text-sm'
                                    }`}>
                                      {index + 1}
                                    </div>
                                    <p className={`min-w-0 break-all font-bold text-gray-800 ${isUltraDenseLayout ? 'text-base sm:text-lg' : isDenseLayout ? 'text-lg sm:text-xl' : isSingleWindow ? 'text-xl' : 'text-xl sm:text-2xl'}`}>
                                      {queue.queue_number}
                                    </p>
                                  </div>
                                  <div className={`rounded-full bg-yellow-100 font-bold text-yellow-700 ${
                                    isUltraDenseLayout ? 'px-2.5 py-1 text-[11px] sm:text-xs' : isDenseLayout ? 'px-3 py-1 text-xs sm:text-sm' : isSingleWindow ? 'px-4 py-2 text-sm' : 'px-4 py-2 text-sm'
                                  }`}>
                                    Waiting
                                  </div>
                                </div>
                              ))}
                              {remainingWaitingCount > 0 ? (
                                <div className="rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-500 sm:text-sm">
                                  +{remainingWaitingCount} more waiting
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className={`text-center ${isDenseLayout ? 'py-3' : 'py-6'}`}>
                              <p className={`text-gray-500 ${isDenseLayout ? 'text-xs sm:text-sm' : 'text-sm'}`}>No queues waiting</p>
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
