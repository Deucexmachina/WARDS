const VOICELINES_BASE = '/Voicelines';
const AUDIO_EXT = '.mp3'; // Change to .wav, .ogg, .m4a, etc.

// Play a single voiceline file and wait for it to finish. Errors are logged but not thrown
// so a missing/corrupt file does not crash the entire announcement sequence.
const playAudio = (audioPath, speed = 1.3) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to play: ${audioPath} at ${speed}x speed`);
    const audio = new Audio(audioPath);
    
    audio.playbackRate = speed;
    
    audio.onended = () => {
      console.log(`Finished playing: ${audioPath}`);
      resolve();
    };
    
    audio.onerror = (error) => {
      console.error(`Failed to load audio: ${audioPath}`, error);
      resolve();
    };
    
    audio.play().catch((error) => {
      console.error(`Failed to start audio: ${audioPath}`, error);
      resolve();
    });
  });
};


// Map a single queue-number character (letter or digit) to its voiceline file path.
// Dashes and other separators are handled before this function is called.
const getCharacterAudioPath = (char) => {
  const upperChar = char.toUpperCase();
  
  if (/[A-Z]/.test(upperChar)) {
    return `${VOICELINES_BASE}/letters/${upperChar}${AUDIO_EXT}`;
  }
  
  if (/[0-9]/.test(char)) {
    return `${VOICELINES_BASE}/numbers/${char}${AUDIO_EXT}`;
  }
  
  return null;
};


// Resolve the service window identifier to a physical window number for the voiceline.
// Supports explicit window numbers, service type codes (RPT, BUSINESS, etc.), and QW labels.
const getWindowNumber = (serviceWindow) => {
  if (typeof serviceWindow === 'number') {
    return Math.min(Math.max(serviceWindow, 1), 6);
  }
  if (!serviceWindow) return 1;
  
  const normalizedText = String(serviceWindow).trim();
  if (/^[1-6]$/.test(normalizedText)) {
    return Number(normalizedText);
  }

  const explicitWindowMatch = normalizedText.match(/(?:WINDOW|QW)\s*([1-6])/i);
  if (explicitWindowMatch) {
    return Number(explicitWindowMatch[1]);
  }

  const windowUpper = normalizedText.toUpperCase();
  
  const serviceWindowMap = {
    'RPT': 1,
    'REAL PROPERTY TAX': 1,
    'BUSINESS': 2,
    'BT': 2,
    'BUSINESS TAX': 2,
    'MISC': 3,
    'MISCELLANEOUS': 3,
    'CTC': 4,
    'CEDULA': 4,
    'PTR': 5,
    'MARKET': 6,
    'QW4': 4,
    'QUEUE WINDOW 4': 4,
    'QW5': 5,
    'QUEUE WINDOW 5': 5,
  };
  
  return serviceWindowMap[windowUpper] || 1;
};

/**
 * Announce a newly called queue number by playing the full voiceline sequence:
 * alert → "queue number" → each character → "proceed to window" → window number.
 */
export const playQueueAnnouncement = async (queueNumber, serviceWindow) => {
  if (!queueNumber) {
    console.error('Queue number is required for announcement');
    return;
  }

  console.log(`Starting announcement for queue: ${queueNumber}, window: ${serviceWindow}`);

  try {
    console.log('Step 1: Playing alert sound');
    await playAudio(`${VOICELINES_BASE}/alerts/dingdong${AUDIO_EXT}`, 1.0);
    
    console.log('Step 2: Playing queue-number phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/queue-number${AUDIO_EXT}`, 1.2);
    
    // Strip the dash so queue numbers like "LA-001" are spoken as "L A 0 0 1".
    const cleanedNumber = queueNumber.replace(/-/g, '');
    const characters = cleanedNumber.split('');
    console.log(`Step 3: Playing characters: ${characters.join(', ')}`);
    
    for (const char of characters) {
      const audioPath = getCharacterAudioPath(char);
      if (audioPath) {
        await playAudio(audioPath, 1.4); // Faster for individual characters
      }
    }
    
    console.log('Step 4: Playing proceed-window phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/proceed-window${AUDIO_EXT}`, 1.2);
    
    const windowNumber = getWindowNumber(serviceWindow);
    console.log(`Step 5: Playing window ${windowNumber} announcement`);
    if (windowNumber <= 10) {
      await playAudio(`${VOICELINES_BASE}/windows/window${windowNumber}${AUDIO_EXT}`, 1.1);
    } else {
      await playAudio(`${VOICELINES_BASE}/numbers/${String(windowNumber)[0]}${AUDIO_EXT}`, 1.2);
    }
    
    console.log(`Queue announcement completed: ${queueNumber} -> Window ${windowNumber}`);
  } catch (error) {
    console.error('Error during queue announcement:', error);
  }
};


