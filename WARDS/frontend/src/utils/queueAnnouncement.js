/**
 * Queue Voice Announcement System
 * Uses locally stored audio files for queue announcements
 */

const VOICELINES_BASE = '/Voicelines';

/**
 * Play a single audio file and return a promise that resolves when it finishes
 */
const playAudio = (audioPath, speed = 1.3) => {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to play: ${audioPath} at ${speed}x speed`);
    const audio = new Audio(audioPath);
    
    // Set playback speed for faster pronunciation
    audio.playbackRate = speed;
    
    audio.onended = () => {
      console.log(`Finished playing: ${audioPath}`);
      resolve();
    };
    
    audio.onerror = (error) => {
      console.error(`Failed to load audio: ${audioPath}`, error);
      // Resolve instead of reject to continue with next audio
      resolve();
    };
    
    audio.play().catch((error) => {
      console.error(`Failed to start audio: ${audioPath}`, error);
      // Resolve instead of reject to continue with next audio
      resolve();
    });
  });
};

/**
 * Get the audio path for a character (letter or number)
 */
const getCharacterAudioPath = (char) => {
  const upperChar = char.toUpperCase();
  
  // Check if it's a letter (A-Z)
  if (/[A-Z]/.test(upperChar)) {
    return `${VOICELINES_BASE}/letters/${upperChar}.mp3`;
  }
  
  // Check if it's a number (0-9)
  if (/[0-9]/.test(char)) {
    return `${VOICELINES_BASE}/numbers/${char}.mp3`;
  }
  
  return null;
};

/**
 * Extract window number from service type
 * Examples: "RPT" -> 1, "BUSINESS" -> 2, "MISC" -> 3
 */
const getWindowNumber = (serviceType) => {
  if (!serviceType) return 1;
  
  const serviceUpper = serviceType.toUpperCase();
  
  // Map service types to window numbers
  const serviceWindowMap = {
    'RPT': 1,
    'REAL PROPERTY TAX': 1,
    'BUSINESS': 2,
    'BT': 2,
    'BUSINESS TAX': 2,
    'MISC': 3,
    'MISCELLANEOUS': 3,
  };
  
  return serviceWindowMap[serviceUpper] || 1;
};

/**
 * Play queue announcement with strict sequential playback
 * @param {string} queueNumber - Queue number (e.g., "LA-001")
 * @param {string} serviceType - Service type to determine window number
 * @returns {Promise} - Resolves when announcement completes
 */
export const playQueueAnnouncement = async (queueNumber, serviceType) => {
  if (!queueNumber) {
    console.error('Queue number is required for announcement');
    return;
  }

  console.log(`Starting announcement for queue: ${queueNumber}, service: ${serviceType}`);

  try {
    // 1. Play alert sound (normal speed)
    console.log('Step 1: Playing alert sound');
    await playAudio(`${VOICELINES_BASE}/alerts/dingdong.mp3`, 1.0);
    
    // 2. Play "queue number" phrase (slightly faster)
    console.log('Step 2: Playing queue-number phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/queue-number.mp3`, 1.2);
    
    // 3. Split queue number into characters (remove dash)
    const cleanedNumber = queueNumber.replace(/-/g, '');
    const characters = cleanedNumber.split('');
    console.log(`Step 3: Playing characters: ${characters.join(', ')}`);
    
    // 4. Play each character sequentially (faster for letters/numbers)
    for (const char of characters) {
      const audioPath = getCharacterAudioPath(char);
      if (audioPath) {
        await playAudio(audioPath, 1.4); // Faster for individual characters
      }
    }
    
    // 5. Play "proceed to window" phrase (slightly faster)
    console.log('Step 4: Playing proceed-window phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/proceed-window.mp3`, 1.2);
    
    // 6. Play window announcement (normal speed for clarity)
    const windowNumber = getWindowNumber(serviceType);
    console.log(`Step 5: Playing window ${windowNumber} announcement`);
    await playAudio(`${VOICELINES_BASE}/windows/window${windowNumber}.mp3`, 1.1);
    
    console.log(`✅ Queue announcement completed: ${queueNumber} -> Window ${windowNumber}`);
  } catch (error) {
    console.error('❌ Error during queue announcement:', error);
    // Don't throw, just log the error
  }
};