let isAnnouncementPlaying = false;

export const isAnnouncementActive = () => isAnnouncementPlaying;

const announcementQueue = [];
let isProcessingQueue = false;

// Drain the announcement queue one item at a time so overlapping calls do not interrupt each other.
const processAnnouncementQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (announcementQueue.length > 0) {
    const { type, queueNumber, serviceWindow, resolve } = announcementQueue.shift();
    isAnnouncementPlaying = true;
    try {
      if (type === 'recall') {
        await playRecallAnnouncement(queueNumber, serviceWindow);
      } else {
        await playQueueAnnouncement(queueNumber, serviceWindow);
      }
    } catch (error) {
      console.error('❌ Error processing queued announcement:', error);
    } finally {
      isAnnouncementPlaying = false;
    }
    resolve();
  }

  isProcessingQueue = false;
};

// Add an announcement to the queue and start processing if not already running.
const enqueueAnnouncement = (type, queueNumber, serviceWindow) => {
  return new Promise((resolve) => {
    announcementQueue.push({ type, queueNumber, serviceWindow, resolve });
    processAnnouncementQueue();
  });
};

/**
 * Replay the last called queue number announcement with a "recalling" prefix.
 * Used when staff click the Recall button.
 */
export const playRecallAnnouncement = async (queueNumber, serviceWindow) => {
  if (!queueNumber) {
    console.error('Queue number is required for recall announcement');
    return;
  }

  console.log(`Starting RECALL announcement for queue: ${queueNumber}, window: ${serviceWindow}`);

  try {
    console.log('Step 1: Playing alert sound');
    await playAudio(`${VOICELINES_BASE}/alerts/dingdong${AUDIO_EXT}`, 1.0);
    
    console.log('Step 2: Playing recalling phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/recalling${AUDIO_EXT}`, 1.2);
    
    const cleanedNumber = queueNumber.replace(/-/g, '');
    const characters = cleanedNumber.split('');
    console.log(`Step 3: Playing characters: ${characters.join(', ')}`);
    
    for (const char of characters) {
      const audioPath = getCharacterAudioPath(char);
      if (audioPath) {
        await playAudio(audioPath, 1.4); // Faster for individual characters
      }
    }
    
    console.log('Step 4: Playing proceed-window phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/proceed-window${AUDIO_EXT}`, 1.2);
    
    const windowNumber = getWindowNumber(serviceWindow);
    console.log(`Step 5: Playing window ${windowNumber} announcement`);
    if (windowNumber <= 10) {
      await playAudio(`${VOICELINES_BASE}/windows/window${windowNumber}${AUDIO_EXT}`, 1.1);
    } else {
      await playAudio(`${VOICELINES_BASE}/numbers/${String(windowNumber)[0]}${AUDIO_EXT}`, 1.2);
    }
    
    console.log(`Recall announcement completed: ${queueNumber} -> Window ${windowNumber}`);
  } catch (error) {
    console.error('Error during recall announcement:', error);
    // Keep the announcement queue moving even if one voiceline fails.
  }
};

/**
 * Public API: queue a normal call announcement for sequential playback.
 */
export const announceQueue = async (queueNumber, serviceWindow) => {
  console.log(`🔊 announceQueue called with: ${queueNumber}, window: ${serviceWindow}`);
  await enqueueAnnouncement('announce', queueNumber, serviceWindow);
  console.log('🔇 Announcement playback finished');
};

/**
 * Public API: queue a recall announcement for sequential playback.
 */
export const recallQueue = async (queueNumber, serviceWindow) => {
  console.log(`recallQueue called with: ${queueNumber}, window: ${serviceWindow}`);
  await enqueueAnnouncement('recall', queueNumber, serviceWindow);
  console.log('Recall announcement playback finished');
};