/**
 * Check if announcement is currently playing
 */
let isAnnouncementPlaying = false;

export const isAnnouncementActive = () => isAnnouncementPlaying;

/**
 * Play recall queue announcement with strict sequential playback
 * @param {string} queueNumber - Queue number (e.g., "LA-001")
 * @param {string} serviceType - Service type to determine window number
 * @returns {Promise} - Resolves when announcement completes
 */
export const playRecallAnnouncement = async (queueNumber, serviceType) => {
  if (!queueNumber) {
    console.error('Queue number is required for recall announcement');
    return;
  }

  console.log(`Starting RECALL announcement for queue: ${queueNumber}, service: ${serviceType}`);

  try {
    // 1. Play alert sound (normal speed)
    console.log('Step 1: Playing alert sound');
    await playAudio(`${VOICELINES_BASE}/alerts/dingdong.mp3`, 1.0);
    
    // 2. Play "recalling" phrase (slightly faster)
    console.log('Step 2: Playing recalling phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/recalling.mp3`, 1.2);
    
    // 3. Split queue number into characters (remove dash)
    const cleanedNumber = queueNumber.replace(/-/g, '');
    const characters = cleanedNumber.split('');
    console.log(`Step 3: Playing characters: ${characters.join(', ')}`);
    
    // 4. Play each character sequentially (faster for letters/numbers)
    for (const char of characters) {
      const audioPath = getCharacterAudioPath(char);
      if (audioPath) {
        await playAudio(audioPath, 1.4); // Faster for individual characters
      }
    }
    
    // 5. Play "proceed to window" phrase (slightly faster)
    console.log('Step 4: Playing proceed-window phrase');
    await playAudio(`${VOICELINES_BASE}/phrases/proceed-window.mp3`, 1.2);
    
    // 6. Play window announcement (normal speed for clarity)
    const windowNumber = getWindowNumber(serviceType);
    console.log(`Step 5: Playing window ${windowNumber} announcement`);
    await playAudio(`${VOICELINES_BASE}/windows/window${windowNumber}.mp3`, 1.1);
    
    console.log(`✅ Recall announcement completed: ${queueNumber} -> Window ${windowNumber}`);
  } catch (error) {
    console.error('❌ Error during recall announcement:', error);
    // Don't throw, just log the error
  }
};

/**
 * Play queue announcement with state management
 */
export const announceQueue = async (queueNumber, serviceType) => {
  console.log(`🔊 announceQueue called with: ${queueNumber}, ${serviceType}`);
  
  if (isAnnouncementPlaying) {
    console.warn('⚠️ Announcement already in progress, skipping...');
    return;
  }
  
  isAnnouncementPlaying = true;
  console.log('🎵 Starting announcement playback...');
  
  try {
    await playQueueAnnouncement(queueNumber, serviceType);
  } catch (error) {
    console.error('❌ Error in announceQueue:', error);
  } finally {
    isAnnouncementPlaying = false;
    console.log('🔇 Announcement playback finished');
  }
};

/**
 * Recall (replay) the last called queue announcement
 */
export const recallQueue = async (queueNumber, serviceType) => {
  console.log(`🔁 recallQueue called with: ${queueNumber}, ${serviceType}`);
  
  if (isAnnouncementPlaying) {
    console.warn('⚠️ Announcement already in progress, skipping recall...');
    return;
  }
  
  isAnnouncementPlaying = true;
  console.log('🎵 Starting RECALL announcement playback...');
  
  try {
    await playRecallAnnouncement(queueNumber, serviceType);
  } catch (error) {
    console.error('❌ Error in recallQueue:', error);
  } finally {
    isAnnouncementPlaying = false;
    console.log('🔇 Recall announcement playback finished');
  }
};
